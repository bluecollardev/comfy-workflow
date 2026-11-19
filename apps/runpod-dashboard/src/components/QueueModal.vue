<template>
  <BModal v-model="open" lazy :title="$t('queue.title')" size="xl" scrollable no-footer data-testid="queue-modal" @hidden="open = false">
    <QueueLoadingBanner />
    <!-- one tab per section, each with the count of its working items; the last tab is remembered (an Open the Queue link names its own) -->
    <ul class="nav nav-tabs flex-wrap" role="tablist" data-testid="queue-tabs" @keydown="onTabKey">
      <li v-for="tb in TABS" :key="tb.id" class="nav-item" role="presentation">
        <button type="button" class="nav-link" :class="{ active: ui.queueTab === tb.id }" role="tab" :aria-selected="ui.queueTab === tb.id ? 'true' : 'false'" :tabindex="ui.queueTab === tb.id ? 0 : -1" :data-testid="`queue-tab-${tb.id}`" @click="goTab(tb.id)">{{ $t(`queue.tab.${tb.id}`) }}<BBadge :variant="tabVariant(tb.id)" class="ms-1" :class="{ 'queue-pulse': tabCounts[tb.id] && tabVariant(tb.id) === 'danger' }" :title="tb.id === 'publishing' && wouldCount ? $t('queue.wouldUploadTip', { n: wouldCount }) : undefined" :data-testid="`queue-tab-${tb.id}-count`" :data-active="tabCounts[tb.id] ? 'true' : 'false'" :data-dry="tb.id === 'publishing' && wouldCount ? 'true' : 'false'">{{ tabCounts[tb.id] || 0 }}</BBadge></button>
      </li>
    </ul>
    <div class="pt-3" role="tabpanel" :data-testid="`queue-pane-${ui.queueTab}`">
      <template v-if="ui.queueTab === 'overview'"><QueueOverview @go="(id) => (ui.queueTab = id)" /></template>
        <template v-else-if="ui.queueTab === 'imports'">
    <div v-if="finished.length" class="d-flex justify-content-end mb-2">
      <BButton size="sm" variant="outline-danger" data-testid="queue-purge" @click="purge"><i class="fa-solid fa-broom me-1"></i>{{ $t('queue.purge') }}</BButton>
    </div>
    <div v-if="vjobs.jobs.length || vjobs.interrupted.length" class="mb-4" data-testid="queue-volume-jobs">
      <h6 class="mb-2">{{ $t('queue.volumeJobs') }}</h6>
      <div v-for="p in vjobs.interrupted" :key="p.name" class="border rounded p-2 mb-2 small d-flex align-items-center gap-2 flex-wrap" data-testid="queue-interrupted" :data-name="p.name">
        <i class="fa-solid fa-triangle-exclamation text-warning"></i>
        <strong>{{ $t('queue.interrupted') }}</strong>
        <span class="font-monospace text-body-secondary">{{ p.name }}</span>
        <span class="text-body-secondary">{{ $t('queue.interruptedNote') }}</span>
        <span class="ms-auto d-inline-flex gap-2">
          <BButton v-if="p.kind === 'fetch' && p.remote_id" size="sm" variant="outline-primary" data-testid="queue-interrupted-reattach" @click="reattachPod(p)"><i class="fa-solid fa-plug me-1"></i>{{ $t('queue.reattach') }}</BButton>
          <BButton size="sm" variant="outline-danger" data-testid="queue-interrupted-delete" @click="dropPod(p)"><i class="fa-solid fa-trash me-1"></i>{{ $t('queue.deletePod') }}</BButton>
        </span>
      </div>
      <div v-for="j in vjobs.jobs" :key="j.id" class="border rounded p-2 mb-2 small" data-testid="queue-volume-job" :data-state="j.state" :data-kind="j.kind">
        <div class="d-flex align-items-baseline gap-2 flex-wrap mb-1">
          <strong>{{ ucwords($t(`vjob.kind_${j.kind}`)) }}</strong>
          <span class="text-body-secondary">{{ $t('queue.volume') }} <span class="font-monospace">{{ j.volume_id }}</span> · {{ $t('queue.started', { at: clock(j.started_at) }) }}</span>
        </div>
        <VolumeJobView :job="j">
          <template #actions>
            <BButton v-if="!['done', 'failed', 'cancelled'].includes(j.state)" size="sm" variant="outline-light" data-testid="queue-volume-cancel" @click="vcancel(j)">{{ $t('queue.cancel') }}</BButton>
          </template>
        </VolumeJobView>
      </div>
    </div>
    <div v-if="error" class="alert alert-danger small py-2" data-testid="queue-error">{{ error }}</div>
    <div v-if="ui.queueStartError" class="alert alert-danger small py-2" data-testid="queue-start-error">{{ $t('queue.startFailed', { why: ui.queueStartError }) }}</div>
    <div v-if="ui.queueStarting.length" class="alert alert-info small py-2 d-flex align-items-center gap-2" data-testid="queue-starting"><BSpinner small />{{ $t('queue.starting', { rounds: ui.queueStarting.join(', ') }, ui.queueStarting.length) }}</div>
    <div v-if="!view.imports.length && !ui.queueStarting.length && !vjobs.jobs.length && !vjobs.interrupted.length" class="text-body-secondary small" data-testid="queue-empty">{{ $t('queue.empty') }}</div>
    <div v-for="imp in newestFirst" :key="imp.id" class="mb-4" data-testid="queue-import" :data-import="imp.id">
      <div class="d-flex align-items-baseline gap-2 flex-wrap mb-1">
        <strong class="font-monospace">{{ imp.round }}</strong>
        <span class="badge" :class="imp.state === 'active' ? 'text-bg-primary' : 'text-bg-secondary'">{{ $t(`queue.import.${imp.state}`) }}</span>
        <span class="small text-body-secondary">{{ $t('queue.approvedBy', { who: imp.approved_by }) }} · {{ $t('queue.spent', { spent: imp.spent_usd, cap: imp.cap_enabled && imp.cost_cap_usd != null ? imp.cost_cap_usd : '∞' }) }} · {{ $t('queue.podLimit', { n: imp.max_pods ?? '∞' }) }}</span>
        <BButton v-if="imp.state === 'active'" size="sm" variant="outline-danger" class="ms-auto" data-testid="queue-cancel-import" @click="cancelAll(imp)">{{ $t('queue.cancelAll') }}</BButton>
      </div>
      <table class="table table-sm align-middle mb-0">
        <thead><tr><th>{{ $t('queue.task') }}</th><th>{{ $t('queue.state') }}</th><th>{{ $t('queue.pod') }}</th><th>{{ $t('queue.result') }}</th><th></th></tr></thead>
        <tbody>
          <template v-for="t in tasksOf(imp)" :key="t.id">
            <tr data-testid="queue-task" :data-state="t.state" :data-kind="t.kind">
              <td class="font-monospace small">{{ t.kind }}<span v-if="t.shot"> · {{ t.shot }}</span></td>
              <td>
                <span class="badge" :class="badge(t.state)" data-testid="queue-task-state">{{ $t(`queue.state_${t.state}`) }}</span>
                <div v-if="t.stage" class="small text-body-secondary" data-testid="queue-task-stage">{{ t.stage }}</div>
              </td>
              <td class="small">
                <template v-if="t.pod_id">{{ t.pod_name }}<div class="text-body-secondary font-monospace">{{ t.pod_id }}</div></template>
                <div v-else-if="t.pod_name" class="text-body-secondary">{{ $t('queue.podNotCreated') }}</div>
                <div v-if="t.card" class="text-body-secondary" data-testid="queue-task-card">{{ t.card }}</div>
                <div v-else-if="t.gpu" class="text-body-secondary" data-testid="queue-task-card">{{ $t('queue.cardWanted', { card: t.gpu }) }}</div>
              </td>
              <td class="small" :class="t.error ? 'text-danger' : 'text-body-secondary'">{{ t.error || t.held_reason || t.detail || '' }}<div v-if="t.started_at" class="text-body-secondary">{{ $t('queue.started', { at: clock(t.started_at) }) }}<template v-if="t.finished_at"> · {{ $t('queue.took', { min: mins(t) }) }}</template></div></td>
              <td class="text-end text-nowrap">
                <div class="d-inline-flex gap-2 justify-content-end" data-testid="queue-actions">
                  <BButton v-if="t.events?.length" size="sm" variant="outline-light" :aria-expanded="open_.has(t.id)" data-testid="queue-details" @click="toggleDetails(t.id)"><i class="fa-solid" :class="open_.has(t.id) ? 'fa-chevron-up' : 'fa-list'"></i></BButton>
                  <BButton v-if="['waiting', 'running', 'held'].includes(t.state)" size="sm" variant="outline-light" data-testid="queue-cancel" @click="cancelTask(t)">{{ $t('queue.cancel') }}</BButton>
                  <BButton v-if="['failed', 'held', 'interrupted', 'cancelled'].includes(t.state)" size="sm" variant="outline-light" data-testid="queue-retry" @click="act(() => queueAPI.retryTask(t.id))">{{ $t('queue.retry') }}</BButton>
                </div>
              </td>
            </tr>
            <tr v-if="open_.has(t.id)" data-testid="queue-task-events">
              <td colspan="5" class="small font-monospace bg-body-tertiary">
                <div v-for="(e, i) in t.events" :key="i"><span class="text-body-secondary">{{ clock(e.at) }}</span> {{ e.text }}</div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
        </template>
        <template v-else-if="ui.queueTab === 'syncs'"><SyncExplorer /><div class="text-body-secondary small mt-2" data-testid="queue-empty-syncs">{{ $t('queue.emptyHint.syncs') }}</div></template>
        <template v-else-if="ui.queueTab === 'generations'"><GenerationsPane /><FailuresPane /><div class="text-body-secondary small" data-testid="queue-empty-generations">{{ $t('queue.emptyHint.generations') }}</div></template>
        <template v-else-if="ui.queueTab === 'publishing'"><AutoPublishPane ref="apPane" /><PublishingPane /></template>
    </div>
  </BModal>
</template>

<script setup>
/** The Queue (ADR-038): every import's tasks with their state, pod and error; Cancel, Retry, Cancel all. Refreshes by itself while open. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { queueAPI } from '../api/queue'
import { errorText } from '../stores/toast'
import { useUiStore } from '../stores/ui'
import { useI18n } from 'vue-i18n'
import { useConfirmStore } from '../stores/confirm'
import { useVolumeJobsStore } from '../stores/volumejobs'
import { useRendersStore } from '../stores/renders'
import VolumeJobView from './VolumeJobView.vue'
import SyncExplorer from './SyncExplorer.vue'
import GenerationsPane from './GenerationsPane.vue'
import PublishingPane from './PublishingPane.vue'
import AutoPublishPane from './AutoPublishPane.vue'
import QueueOverview from './QueueOverview.vue'
import FailuresPane from './FailuresPane.vue'
import { useFailuresStore } from '../stores/failures'
import QueueLoadingBanner from './QueueLoadingBanner.vue'
import { useSyncsStore } from '../stores/syncs'
import { usePublishStore } from '../stores/publish'
import { useAutopublishStore } from '../stores/autopublish'
import { usePreviewsStore } from '../stores/previews'
import { ucwords } from '../utils/ucwords'

const ui = useUiStore()
const TABS = [{ id: 'overview' }, { id: 'imports' }, { id: 'syncs' }, { id: 'generations' }, { id: 'publishing' }]
/** One source of truth for the active tab: ui.queueTab, written only by a click or the arrow keys and only when it changes. */
const goTab = (id) => { if (id && id !== ui.queueTab) ui.queueTab = id }
function onTabKey(e) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  const i = TABS.findIndex((x) => x.id === ui.queueTab), n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
  goTab(n.id); e.preventDefault()
}
const syncsStore = useSyncsStore(), publishStore = usePublishStore(), apStore = useAutopublishStore(), previewsStore = usePreviewsStore()
/** The working items of each tab (the badge on its label). */
/** Auto-publish entries in ANY non-final state belong to the Publishing tab: waiting, uploading, would upload (a dry run), capped. */
const apEntries = computed(() => apStore.pending.filter((e) => !['done', 'failed', 'cancelled'].includes(e.state)))
/** The same badge as the nav Queue button: danger above 0 (pulsing), like the nav badge, a legible secondary pill at 0 and for a dry run alone. */
const tabVariant = (id) => (!tabCounts.value[id] ? 'secondary' : id === 'publishing' && wouldCount.value && wouldCount.value === tabCounts.value.publishing ? 'secondary' : 'danger')
const wouldCount = computed(() => apEntries.value.filter((e) => e.state === 'would_upload').length)
const tabCounts = computed(() => {
  const w = apStore.status
  const imports = (view.value?.tasks || []).filter((t) => ['waiting', 'running', 'held'].includes(t.state)).length + vjobs.jobs.filter((j) => !['done', 'failed', 'cancelled'].includes(j.state)).length
  const gens = renders.activeCount + (previewsStore.running ? 1 : 0)
  const pubs = publishStore.queueJobs.filter((j) => ['queued', 'uploading', 'posting'].includes(j.state)).length + apEntries.value.length + (Array.isArray(w?.generate?.waiting_to_settle) ? w.generate.waiting_to_settle.length : 0)
  const sy = syncsStore.count
  const all = imports + gens + pubs + sy
  return { overview: all, imports, syncs: sy, generations: gens, publishing: pubs }
})
const { t } = useI18n()
const confirm = useConfirmStore()
const vjobs = useVolumeJobsStore()
const renders = useRendersStore()
const open = computed({ get: () => ui.queueOpen, set: (v) => { ui.queueOpen = v } })
const view = ref({ imports: [], tasks: [], active: 0 }), error = ref('')
let timer = null
/** The latest import at the top, the oldest at the bottom. */
const newestFirst = computed(() => [...view.value.imports].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))))
/** Imports with nothing left to run: the ones Purge removes. */
const finished = computed(() => view.value.imports.filter((i) => !view.value.tasks.some((t) => t.import_id === i.id && ['waiting', 'running', 'held'].includes(t.state))))
async function purge() {
  if (!(await confirm.ask(t('queue.confirmPurge', { n: finished.value.length }), { okLabel: t('queue.purge') }))) return   // the user says yes first
  await act(() => queueAPI.purge({ confirmed: true }))
}
const open_ = ref(new Set())
const toggleDetails = (id) => { const n = new Set(open_.value); n.has(id) ? n.delete(id) : n.add(id); open_.value = n }
const clock = (iso) => new Date(iso).toLocaleTimeString()
const mins = (t) => Math.max(1, Math.round((new Date(t.finished_at) - new Date(t.started_at)) / 60000))
const tasksOf = (imp) => view.value.tasks.filter((t) => t.import_id === imp.id)
const badge = (s) => ({ done: 'text-bg-success', failed: 'text-bg-danger', running: 'text-bg-primary', waiting: 'text-bg-secondary', held: 'text-bg-warning', cancelled: 'text-bg-dark', interrupted: 'text-bg-warning' }[s] || 'text-bg-secondary')
async function refresh() { try { view.value = await queueAPI.list(); error.value = ''; ui.queueListLoaded = true; ui.queueListError = '' } catch (e) { error.value = errorText(e); ui.queueListError = error.value } }
watch(() => ui.queueRetry, refresh)
/** Cancel all asks first: running pulls and runs stop and their pods are deleted. */
async function cancelAll(imp) {
  const n = tasksOf(imp).filter((x) => ['waiting', 'running', 'held'].includes(x.state)).length
  if (await confirm.ask(t('queue.confirmCancelAll', { n, round: imp.round }), { okLabel: t('queue.cancelAll') })) act(() => queueAPI.cancelImport(imp.id))
}
/** Cancel on one task asks first too: a running one stops and its pod goes. */
async function cancelTask(task) {
  if (await confirm.ask(t('queue.confirmCancel', { what: `${task.kind}${task.shot ? ` ${task.shot}` : ''}`, round: task.round }), { okLabel: t('queue.cancel') })) act(() => queueAPI.cancelTask(task.id))
}
/** A volume job's Cancel asks first: a running download stops and its pod is deleted. */
async function vcancel(j) { if (await confirm.ask(t('queue.confirmCancel', { what: ucwords(t(`vjob.kind_${j.kind}`)), round: j.volume_id }), { okLabel: t('queue.cancel') })) { try { await vjobs.cancel(j.id) } catch (e) { error.value = errorText(e) } } }
/** An interrupted download's pod still has its script: follow it again (the bar and the file list are rebuilt from its log). */
async function reattachPod(p) { try { await vjobs.reattach(p.name) } catch (e) { error.value = errorText(e) } }
/** An interrupted job's pod (the app was restarted): deleted only on a click, after a confirm. */
async function dropPod(p) { if (await confirm.ask(t('queue.confirmDeletePod', { name: p.name }), { okLabel: t('queue.deletePod') })) { try { await vjobs.dropInterrupted(p.name) } catch (e) { error.value = errorText(e) } } }
async function act(fn) { try { await fn() } catch (e) { error.value = errorText(e) } await refresh() }
watch(() => ui.queueVersion, refresh)   // an import was just queued: show it now, not at the next tick
// the stores behind every tab poll fast while the Queue is open, whichever tab is showing (the tab panes are only mounted when active)
const failuresStore = useFailuresStore()
watch(() => ui.queueOpen, (o) => { failuresStore.use(o); apStore.setFast(o); publishStore.setFast(o); renders.setFast(o) }, { immediate: true })
onMounted(() => { syncsStore.use(); ui.queueListLoaded = false; refresh(); timer = setInterval(refresh, 2500); vjobs.watch(); renders.watch() })
onBeforeUnmount(() => { syncsStore.release(); clearInterval(timer); vjobs.unwatch() })
</script>

<style scoped>
/* the list scrolls inside the window however many imports there are */
:deep(.modal-body) { overflow-y: auto; max-height: calc(100vh - 9rem); overscroll-behavior: contain; }
</style>
