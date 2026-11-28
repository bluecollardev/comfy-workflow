<template>
  <div class="min-vh-100 d-flex flex-column">
    <div class="sticky-top bg-body app-top" data-testid="app-top">
    <BNavbar class="border-bottom px-3 py-2" data-testid="navbar">
      <BNavbarBrand tag="div" class="fw-semibold">
        <AppBrand />
      </BNavbarBrand>
      <div class="d-flex gap-2">
        <BButton variant="outline-light" size="sm" :title="$t('app.connectTitle')" :disabled="!settings.ready" data-testid="open-connect" @click="ui.connectOpen = true">
          <i class="fa-solid fa-plug me-1"></i>{{ $t('app.connect') }}
        </BButton>
        <BButton variant="outline-light" size="sm" :title="$t('app.sharedTitle')" :disabled="!settings.ready" data-testid="open-shared" @click="ui.sharedOpen = true">
          <i class="fa-solid fa-share-nodes me-1"></i>{{ $t('app.shared') }}
        </BButton>
        <BButton :variant="badge.tone === 'success' ? 'success' : badge.tone === 'warning' ? 'warning' : 'outline-light'" size="sm" class="position-relative" :class="{ 'queue-pulse': badge.pulse }" :title="badgeTitle || $t('app.queueTitle')" :data-tone="badge.tone" data-testid="open-queue" @click="ui.queueTab = 'overview'; ui.queueOpen = true">
          <i class="fa-solid fa-list-check me-1"></i>{{ $t('app.queue') }}<!-- the number is a corner overlay, like a notification badge -->
          <span v-if="badge.show" class="position-absolute top-0 start-100 translate-middle badge rounded-pill text-bg-danger queue-count" :class="{ 'queue-dot': badge.dot }" :title="badgeTitle" :data-kind="badge.dot ? 'dot' : 'count'" data-testid="queue-badge">{{ badge.dot ? '' : badge.text }}</span>
        </BButton>
        <span v-if="autopublish.status && !autopublish.old" role="button" tabindex="0" class="badge d-inline-flex align-items-center gap-1 fw-normal" :class="chip.cls" :title="chip.title" data-testid="autopublish-chip" :data-mode="chip.mode" @click="openAutopublish" @keydown.enter="openAutopublish">
          <i class="fa-solid fa-cloud-arrow-up"></i><span data-testid="autopublish-chip-label">{{ chip.label }}</span>
          <small v-if="chip.activity" class="fw-normal" data-testid="autopublish-chip-activity">· {{ chip.activity }}</small>
        </span>
        <BButton variant="outline-light" size="sm" :title="$t('app.historyTitle')" data-testid="open-history" @click="ui.historyOpen = true">
          <i class="fa-solid fa-clock-rotate-left me-1"></i>{{ $t('app.history') }}
        </BButton>
        <span v-tip="$t('app.configuration')" class="tipwrap"><BButton variant="outline-light" size="sm" data-testid="open-config" :aria-label="$t('app.configuration')" @click="ui.configOpen = true">
          <i class="fa-solid fa-gear"></i>
        </BButton></span>
        <span v-tip="$t('app.pauseAll')" class="tipwrap"><BButton variant="outline-warning" size="sm" :disabled="!settings.ready || pods.refreshing || !pods.pods.some((p) => p.status !== 'stopped')" data-testid="pause-all" :aria-label="$t('app.pauseAll')" @click="pods.stopAll">
          <i class="fa-solid fa-pause"></i>
        </BButton></span>
        <span v-tip="$t('app.refresh')" class="tipwrap"><BButton variant="primary" size="sm" :disabled="pods.refreshing" data-testid="refresh" :aria-label="$t('app.refresh')" @click="pods.load">
          <i class="fa-solid fa-rotate" :class="{ 'fa-spin': pods.refreshing }"></i>
        </BButton></span>
      </div>
    </BNavbar>
    <RateLimitBanner />
    <!-- A failed action (Resume with no free GPU on the host, Stop, Delete...) is said right under the nav bar, and stays there while the page scrolls -->
    <BAlert v-if="pods.actionError" :model-value="true" variant="danger" dismissible class="mb-0 rounded-0 border-start-0 border-end-0" data-testid="action-error" @update:model-value="pods.actionError = null">{{ pods.actionError }}</BAlert>
    <AutoSyncBanner />
    <QueueBanners />
    </div>

    <BContainer class="py-4 flex-grow-1 app-content" style="width: 100%; max-width: min(100%, 1680px)">
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

    <ConnectModal />
    <ImportModal />
    <AdapterStudio />
    <SharedModal />
    <VolumesModal />
    <SyncModal v-if="ui.syncFor" :model-value="true" :volume-id="ui.syncFor.volumeId" :volume-name="ui.syncFor.volumeName" :source="ui.syncFor.source || null" @update:model-value="ui.syncFor = null" />
    <ModelsModal />
    <HistoryModal />
    <ImportRoundModal v-if="ui.importRoundOpen" />
    <QueueModal v-if="ui.queueOpen" />
    <ToastHost />
    <ConfirmHost />
    <NamePromptHost />
    <WelcomeModal />
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
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useUiStore } from './stores/ui'
import { useSettingsStore } from './stores/settings'
import { syncAPI } from './api/sync'
import VolumesModal from './components/VolumesModal.vue'
import SyncModal from './components/SyncModal.vue'
import SharedModal from './components/SharedModal.vue'
import ModelsModal from './components/ModelsModal.vue'
import HistoryModal from './components/HistoryModal.vue'
import ImportRoundModal from './components/ImportRoundModal.vue'
import QueueModal from './components/QueueModal.vue'
import { syncsAPI } from './api/syncs'
import ConfirmHost from './components/ConfirmHost.vue'
import RateLimitBanner from './components/RateLimitBanner.vue'
import AutoSyncBanner from './components/AutoSyncBanner.vue'
import QueueBanners from './components/QueueBanners.vue'
import { queueBadge } from './utils/queuebadge'
import { activityText } from './utils/autopublish'
import { useAutosyncStore } from './stores/autosync'
import { queueAPI } from './api/queue'
import { useVolumeJobsStore } from './stores/volumejobs'
import { useRendersStore } from './stores/renders'
import { useRunJobsStore } from './stores/runjobs'
import { usePreviewJobsStore } from './stores/previewjobs'
import { usePreviewsStore } from './stores/previews'
import { useAutopublishStore } from './stores/autopublish'
import { usePublishStore } from './stores/publish'
import { targetsText, todayText, volumeScan } from './utils/autopublish'
import NamePromptHost from './components/NamePromptHost.vue'
import { useToastStore } from './stores/toast'
import { t } from './i18n'
import { usePodsStore } from './stores/pods'
import ToastHost from './components/ToastHost.vue'
import Dashboard from './components/Dashboard.vue'
import Stats from './components/Stats.vue'
import AppBrand from './components/AppBrand.vue'
import ConnectModal from './components/ConnectModal.vue'
import ImportModal from './components/ImportModal.vue'
import AdapterStudio from './components/AdapterStudio.vue'
import ConfigModal from './components/ConfigModal.vue'
import WelcomeModal from './components/WelcomeModal.vue'
import { mountsAPI } from './api/mounts'

const ui = useUiStore()
const toast = useToastStore()
const pods = usePodsStore()
const settings = useSettingsStore()

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

/** A new installation: no RunPod key (checked by the caller), no saved configuration, and the question not answered before in this browser. */
async function newInstallation() {
  try {
    if (localStorage.getItem('runpod-manager.welcome') === 'seen') return false
    return !(await mountsAPI.get()).stored
  } catch { return false }
}

/** How many queued or running tasks: the badge on the Queue button (ADR-038). Asked every 5 seconds; a failure is just no badge. */
const queueCount = ref(0)
const rendersStore = useRendersStore(), previewsStore = usePreviewsStore(), runJobsStore = useRunJobsStore(), previewJobsStore = usePreviewJobsStore()
/** The badge: the queue's tasks and volume jobs, plus the running generations (render jobs, a running preview batch). */
const autopublish = useAutopublishStore(), publishStore = usePublishStore()
const badge = computed(() => queueBadge({ queueCount: queueCount.value, renderJobs: rendersStore.jobs, runJobs: runJobsStore.jobs, previewJobs: previewJobsStore.jobs, previewsRunning: previewsStore.running, publishJobs: publishStore.jobs, entries: autopublish.pending, generate: autopublish.status?.generate, scanning: volumeScan(autopublish.status?.watching?.volume).state === 'scanning', autoLive: !!autopublish.status?.enabled && !autopublish.status?.dry_run }))
/** The tooltip lists the breakdown: '2 generations, 1 upload, 3 waiting'. */
const badgeTitle = computed(() => badge.value.parts.map((p) => t(`app.badge.${p.key}${p.n === 1 ? 'One' : ''}`, { n: p.n })).join(', ') || (badge.value.scanning ? t('app.badge.scanning') : ''))
/** ONE clear state, the same words everywhere: Auto-publish: LIVE / DRY RUN / OFF / PAUSED, with what it is doing in small text. */
const chip = computed(() => {
  const st = autopublish.status || {}, mode = !st.enabled ? 'off' : st.paused ? 'paused' : st.dry_run ? 'dry' : 'live'
  const on = st.enabled, where = targetsText(st.targets) || 'S3'
  const title = !on ? t('autopublish.chip.titleOff') : mode === 'dry' ? t('autopublish.chip.titleDry', { n: st.window_minutes ?? 10 }) : t((st.window_minutes ?? 10) === 0 ? 'autopublish.chip.titleLiveNow' : 'autopublish.chip.titleLive', { where, n: st.window_minutes ?? 10 })
  return { mode, cls: { live: 'text-bg-success', dry: 'text-bg-warning', off: 'text-bg-secondary', paused: 'text-bg-warning' }[mode], label: t(`autopublish.chip.${mode}`), title, activity: on ? activityText(st, autopublish.pending, publishStore.jobs, Date.now(), t) : '' }
})
const openAutopublish = () => { ui.queueFocus = 'autopublish'; ui.queueTab = 'publishing'; ui.queueOpen = true }
let queueTimer = null
const vjobsStore = useVolumeJobsStore()
/** Queued or running tasks plus the running volume jobs (a download, a delete) and the pods of jobs lost at a restart. */
const loadQueueCount = async () => { try { queueCount.value = (await queueAPI.list()).active } catch { queueCount.value = 0 }; try { await vjobsStore.refresh(); queueCount.value += vjobsStore.running + vjobsStore.interrupted.length } catch { /* no volume jobs known */ }; try { queueCount.value += (await syncsAPI.active()).items.length } catch { /* no syncs known */ } }
let offSync = () => {}
/** The toasts sit just under the sticky top (nav bar, and a failed action's alert below it): its height is published as --app-top-height. */
let topObserver = null
onMounted(() => {
  const el = document.querySelector('[data-testid="app-top"]')
  if (el && typeof ResizeObserver !== 'undefined') { topObserver = new ResizeObserver(() => document.documentElement.style.setProperty('--app-top-height', `${el.offsetHeight}px`)); topObserver.observe(el) }
})
onUnmounted(() => topObserver?.disconnect())
onMounted(async () => {
  loadQueueCount(); queueTimer = setInterval(loadQueueCount, 5000)
  rendersStore.watch()   // the render jobs: the Queue's Generations and its badge
  runJobsStore.watch()   // the render runs (graph generations) of the app and of other processes
  previewJobsStore.watch()   // the frame-previews jobs (frames, thumbnails, posters): the Queue's Generations and its badge
  publishStore.watchAlways()    // Publishing jobs on the Queue and its badge (quiet on a core without it)
  autopublish.watch()    // Auto-publish: the header chip and the badge (quiet on a core without it)
  readOAuthResult()
  await pods.load()
  pods.startAutoRefresh()
  offSync = syncAPI.onEvent((ev) => pods.syncEvent(ev))   // sync jobs run in the main process; every card follows them from here
  pods.syncRecover(syncAPI)
  useAutosyncStore().start()   // Auto sync's status and settings, polled while the window is open (ADR-046)
  await settings.load()
  if (!settings.ready) {   // nothing works without a RunPod key: the panel opens on the key field, after asking once, on a new installation, whether to load a configuration file instead
    if (await newInstallation()) ui.welcomeOpen = true
    else ui.configOpen = true
  }
})
onUnmounted(() => { pods.stopAutoRefresh(); offSync(); clearInterval(queueTimer); useAutosyncStore().stop() })
</script>

<style>
/* the nav Queue badge: pulsing while something runs; a small dot when only passive work (waiting entries, a scan) is there */
@keyframes queue-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.queue-pulse { animation: queue-pulse 1.4s ease-in-out infinite; }
.queue-dot { width: 0.7rem; height: 0.7rem; padding: 0; border-radius: 50%; }
.queue-count { font-size: 0.7rem; min-width: 1.25rem; box-shadow: 0 0 0 2px var(--bs-body-bg, #fff); }   /* high contrast on yellow, green and the neutral button */
</style>
