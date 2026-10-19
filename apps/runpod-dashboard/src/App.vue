<template>
  <div class="min-vh-100 d-flex flex-column">
    <BNavbar class="border-bottom px-3 py-2" data-testid="navbar">
      <BNavbarBrand tag="div" class="fw-semibold">
        <i class="fa-solid fa-microchip text-primary me-2"></i>{{ $t('app.title') }}
        <BBadge v-if="pods.dryRun" variant="warning" text-indicator class="ms-2 fw-normal" data-testid="no-spend-badge" :title="$t('app.noSpendTitle')">{{ $t('app.noSpend') }}</BBadge>
      </BNavbarBrand>
      <div class="d-flex gap-2">
        <BButton variant="outline-light" size="sm" data-testid="open-repositories" @click="ui.repositoriesOpen = true">
          <i class="fa-solid fa-code-branch me-1"></i>{{ $t('app.repositories') }}
        </BButton>
        <BButton variant="outline-light" size="sm" data-testid="open-accounts" @click="ui.accountsOpen = true">
          <i class="fa-solid fa-user me-1"></i>{{ $t('app.accounts') }}
        </BButton>
        <BButton variant="outline-light" size="sm" :title="$t('app.configurationTitle')" :aria-label="$t('app.configuration')" data-testid="open-config" @click="ui.configOpen = true">
          <i class="fa-solid fa-gear"></i>
        </BButton>
        <BButton variant="primary" size="sm" :disabled="pods.refreshing" data-testid="refresh" @click="pods.load">
          <i class="fa-solid fa-rotate me-1" :class="{ 'fa-spin': pods.refreshing }"></i>
          {{ $t('app.refresh') }}
        </BButton>
      </div>
    </BNavbar>

    <BContainer class="py-4 flex-grow-1" style="max-width: 1200px">
      <BAlert
        v-if="pods.loadError"
        :model-value="true"
        variant="danger"
        dismissible
        class="mb-4"
        data-testid="load-error"
        @update:model-value="pods.loadError = null"
      >
        {{ pods.loadError }}
      </BAlert>

      <div v-if="pods.initialLoading" class="text-center text-body-secondary py-5">
        <BSpinner class="mb-3" />
        <div>{{ $t('app.loading') }}</div>
      </div>

      <template v-else>
        <Stats class="mb-4" />
        <Dashboard />
      </template>
    </BContainer>

    <RepositoriesModal />
    <GitAccountsModal />
    <ToastHost />
    <ConfigModal />
  </div>
</template>

<script setup>
/**
 * App — root component.
 *
 * State lives in the Pinia stores: `pods` (the list, the stats, every action; App loads it on
 * mount, every 30 s and on Refresh; only the first load shows the page spinner), `ui` (which
 * global modal is open), `toast`, `mounts`. After an OAuth round-trip the API redirects back
 * here with ?provider=&connected= (or &error=), which becomes a toast.
 *
 * Children:
 *   Stats      – read-only pod counts from the pods store
 *   Dashboard  – create form + pod list, acting through the pods store
 */
import { onMounted, onUnmounted } from 'vue'
import { useUiStore } from './stores/ui'
import { useToastStore } from './stores/toast'
import { t } from './i18n'
import { usePodsStore } from './stores/pods'
import ToastHost from './components/ToastHost.vue'
import Dashboard from './components/Dashboard.vue'
import Stats from './components/Stats.vue'
import RepositoriesModal from './components/RepositoriesModal.vue'
import GitAccountsModal from './components/GitAccountsModal.vue'
import ConfigModal from './components/ConfigModal.vue'

const ui = useUiStore()
const toast = useToastStore()
const pods = usePodsStore()

function readOAuthResult() {
  const params = new URLSearchParams(window.location.search)
  const provider = params.get('provider')
  if (!provider) return
  const label = provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : provider
  if (params.get('connected')) {
    toast.success(t('app.oauthConnected', { provider: label, account: params.get('connected') }))
    ui.accountsOpen = true
  } else if (params.get('error')) {
    toast.error(t('app.oauthFailed', { provider: label, error: params.get('error') }))
  }
  window.history.replaceState(null, '', window.location.pathname)
}

onMounted(() => {
  readOAuthResult()
  pods.load()
  pods.startAutoRefresh()
})
onUnmounted(() => pods.stopAutoRefresh())
</script>
