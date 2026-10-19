<template>
  <div class="min-vh-100 d-flex flex-column">
    <BNavbar class="border-bottom px-3 py-2">
      <BNavbarBrand tag="div" class="fw-semibold">
        <i class="fa-solid fa-microchip text-primary me-2"></i>RunPod Manager
      </BNavbarBrand>
      <div class="d-flex gap-2">
        <BButton variant="outline-light" size="sm" @click="ui.repositoriesOpen = true">
          <i class="fa-solid fa-code-branch me-1"></i>Repositories
        </BButton>
        <BButton variant="outline-light" size="sm" @click="ui.accountsOpen = true">
          <i class="fa-solid fa-user me-1"></i>Accounts
        </BButton>
        <BButton variant="outline-light" size="sm" title="Configuration: volume and mount points" aria-label="Configuration" @click="ui.configOpen = true">
          <i class="fa-solid fa-gear"></i>
        </BButton>
        <BButton variant="primary" size="sm" :disabled="refreshing" @click="loadDashboard">
          <i class="fa-solid fa-rotate me-1" :class="{ 'fa-spin': refreshing }"></i>
          Refresh
        </BButton>
      </div>
    </BNavbar>

    <BContainer class="py-4 flex-grow-1" style="max-width: 1200px">
      <BAlert
        v-if="notice"
        :model-value="true"
        :variant="notice.variant"
        dismissible
        class="mb-4"
        @update:model-value="notice = null"
      >
        {{ notice.text }}
      </BAlert>

      <BAlert
        v-if="error"
        :model-value="true"
        variant="danger"
        dismissible
        class="mb-4"
        @update:model-value="error = null"
      >
        {{ error }}
      </BAlert>

      <div v-if="initialLoading" class="text-center text-body-secondary py-5">
        <BSpinner class="mb-3" />
        <div>Loading pods...</div>
      </div>

      <template v-else>
        <Stats :stats="dashboard.stats" class="mb-4" />
        <Dashboard :pods="dashboard.pods" @pods-updated="dashboard.pods = $event" />
      </template>
    </BContainer>

    <RepositoriesModal />
    <GitAccountsModal />
    <BOrchestrator />
    <ConfigModal />
  </div>
</template>

<script setup>
/**
 * App — root component.
 *
 * Owns the dashboard payload ({ stats, pods }) fetched from GET /api/dashboard.
 * Loads it on mount, re-fetches every 30 s, and on the navbar Refresh button.
 * Only the very first fetch replaces the page with a spinner; later refreshes
 * just spin the button so the page doesn't flash.
 *
 * Navbar also opens the three global modals (Repositories, Accounts, Configuration) through the
 * shared `ui` store, and after an OAuth round-trip the API redirects back here with
 * ?provider=&connected= (or &error=), which is shown as a notice.
 *
 * Children:
 *   Stats      – read-only pod counts
 *   Dashboard  – create form + pod list; emits `pods-updated` after any mutation
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { podsAPI } from './api/pods'
import { ui } from './stores/ui'
import { installToasts, toast } from './stores/toast'
import Dashboard from './components/Dashboard.vue'
import Stats from './components/Stats.vue'
import RepositoriesModal from './components/RepositoriesModal.vue'
import GitAccountsModal from './components/GitAccountsModal.vue'
import ConfigModal from './components/ConfigModal.vue'

const REFRESH_MS = 30_000

const dashboard = ref({ stats: {}, pods: [] })
const initialLoading = ref(true)
const refreshing = ref(false)
const error = ref(null)
const notice = ref(null)
installToasts()

async function loadDashboard() {
  refreshing.value = true
  try {
    dashboard.value = await podsAPI.getDashboard()
    error.value = null
  } catch (e) {
    error.value = e.response?.data?.detail || e.message || 'Failed to load dashboard'
  } finally {
    refreshing.value = false
    initialLoading.value = false
  }
}

function readOAuthResult() {
  const params = new URLSearchParams(window.location.search)
  const provider = params.get('provider')
  if (!provider) return
  const label = provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : provider
  if (params.get('connected')) {
    toast.success(`Connected ${label} account ${params.get('connected')}.`)
    ui.accountsOpen = true
  } else if (params.get('error')) {
    toast.error(`${label} connection failed: ${params.get('error')}`)
  }
  window.history.replaceState(null, '', window.location.pathname)
}

let timer
onMounted(() => {
  readOAuthResult()
  loadDashboard()
  timer = setInterval(loadDashboard, REFRESH_MS)
})
onUnmounted(() => clearInterval(timer))
</script>
