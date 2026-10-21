<template>
  <BModal
    :model-value="ui.accountsOpen"
    title="Accounts"
    ok-only
    ok-title="Done"
    ok-variant="outline-light"
    @update:model-value="ui.accountsOpen = $event"
    @show="load"
  >
    <p class="text-body-secondary small">
      Connect GitHub or GitLab to search and clone private repositories. A pod only receives
      a credential for hosts it has to clone from.
    </p>

    <div v-if="loading" class="text-center text-body-secondary py-3"><BSpinner small /></div>

    <template v-else>
      <div v-if="accounts.length" class="list-group mb-3">
        <div v-for="a in accounts" :key="a.id" class="list-group-item d-flex align-items-center gap-3">
          <img v-if="a.avatar_url" :src="a.avatar_url" width="32" height="32" class="rounded-circle" alt="" />
          <i v-else :class="PROVIDER_ICON[a.provider]" class="fs-4"></i>
          <div class="flex-grow-1 lh-sm">
            <div class="fw-semibold">{{ a.username }}</div>
            <small class="text-body-secondary">{{ a.host }}<span v-if="a.name"> · {{ a.name }}</span></small>
          </div>
          <BButton size="sm" variant="outline-danger" @click="disconnect(a)">Disconnect</BButton>
        </div>
      </div>
      <div v-else class="text-body-secondary mb-3">No accounts connected.</div>

      <div class="d-flex flex-wrap gap-2">
        <BButton
          v-for="p in providers"
          :key="p.id"
          :href="p.configured && !gitAPI.connect ? gitAPI.connectUrl(p.id) : undefined"
          :disabled="!p.configured || connecting === p.id"
          variant="outline-light"
          @click="gitAPI.connect && connect(p)"
        >
          <BSpinner v-if="connecting === p.id" small class="me-2" /><i v-else :class="PROVIDER_ICON[p.id]" class="me-2"></i>Connect {{ p.label }}
        </BButton>
      </div>
      <div v-if="providers.some((p) => !p.configured)" class="form-text mt-2">
        To enable a provider, register an OAuth app with callback
        <code>{{ providers[0]?.redirect_uri || 'http://localhost:8000/api/auth/<provider>/callback' }}</code> and set
        <code>&lt;PROVIDER&gt;_CLIENT_ID</code> / <code>&lt;PROVIDER&gt;_CLIENT_SECRET</code>
        {{ gitAPI.connect ? 'in ~/.config/runpod-pod-manager/.env' : 'on the API server' }}.
      </div>
    </template>

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
  </BModal>
</template>

<script setup>
/**
 * GitAccountsModal — connect / disconnect GitHub and GitLab accounts (OAuth).
 *
 * Opened via `ui.accountsOpen`. In a browser "Connect" is a plain link to the API's OAuth start
 * route; the provider redirects back to the app, which shows the result (see App.vue). In
 * Electron `gitAPI.connect` runs the round-trip itself (system browser, loopback callback) and
 * the button waits for it.
 */
import { ref } from 'vue'
import { gitAPI } from '../api/git'
import { errorText, useToastStore } from '../stores/toast'
import { t } from '../i18n'
import { useUiStore } from '../stores/ui'

const ui = useUiStore()
const toast = useToastStore()

const PROVIDER_ICON = { github: 'fa-brands fa-github', gitlab: 'fa-brands fa-gitlab' }

const accounts = ref([])
const providers = ref([])
const loading = ref(false)
const error = ref(null)
const connecting = ref(null)   // the provider id whose login is open in the browser (Electron only)

async function load() {
  loading.value = true
  error.value = null
  try {
    ;({ accounts: accounts.value, providers: providers.value } = await gitAPI.listAccounts())
  } catch (e) {
    error.value = e.response?.data?.detail || e.message
  } finally {
    loading.value = false
  }
}

async function connect(p) {
  connecting.value = p.id
  error.value = null
  try {
    const account = await gitAPI.connect(p.id)
    toast.success(t('app.oauthConnected', { provider: p.label, account: account.username }))
    await load()
  } catch (e) {
    error.value = t('app.oauthFailed', { provider: p.label, error: errorText(e) })
    toast.error(error.value)
  } finally {
    connecting.value = null
  }
}

async function disconnect(account) {
  if (!window.confirm(`Disconnect ${account.username} (${account.host})?`)) return
  const r = await toast.run(t('toast.disconnect'), () => gitAPI.disconnect(account.id), { ok: t('toast.disconnected', { name: account.username }), onError: (msg) => (error.value = msg) })
  if (r.ok) await load()
}
</script>
