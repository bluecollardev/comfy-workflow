<template>
  <BModal
    :model-value="ui.repositoriesOpen"
    title="Repositories"
    size="lg"
    ok-only
    ok-title="Done"
    ok-variant="outline-light"
    @update:model-value="ui.repositoriesOpen = $event"
    @show="load"
  >
    <p class="text-body-secondary small">
      Repositories attached here are what <em>Attach node</em> offers when creating a pod.
      Start typing to search the repositories your connected accounts can see, or paste a URL.
    </p>

    <BRow class="g-2 align-items-end">
      <BCol md="6">
        <BFormGroup label="Repository" label-for="repo-url" class="mb-0">
          <BFormInput
            id="repo-url"
            v-model.trim="draft.url"
            list="repo-suggestions"
            placeholder="Search, or https://github.com/you/comfy-nodes"
            autocomplete="off"
            @update:model-value="onUrlInput"
          />
          <datalist id="repo-suggestions">
            <option v-for="r in suggestions" :key="r.url" :value="r.url">
              {{ r.name }}{{ r.private ? ' (private)' : '' }} · {{ r.account }}
            </option>
          </datalist>
        </BFormGroup>
      </BCol>
      <BCol md="3">
        <BFormGroup label="Branch" label-for="repo-branch" class="mb-0">
          <BFormInput
            id="repo-branch"
            v-model.trim="draft.branch"
            list="branch-suggestions"
            :placeholder="branches.default || 'default branch'"
            :disabled="!draft.url"
            autocomplete="off"
          />
          <datalist id="branch-suggestions">
            <option v-for="b in branches.list" :key="b" :value="b" />
          </datalist>
        </BFormGroup>
      </BCol>
      <BCol md="3">
        <BButton variant="primary" class="w-100" :disabled="!draft.url || saving" @click="attach">
          <BSpinner v-if="saving" small class="me-1" />
          <i v-else class="fa-solid fa-plus me-1"></i>
          Attach
        </BButton>
      </BCol>
    </BRow>
    <div v-if="!hasAccounts" class="form-text">
      Connect a GitHub or GitLab account under
      <a href="#" @click.prevent="openAccounts">Accounts</a> to get suggestions for your private repositories.
    </div>

    <BAlert
      v-if="error"
      :model-value="true"
      variant="danger"
      dismissible
      class="mt-3 mb-0"
      @update:model-value="error = null"
    >
      {{ error }}
    </BAlert>

    <div class="list-group mt-3">
      <div v-if="loading" class="list-group-item text-body-secondary"><BSpinner small class="me-2" />Loading…</div>
      <div v-for="r in repositories" :key="r.id" class="list-group-item d-flex align-items-center gap-3">
        <i :class="hostIcon(r.host)" class="fs-5 text-body-secondary"></i>
        <div class="flex-grow-1 lh-sm overflow-hidden">
          <div class="fw-semibold text-truncate">{{ r.name }}</div>
          <small class="text-body-secondary d-block text-truncate">
            {{ r.url }} · <i class="fa-solid fa-code-branch fa-xs"></i> {{ r.branch }}
          </small>
        </div>
        <BButton size="sm" variant="outline-danger" @click="detach(r)">Remove</BButton>
      </div>
      <div v-if="!loading && !repositories.length" class="list-group-item text-body-secondary">
        No repositories attached yet.
      </div>
    </div>
  </BModal>
</template>

<script setup>
/**
 * RepositoriesModal — manage the repositories attached to the project.
 *
 * Repository autocomplete: `/api/repos/search` across connected accounts (debounced).
 * Branch autocomplete: `/api/repos/branches` for the typed/picked URL; the default branch
 * is used when the field is left empty. Attaching bumps `ui.repositoriesVersion` so the
 * Attach-node dialog re-fetches.
 */
import { reactive, ref } from 'vue'
import { gitAPI } from '../api/git'
import { useToastStore } from '../stores/toast'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()
const toast = useToastStore()

const repositories = ref([])
const suggestions = ref([])
const branches = reactive({ default: '', list: [] })
const hasAccounts = ref(true)
const draft = reactive({ url: '', branch: '' })
const loading = ref(false)
const saving = ref(false)
const error = ref(null)

const isUrl = (s) => /^(https?:\/\/|git@|ssh:\/\/)/.test(s)

function hostIcon(host) {
  if (/github/.test(host)) return 'fa-brands fa-github'
  if (/gitlab/.test(host)) return 'fa-brands fa-gitlab'
  return 'fa-solid fa-code-branch'
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const [{ repositories: repos }, { accounts }] = await Promise.all([
      gitAPI.listRepositories(),
      gitAPI.listAccounts(),
    ])
    repositories.value = repos
    hasAccounts.value = accounts.length > 0
  } catch (e) {
    error.value = e.response?.data?.detail || e.message
  } finally {
    loading.value = false
  }
}

let searchTimer
let branchTimer
function onUrlInput(value) {
  clearTimeout(searchTimer)
  clearTimeout(branchTimer)
  branches.default = ''
  branches.list = []
  if (!value) return
  if (hasAccounts.value && !isUrl(value)) {
    searchTimer = setTimeout(async () => {
      try {
        suggestions.value = (await gitAPI.searchRepos(value)).repos
      } catch {
        suggestions.value = []
      }
    }, 300)
  }
  if (isUrl(value)) {
    branchTimer = setTimeout(async () => {
      try {
        const { default: def, branches: list } = await gitAPI.listBranches(value)
        branches.default = def
        branches.list = list
      } catch {
        /* branch suggestions are a convenience; attach still resolves the default */
      }
    }, 500)
  }
}

async function attach() {
  saving.value = true
  error.value = null
  const url = draft.url
  const r = await toast.run('Attach repository', () => gitAPI.attachRepository(url, draft.branch || branches.default || null), { ok: `Attached ${url}`, onError: (t) => (error.value = t) })
  saving.value = false
  if (!r.ok) return
  draft.url = ''
  draft.branch = ''
  branches.list = []
  ui.repositoriesVersion++
  await load()
}

async function detach(repo) {
  if (!window.confirm(`Remove ${repo.name} (${repo.branch})?`)) return
  const r = await toast.run('Remove repository', () => gitAPI.detachRepository(repo.id), { ok: `Removed ${repo.name}`, onError: (t) => (error.value = t) })
  if (!r.ok) return
  ui.repositoriesVersion++
  await load()
}

function openAccounts() {
  ui.repositoriesOpen = false
  ui.accountsOpen = true
}
</script>
