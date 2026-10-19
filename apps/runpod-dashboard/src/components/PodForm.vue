<template>
  <BForm @submit.prevent="submit" @reset.prevent="reset">
    <BRow class="g-3">
      <BCol md="6" lg="4">
        <BFormGroup label="Name" label-for="pod-name">
          <BFormInput id="pod-name" v-model.trim="form.name" placeholder="ComfyUI-Dev" required />
        </BFormGroup>
      </BCol>
      <BCol md="6" lg="4">
        <BFormGroup label="GPU" label-for="pod-gpu">
          <BFormSelect id="pod-gpu" v-model="form.gpu" :options="gpuOptions" />
        </BFormGroup>
      </BCol>
      <BCol md="6" lg="4">
        <BFormGroup label="GPU count" label-for="pod-gpu-count">
          <BFormSelect id="pod-gpu-count" v-model="form.gpuCount" :options="GPU_COUNT_OPTIONS" />
        </BFormGroup>
      </BCol>
      <BCol md="6" lg="4">
        <BFormGroup label="Instance type" label-for="pod-instance-type">
          <BFormSelect id="pod-instance-type" v-model="form.instanceType" :options="INSTANCE_TYPE_OPTIONS" />
        </BFormGroup>
      </BCol>
      <BCol md="6" lg="4">
        <BFormGroup label="Per-pod volume (GB)" label-for="pod-volume" description="0 when the configured network volume carries the data; a per-pod volume beside it is billed for nothing.">
          <BFormInput id="pod-volume" v-model.number="form.volumeGb" type="number" min="0" max="500" />
        </BFormGroup>
      </BCol>
      <BCol md="6" lg="4">
        <BFormGroup label="Container disk (GB)" label-for="pod-disk">
          <BFormInput id="pod-disk" v-model.number="form.diskGb" type="number" min="5" max="100" />
        </BFormGroup>
      </BCol>
      <BCol md="6" lg="4">
        <BFormGroup label="Mounts" label-for="pod-mounts" :description="mountsSummary">
          <BFormCheckbox id="pod-mounts" v-model="form.applyMounts" switch>
            Attach the configured volume and links
            <a href="#" class="ms-1 small" @click.prevent="ui.configOpen = true"><i class="fa-solid fa-gear"></i> configure</a>
          </BFormCheckbox>
        </BFormGroup>
      </BCol>
      <BCol md="6" lg="4">
        <BFormGroup label="Image" label-for="pod-image" :description="form.image === 'configured' ? configuredImage : ''">
          <BFormSelect id="pod-image" v-model="form.image" :options="IMAGE_OPTIONS" />
        </BFormGroup>
      </BCol>
      <BCol v-if="form.image === 'custom'" md="6" lg="8">
        <BFormGroup label="Image URI" label-for="pod-image-uri">
          <BFormInput id="pod-image-uri" v-model.trim="form.customImageUri" placeholder="docker.io/org/image:tag" required />
        </BFormGroup>
      </BCol>
      <BCol md="6" lg="4">
        <BFormGroup label="Idle stop (minutes)" label-for="pod-idle" description="Stopped after this long with nothing queued in its ComfyUI. 0 = never; blank = the configured value.">
          <BFormInput id="pod-idle" v-model.number="form.idleStopMinutes" type="number" min="0" :placeholder="String(configuredIdle)" />
        </BFormGroup>
      </BCol>
      <BCol md="12" class="d-flex gap-4">
        <!-- unchecked-value: bootstrap-vue-next emits undefined when unchecked, which the API client reads as "on" -->
        <BFormCheckbox v-model="form.startSsh" :unchecked-value="false" switch>Start SSH</BFormCheckbox>
        <BFormCheckbox v-model="form.startJupyter" :unchecked-value="false" switch>Start Jupyter</BFormCheckbox>
      </BCol>
    </BRow>

    <!-- Advanced sections, each collapsed by default -->
    <div class="mt-4 border-top">
      <div v-for="section in ADVANCED" :key="section.key" class="border-bottom">
        <div class="d-flex align-items-center">
          <button
            type="button"
            class="btn btn-link text-body text-decoration-none flex-grow-1 text-start px-0 py-2 d-flex align-items-center"
            :aria-expanded="open[section.key]"
            :aria-controls="`adv-${section.key}`"
            @click="open[section.key] = !open[section.key]"
          >
            <i class="fa-solid fa-chevron-right fa-xs me-2" :class="{ 'rotate-90': open[section.key] }"></i>
            {{ section.label }}
          </button>
          <BButton
            v-if="section.key === 'customNodes'"
            variant="outline-light"
            size="sm"
            class="text-nowrap"
            @click="attach.show = true"
          >
            <i class="fa-solid fa-plus me-1"></i>Attach node
          </BButton>
          <BPopover v-if="section.help" click placement="left" :title="section.help.title">
            <template #target>
              <button type="button" class="btn btn-link text-body-secondary p-1" aria-label="Help">
                <i class="fa-regular fa-circle-question"></i>
              </button>
            </template>
            <p class="mb-2">{{ section.help.text }}</p>
            <pre class="mb-0 small"><code>{{ section.help.code }}</code></pre>
          </BPopover>
        </div>
        <BCollapse :id="`adv-${section.key}`" v-model="open[section.key]">
          <div v-if="section.key === 'envVars'" class="pb-3">
            <table v-if="form.envVars.length" class="table table-sm table-borderless align-middle env-table mb-2">
              <thead>
                <tr class="small text-body-secondary">
                  <th scope="col" style="width: 8rem">
                    <button type="button" class="btn btn-link btn-sm p-0 text-body-secondary text-decoration-none" @click="sortRows('type')">
                      Type <i class="fa-solid fa-xs" :class="sort.envFirst ? 'fa-sort-down' : 'fa-sort-up'"></i>
                    </button>
                  </th>
                  <th v-for="[col, label] in [['key', 'Key'], ['value', 'Value']]" :key="col" scope="col" :style="col === 'key' ? 'width: 18rem' : ''">
                    <button type="button" class="btn btn-link btn-sm p-0 text-body-secondary text-decoration-none" @click="sortRows(col)">
                      {{ label }}
                      <i class="fa-solid fa-xs" :class="sort.by !== col ? 'fa-sort' : sort.dir > 0 ? 'fa-sort-up' : 'fa-sort-down'"></i>
                    </button>
                  </th>
                  <th scope="col" style="width: 2.5rem"></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(row, i) in form.envVars" :key="i">
                  <tr v-if="i === 0 || form.envVars[i - 1].type !== row.type" class="env-group small text-body-secondary">
                    <td colspan="4" class="pt-2 pb-1 text-uppercase fw-semibold">
                      {{ row.type === 'env' ? 'Environment' : 'Build args' }}
                      <span class="fw-normal">({{ form.envVars.filter((r) => r.type === row.type).length }})</span>
                    </td>
                  </tr>
                  <tr class="env-row">
                    <td>
                      <BFormSelect :model-value="row.type" :options="ROW_TYPES" aria-label="Type" size="sm" @update:model-value="changeType(row, $event)" />
                    </td>
                    <td>
                      <BFormInput
                        :model-value="row.key"
                        aria-label="Key"
                        placeholder="KEY"
                        size="sm"
                        class="font-monospace"
                        @update:model-value="setRowKey(row, $event)"
                      />
                    </td>
                    <td>
                      <BFormInput v-model="row.value" aria-label="Value" placeholder="value" size="sm" class="font-monospace" />
                    </td>
                    <td>
                      <BButton variant="outline-light" size="sm" aria-label="Remove variable" @click="form.envVars.splice(i, 1)">
                        <i class="fa-solid fa-xmark"></i>
                      </BButton>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
            <div class="d-flex flex-wrap align-items-center gap-2">
              <BButton size="sm" variant="outline-light" @click="addRow">
                <i class="fa-solid fa-plus me-1"></i>Add variable
              </BButton>
              <BDropdown size="sm" variant="outline-light" :disabled="envLoad.loading">
                <template #button-content>
                  <BSpinner v-if="envLoad.loading" small class="me-1" />
                  <i v-else class="fa-solid fa-download me-1"></i>
                  Load defaults
                </template>
                <BDropdownItem @click="loadEnv('image')">
                  From the image
                  <small class="d-block text-body-secondary">{{ imageLabel }}</small>
                </BDropdownItem>
                <BDropdownItem @click="loadEnv('dockerfile')">
                  From the Dockerfile
                  <small class="d-block text-body-secondary">apps/comfy-app/Dockerfile</small>
                </BDropdownItem>
              </BDropdown>
              <BFormCheckbox v-model="envLoad.replace" :unchecked-value="false" switch>Replace existing values</BFormCheckbox>
              <span v-if="envLoad.summary" class="small text-body-secondary ms-auto">{{ envLoad.summary }}</span>
            </div>
            <div class="form-text">{{ section.hint }}</div>
          </div>
          <BFormGroup v-else :description="section.hint" class="pb-3">
            <BFormTextarea
              v-model="form[section.key]"
              :placeholder="section.placeholder"
              rows="4"
              class="font-monospace"
            />
          </BFormGroup>
        </BCollapse>
      </div>
    </div>

    <!-- Attach node: pick packs (subfolders) out of an attached repository -->
    <BModal
      v-model="attach.show"
      title="Attach node"
      size="lg"
      ok-title="Add selected"
      :ok-disabled="attach.selected.length === 0"
      cancel-variant="outline-light"
      @ok="addSelectedFolders"
      @show="loadRepositories"
    >
      <BRow class="g-2">
        <BCol md="8">
          <BFormGroup label="Repository" label-for="attach-repo" class="mb-0">
            <BFormSelect
              id="attach-repo"
              v-model="attach.repoId"
              :options="repoOptions"
              :disabled="!attach.repositories.length"
              @update:model-value="onRepoChange"
            />
          </BFormGroup>
        </BCol>
        <BCol md="4">
          <BFormGroup label="Branch" label-for="attach-branch" class="mb-0">
            <BFormInput
              id="attach-branch"
              v-model.trim="attach.branch"
              list="attach-branches"
              autocomplete="off"
              :disabled="!attach.repoId"
              @change="findFolders"
            />
            <datalist id="attach-branches">
              <option v-for="b in attach.branches" :key="b" :value="b" />
            </datalist>
          </BFormGroup>
        </BCol>
      </BRow>
      <div class="form-text">
        <template v-if="attach.repositories.length">Not listed? </template>
        <template v-else>No repositories attached yet — </template>
        <a href="#" @click.prevent="openRepositories">Manage repositories</a>.
      </div>

      <BAlert
        v-if="attach.error"
        :model-value="true"
        variant="danger"
        dismissible
        class="mt-3 mb-0"
        @update:model-value="attach.error = null"
      >
        {{ attach.error }}
      </BAlert>

      <div v-if="attach.loading" class="text-body-secondary mt-3"><BSpinner small class="me-2" />Reading folders…</div>

      <template v-else-if="attach.folders.length">
        <div class="d-flex align-items-center gap-2 mt-3">
          <BFormInput v-model.trim="attach.filter" size="sm" placeholder="Filter folders" style="max-width: 16rem" />
          <BButton size="sm" variant="outline-light" @click="selectVisible">Select shown</BButton>
          <BButton size="sm" variant="outline-light" :disabled="!attach.selected.length" @click="attach.selected = []">
            Clear
          </BButton>
          <span class="small text-body-secondary ms-auto text-nowrap">
            {{ attach.selected.length }} selected · {{ attach.folders.length }} folders
          </span>
        </div>
        <div class="folder-list border rounded mt-2 px-3 py-2">
          <BFormCheckboxGroup v-model="attach.selected" :options="visibleFolders" stacked />
          <div v-if="visibleFolders.length < filteredFolders.length" class="small text-body-secondary mt-2">
            Showing the first {{ visibleFolders.length }} of {{ filteredFolders.length }} — narrow the filter to see more.
          </div>
        </div>
      </template>
      <div v-else-if="attach.searched" class="text-body-secondary mt-3">
        No top-level folders on this branch.
      </div>

      <div v-if="attach.repoId" class="form-text mt-3">
        Each selected folder is added as its own node pack.
        <a href="#" @click.prevent="addWholeRepo">Add the whole repository as one pack instead.</a>
      </div>
    </BModal>

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

    <div class="d-flex gap-2 mt-4">
      <BButton type="submit" variant="primary" :disabled="submitting">
        <BSpinner v-if="submitting" small class="me-1" />
        <i v-else class="fa-solid fa-plus me-1"></i>
        Create pod
      </BButton>
      <BButton type="reset" variant="outline-light" :disabled="submitting">Reset</BButton>
    </div>
  </BForm>
</template>

<script setup>
/**
 * PodForm — create a pod. Mirrors the backend's CreatePodRequest.
 *
 * Emits:
 *   pod-created  — after POST /api/pods succeeds; the form resets itself
 *
 * Fields (→ CreatePodRequest field)
 *   name            → name            required
 *   gpu             → gpu             rtx4090 | a100 | h100 | l40s
 *   gpuCount        → gpu_count       1–8
 *   instanceType    → instance_type   on-demand | spot
 *   volumeGb        → volume_gb       10–500
 *   diskGb          → disk_gb         5–100
 *   image           → image           "prebuilt", or the custom URI when "custom" is chosen
 *   startSsh        → start_ssh
 *   startJupyter    → start_jupyter
 *   envVars         → env_vars +      one list of rows [{ type: 'env' | 'arg', key, value }]; env rows → env_vars,
 *                     build_args      build-arg rows → build_args; blank keys dropped. Build args are the image's
 *                                     ARGs with their defaults, overridable (the API exposes them to the pod as env
 *                                     vars without overriding an explicit env var)
 *   pipRequirements → pip_requirements textarea passed through as a string
 *   customNodes     → custom_nodes    textarea, one pack per line: "repo", "repo#subfolder", or a GitHub
 *                                     /tree/<branch>[/<subfolder>] link → [{ name, url, branch, path }]
 *                                     (the API expects objects; name = the folder created under custom_nodes/)
 *
 * "Attach node" opens a picker over the repositories attached in the Repositories modal:
 * choose repo → branch (autocomplete from `git ls-remote`) → tick the subfolders to add.
 * The snake_case mapping lives in api/pods.js; this component sends camelCase.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { podsAPI } from '../api/pods'
import { mountsAPI } from '../api/mounts'
import { toast } from '../stores/toast'
import { gitAPI } from '../api/git'
import { imagesAPI } from '../api/images'
import { ui } from '../stores/ui'

const MAX_VISIBLE_FOLDERS = 500

// The GPU menu comes from the API (GET /api/gpus): 16-24 GB cards, cheapest first. The job runs on a
// 16 GB A4000 today and nothing asks for more than 24 GB, so no A100/H100/L40S rows to overspend on.
const gpuOptions = ref([{ value: 'rtx4090', text: 'RTX 4090 (24 GB)' }])
podsAPI.gpus().then((g) => { gpuOptions.value = g.gpus }).catch(() => {})
const GPU_COUNT_OPTIONS = Array.from({ length: 8 }, (_, i) => ({ value: i + 1, text: String(i + 1) }))
const INSTANCE_TYPE_OPTIONS = [
  { value: 'spot', text: 'Community cloud (cheaper)' },
  { value: 'on-demand', text: 'Secure cloud' },
]
const IMAGE_OPTIONS = [
  { value: 'configured', text: 'Configured image (ours, with the packs)' },
  { value: 'prebuilt', text: 'ComfyUI (ashleykza): no packs, no links' },
  { value: 'custom', text: 'Custom image' },
]
const ROW_TYPES = [
  { value: 'env', text: 'env' },
  { value: 'arg', text: 'build arg' },
]
const ADVANCED = [
  {
    key: 'envVars',
    label: 'Environment & build args',
    hint:
      'env rows are set on the pod container; build arg rows are the image’s ARGs (CUDA_VERSION, TORCH_VERSION, …) — ' +
      'a running pod cannot rebuild its image, so overrides reach it as env vars, never over an env row of the same name. ' +
      'Load defaults fills both from the image. Pasting KEY=value into a key field splits it.',
  },
  {
    key: 'pipRequirements',
    label: 'Pip requirements',
    placeholder: 'package==1.2.3',
    hint: 'requirements.txt syntax, one package per line.',
  },
  {
    key: 'customNodes',
    label: 'Custom nodes',
    placeholder: 'https://github.com/you/comfy-nodes#pack_a\nhttps://github.com/you/comfy-nodes#pack_b\nhttps://github.com/someone/ComfyUI-OtherPack',
    hint: 'One node pack per line: a repo URL, or repo#subfolder for a pack inside a monorepo. Use Attach node to pick them.',
    help: {
      title: 'Monorepo or one repo per pack',
      text:
        'Each line becomes one folder under custom_nodes/. A plain repo URL installs the whole repo as a pack. ' +
        'To install a pack that lives in a subfolder of a monorepo, add #<subfolder> — the repo is cloned once and each listed subfolder is linked in as its own pack. ' +
        'Pasting a GitHub folder link (…/tree/<branch>/<subfolder>) works too, and picks up the branch.',
      code: `https://github.com/you/comfy-nodes#pack_a        → custom_nodes/pack_a
https://github.com/you/comfy-nodes#pack_b        → custom_nodes/pack_b
https://github.com/you/comfy-nodes/tree/dev/pack_c → custom_nodes/pack_c (branch dev)
https://github.com/someone/ComfyUI-OtherPack     → custom_nodes/ComfyUI-OtherPack`,
    },
  },
]

const emit = defineEmits(['pod-created'])

const defaults = () => ({
  name: '',
  gpu: 'rtx4090',
  gpuCount: 1,
  instanceType: 'spot',
  volumeGb: 0,
  diskGb: 20,
  applyMounts: true,
  image: 'configured',
  idleStopMinutes: null,
  customImageUri: '',
  startSsh: true,
  startJupyter: false,
  envVars: [],
  pipRequirements: '',
  customNodes: '',
})

const form = reactive(defaults())

// One line under the Mounts switch: what the current configuration would attach (GET /api/mounts).
const mountsSummary = ref('')
const configuredImage = ref('')
const configuredIdle = ref(30)
async function loadMountsSummary() {
  try {
    const m = await mountsAPI.get()
    const c = m.config
    configuredImage.value = c.image ? `${c.image}` : 'no image configured'
    configuredIdle.value = c.idle_stop_minutes ?? 30
    const mapped = (m.folders || []).filter((f) => f.local).length
    mountsSummary.value = (c.network_volume_id ? `volume ${c.network_volume_id} at ${c.mount_path}` : 'no network volume configured') + `, ${mapped}/${(m.folders || []).length} folder(s) mapped, ${(m.links || []).length} link(s)`
    if (form.applyMounts === true && c.apply_by_default === false) form.applyMounts = false
  } catch { mountsSummary.value = '' }
}
onMounted(loadMountsSummary)
watch(() => ui.mountsVersion, loadMountsSummary)
const open = reactive({ envVars: false, pipRequirements: false, customNodes: false })
const submitting = ref(false)
const error = ref(null)

// ----- Attach node -----

const attach = reactive({
  show: false,
  repositories: [],
  repoId: null,
  branch: '',
  branches: [],
  loading: false,
  searched: false,
  error: null,
  folders: [],
  selected: [],
  filter: '',
})

const repoOptions = computed(() =>
  attach.repositories.map((r) => ({ value: r.id, text: `${r.name} · ${r.branch}` })),
)
const currentRepo = computed(() => attach.repositories.find((r) => r.id === attach.repoId))
const filteredFolders = computed(() => {
  const q = attach.filter.toLowerCase()
  return q ? attach.folders.filter((f) => f.toLowerCase().includes(q)) : attach.folders
})
const visibleFolders = computed(() => filteredFolders.value.slice(0, MAX_VISIBLE_FOLDERS))

async function loadRepositories() {
  attach.error = null
  try {
    attach.repositories = (await gitAPI.listRepositories()).repositories
  } catch (e) {
    attach.error = e.response?.data?.detail || e.message
    return
  }
  const stillThere = attach.repositories.some((r) => r.id === attach.repoId)
  if (!stillThere) {
    attach.repoId = attach.repositories[0]?.id ?? null
    if (attach.repoId) onRepoChange()
  }
}

// Re-fetch when the Repositories modal changes the attached list while this dialog is open
watch(() => ui.repositoriesVersion, () => attach.show && loadRepositories())

function onRepoChange() {
  const repo = currentRepo.value
  if (!repo) return
  attach.branch = repo.branch
  attach.branches = []
  gitAPI.listBranches(repo.url).then(({ branches }) => (attach.branches = branches)).catch(() => {})
  findFolders()
}

async function findFolders() {
  const repo = currentRepo.value
  if (!repo) return
  attach.loading = true
  attach.error = null
  attach.selected = []
  attach.filter = ''
  try {
    attach.folders = (await gitAPI.listRepoFolders(repo.url, attach.branch || repo.branch)).folders
    attach.searched = true
  } catch (e) {
    attach.folders = []
    attach.error = e.response?.data?.detail || e.message || 'Could not read the repository'
  } finally {
    attach.loading = false
  }
}

function selectVisible() {
  attach.selected = [...new Set([...attach.selected, ...visibleFolders.value])]
}

function openRepositories() {
  ui.repositoriesOpen = true
}

// Entry syntax the parser understands: "repo#folder", or "repo/tree/<branch>/<folder>" off main.
function entryFor(folder) {
  const url = currentRepo.value.url
  const branch = attach.branch || currentRepo.value.branch
  if (branch === 'main') return folder ? `${url}#${folder}` : url
  return `${url}/tree/${branch}${folder ? `/${folder}` : ''}`
}

function appendCustomNodes(entries) {
  const existing = new Set(lines(form.customNodes))
  const added = entries.filter((e) => !existing.has(e))
  form.customNodes = [...existing, ...added].join('\n')
  open.customNodes = true
}

function addSelectedFolders() {
  appendCustomNodes(attach.selected.map(entryFor))
}

function addWholeRepo() {
  appendCustomNodes([entryFor('')])
  attach.show = false
}

// ----- Environment variables (key/value rows) -----

const envLoad = reactive({ loading: false, replace: false, summary: '' })

const imageLabel = computed(() =>
  form.image === 'custom' ? form.customImageUri || 'custom image' : 'ComfyUI (ashleykza)',
)

// Rows stay grouped by type; a sort column applies inside each group. Reordering happens on
// explicit actions (header click, add, type change, load), never while a key is being typed.
const sort = reactive({ by: null, dir: 1, envFirst: true })

function orderRows(by) {
  const rank = sort.envFirst ? { env: 0, arg: 1 } : { arg: 0, env: 1 }
  const compare = (a, b) =>
    rank[a.r.type] - rank[b.r.type] ||
    (by ? sort.dir * a.r[by].localeCompare(b.r[by], undefined, { sensitivity: 'base' }) : 0) ||
    a.i - b.i
  const ordered = form.envVars.map((r, i) => ({ r, i })).sort(compare).map((x) => x.r)
  form.envVars.splice(0, form.envVars.length, ...ordered)
}

const regroupRows = () => orderRows(null)

function sortRows(col) {
  if (col === 'type') {
    sort.envFirst = !sort.envFirst
  } else if (sort.by === col) {
    sort.dir = -sort.dir
  } else {
    sort.by = col
    sort.dir = 1
  }
  orderRows(sort.by)
}

function addRow() {
  form.envVars.push({ type: 'env', key: '', value: '' })
  regroupRows()
}

// A row that changes type moves to the end of its new group.
function changeType(row, type) {
  row.type = type
  form.envVars.splice(form.envVars.indexOf(row), 1)
  form.envVars.push(row)
  regroupRows()
}

// Merge typed presets into the rows: add missing (type, key) pairs; overwrite values only when replace is on.
function mergeRows(presets, replace) {
  const byKey = new Map(form.envVars.map((r) => [`${r.type}:${r.key}`, r]))
  let added = 0
  let replaced = 0
  for (const preset of presets) {
    const row = byKey.get(`${preset.type}:${preset.key}`)
    if (!row) {
      form.envVars.push({ ...preset })
      added++
    } else if (replace && row.value !== preset.value) {
      row.value = preset.value
      replaced++
    }
  }
  regroupRows()
  return { added, replaced }
}

// Preset rows from the image: its ENV (registry config) as env rows and its build ARGs
// (source Dockerfile + bake file) as build-arg rows — or both from the repo Dockerfile.
async function loadEnv(source) {
  envLoad.loading = true
  envLoad.summary = ''
  error.value = null
  try {
    const { image, env, build_args: buildArgs = [], skipped = 0 } = await imagesAPI.env({
      source,
      image: form.image === 'custom' ? form.customImageUri : form.image === 'configured' ? configuredImage.value : 'prebuilt',
      applyMounts: form.applyMounts,
    })
    const { added, replaced } = mergeRows(
      [...env.map((e) => ({ type: 'env', ...e })), ...buildArgs.map((a) => ({ type: 'arg', ...a }))],
      envLoad.replace,
    )
    const what = `${env.length} env${buildArgs.length ? ` + ${buildArgs.length} build args` : ''}`
    const note = skipped ? ` (${skipped} system vars skipped)` : ''
    envLoad.summary = `${what} from ${image}: ${added} added, ${replaced} replaced${note}`
  } catch (e) {
    error.value = e.response?.data?.detail || e.message || 'Could not load environment defaults'
  } finally {
    envLoad.loading = false
  }
}

// A pasted "KEY=value" lands in the key field; split it so the value goes where it belongs.
function setRowKey(row, text) {
  const i = text.indexOf('=')
  if (i === -1) {
    row.key = text
  } else {
    row.key = text.slice(0, i)
    row.value = text.slice(i + 1)
  }
}

const rowsObject = (type) =>
  Object.fromEntries(
    form.envVars.filter((r) => r.type === type && r.key.trim()).map((r) => [r.key.trim(), r.value]),
  )

// ----- Parsing -----

const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean)

// Accepts "repo", "repo#subfolder", or a GitHub "repo/tree/<branch>[/<subfolder>]" link.
// → { name, url, branch, path } where name is the folder created under custom_nodes/.
function parseCustomNodes(text) {
  return lines(text).map((line) => {
    let [url, path = ''] = line.split('#')
    let branch = 'main'
    const tree = url.match(/^(.*?)\/tree\/([^/]+)(?:\/(.*))?$/)
    if (tree) [, url, branch, path = ''] = tree
    url = url.replace(/\/+$/, '')
    path = path.replace(/^\/+|\/+$/g, '')
    const basename = (s) => s.split('/').pop().replace(/\.git$/, '')
    return { name: basename(path || url), url, branch, path }
  })
}

// ----- Submit / reset -----

function reset() {
  Object.assign(form, defaults())
  error.value = null
}

async function submit() {
  submitting.value = true
  error.value = null
  const name = form.name
  const created = await toast.run('Create pod', () => podsAPI.createPod({
    ...form,
    image: form.image === 'custom' ? form.customImageUri : form.image,
    idleStopMinutes: form.idleStopMinutes === '' ? null : form.idleStopMinutes,
    envVars: rowsObject('env'),
    buildArgs: rowsObject('arg'),
    pipRequirements: form.pipRequirements.trim(),
    customNodes: parseCustomNodes(form.customNodes),
  }), { ok: `Pod ${name} created`, onError: (t) => (error.value = t) })
  submitting.value = false
  if (created === undefined) return
  reset()
  emit('pod-created')
}
</script>

<style scoped>
.env-table td,
.env-table th {
  padding: 0.15rem 0.25rem;
}
.folder-list {
  max-height: 50vh;
  overflow-y: auto;
}
.rotate-90 {
  transform: rotate(90deg);
}
.fa-chevron-right {
  transition: transform 0.2s ease;
}
</style>
