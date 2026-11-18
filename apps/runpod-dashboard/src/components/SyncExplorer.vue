<template>
  <div class="mb-4" data-testid="queue-syncs">
    <h6 class="mb-2">{{ $t('syncs.title') }}</h6>
    <div v-if="syncs.old" class="alert alert-info small py-2" data-testid="syncs-old"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('syncs.old') }}</div>
    <template v-else>
      <div v-if="syncs.error" class="alert alert-warning small py-2" data-testid="syncs-error">{{ $t('syncs.error', { why: syncs.error }) }}</div>
      <div v-if="!syncs.active.length" class="text-body-secondary small mb-2" data-testid="syncs-none">{{ $t('syncs.noneRunning') }}</div>
      <div v-for="r in syncs.active" :key="r.run_id" class="border rounded p-2 mb-2 small" data-testid="syncs-card" :data-run="r.run_id" :data-state="r.state" :data-pod="r.pod_id">
        <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
          <strong data-testid="syncs-card-pod">{{ r.pod_name || r.pod_id }}</strong>
          <span data-testid="syncs-direction"><i class="fa-solid" :class="r.direction === 'push' ? 'fa-arrow-up' : 'fa-arrow-down'"></i> {{ $t(`syncs.direction_${r.direction}`) }}</span>
          <span class="badge" :class="isAuto(r.trigger) ? 'text-bg-info' : 'text-bg-secondary'" data-testid="syncs-trigger">{{ isAuto(r.trigger) ? $t('syncs.trigger_auto') : $t('syncs.trigger_manual') }}</span>
          <span class="badge" :class="r.state === 'running' ? 'text-bg-primary' : 'text-bg-secondary'" data-testid="syncs-state">{{ $t(`syncs.state_${r.state}`) }}</span>
          <a href="#" class="ms-auto" data-testid="syncs-card-logs" @click.prevent="openLogs(r)">{{ $t('syncs.logs') }}</a>
        </div>
        <div class="d-flex align-items-center gap-2">
          <BProgress :value="runPercent(r)" :max="100" height="8px" variant="success" striped :animated="r.state === 'running'" class="flex-grow-1" data-testid="syncs-bar" :data-percent="runPercent(r)" />
          <span class="text-nowrap" data-testid="syncs-percent">{{ runPercent(r) }}%</span>
        </div>
        <div class="text-body-secondary" data-testid="syncs-numbers">{{ numbers(r) }}</div>
        <div v-if="r.streams" class="text-body-secondary" data-testid="syncs-streams">{{ $t('syncs.streams', { n: r.streams }) }}</div>
        <div v-if="r.steps?.length" class="d-flex flex-wrap gap-1 mt-1">
          <span v-for="s in r.steps" :key="s.key" class="badge text-bg-dark fw-normal" data-testid="syncs-step" :data-key="s.key" :data-percent="runPercent(s)">{{ s.key }} {{ runPercent(s) }}%</span>
        </div>
        <div v-if="r.current_files?.length" class="mt-2">
          <div class="fw-semibold">{{ $t('syncs.inFlight') }}</div>
          <div v-for="f in r.current_files" :key="f.path" class="d-flex align-items-center gap-2" data-testid="syncs-file" :data-path="f.path" :data-percent="filePercent(f)">
            <span class="font-monospace text-truncate flex-grow-1" :title="f.path">{{ f.path }}</span>
            <BProgress :value="filePercent(f)" :max="100" height="4px" style="width: 8rem" variant="warning" />
            <span class="text-nowrap text-body-secondary">{{ fmtBytes(f.bytes_done) }} / {{ fmtBytes(f.bytes_total) }} · {{ filePercent(f) }}%</span>
          </div>
        </div>
        <details v-if="r.recent_files?.length" class="mt-1" data-testid="syncs-recent">
          <summary class="text-body-secondary">{{ $t('syncs.recentlyCopied', { n: r.recent_files.length }) }}</summary>
          <div v-for="(p, i) in r.recent_files" :key="i" class="font-monospace text-break" data-testid="syncs-recent-file"><i class="fa-solid fa-check text-success me-1"></i>{{ p }}</div>
        </details>
      </div>

      <h6 class="mt-3 mb-2">{{ $t('syncs.watching') }}</h6>
      <div v-if="syncs.watch.paused" class="alert alert-secondary small py-2" data-testid="syncs-paused"><i class="fa-solid fa-circle-pause me-1"></i>{{ $t('syncs.paused') }}
        <a href="#" class="ms-2" data-testid="syncs-resume" @click.prevent="auto.pause(false)">{{ $t('syncs.resume') }}</a>
      </div>
      <div v-if="!syncs.watch.pull.length && !syncs.watch.push.length" class="text-body-secondary small" data-testid="syncs-watch-none">{{ $t('syncs.watchingNone') }}</div>
      <div v-for="w in syncs.watch.pull" :key="`pull-${w.pod_id}`" class="border rounded p-2 mb-2 small" data-testid="syncs-pull-row" :data-pod="w.pod_id" :data-state="w.state">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <strong>{{ w.pod_name || w.pod_id }}</strong>
          <span><i class="fa-solid fa-arrow-down"></i> {{ $t('syncs.pullLabel') }}</span>
          <span class="badge text-bg-secondary" data-testid="syncs-watch-state">{{ stateLabel(w.state) }}</span>
          <span class="text-body-secondary" data-testid="syncs-reconcile">{{ $t('syncs.lastReconcile', { at: clock(w.last_reconcile_at) || '-' }) }} · {{ $t('syncs.nextReconcile', { at: clock(w.next_reconcile_at) || '-' }) }}</span>
          <span v-if="w.cursor != null && w.cursor !== ''" class="font-monospace text-body-secondary" data-testid="syncs-cursor" :title="String(w.cursor)">{{ $t('syncs.cursor', { cursor: shortCursor(w.cursor) }) }}</span>
        </div>
        <div class="text-body-secondary" data-testid="syncs-pending">{{ $t('syncs.pending', { events: w.pending_events || 0, paths: w.pending_paths || 0, bytes: fmtBytes(w.pending_bytes || 0) }) }}</div>
      </div>
      <div v-for="w in syncs.watch.push" :key="`push-${w.pod_id}`" class="border rounded p-2 mb-2 small" data-testid="syncs-push-row" :data-pod="w.pod_id" :data-state="w.state">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <strong>{{ w.pod_name || w.pod_id }}</strong>
          <span><i class="fa-solid fa-arrow-up"></i> {{ $t('syncs.pushLabel') }}</span>
          <span class="badge text-bg-secondary" data-testid="syncs-watch-state">{{ stateLabel(w.state) }}</span>
          <span class="text-body-secondary" data-testid="syncs-push-pending">{{ $t('syncs.pendingFiles', { n: w.pending_files || 0 }) }}</span>
          <span v-if="secondsLeft(w.debounce_ms_left)" class="text-body-secondary" data-testid="syncs-debounce">{{ $t('syncs.debounce', { s: secondsLeft(w.debounce_ms_left) }) }}</span>
          <span v-if="w.last_change_at" class="text-body-secondary" data-testid="syncs-last-change">{{ $t('syncs.lastChange', { at: clock(w.last_change_at) }) }}</span>
          <span v-if="w.last_push_at" class="text-body-secondary" data-testid="syncs-last-push">{{ $t('syncs.lastPush', { at: clock(w.last_push_at) }) }}</span>
        </div>
        <div class="d-flex flex-wrap gap-3 mt-1">
          <span v-for="f in w.folders || []" :key="f.path" class="font-monospace" data-testid="syncs-folder" :data-path="f.path" :data-watching="f.watching ? 'true' : 'false'">
            <i class="fa-solid fa-circle small" :class="f.watching ? 'text-success' : 'text-body-secondary'" :title="f.watching ? $t('syncs.folderWatched') : $t('syncs.folderNotWatched')"></i>
            {{ f.path }}<span v-if="f.pending" class="text-warning ms-1" data-testid="syncs-folder-pending">{{ $t('syncs.folderPending', { n: f.pending }) }}</span>
          </span>
        </div>
      </div>

      <h6 class="mt-3 mb-2">{{ $t('syncs.feed') }}</h6>
      <div v-if="!feed.length" class="text-body-secondary small" data-testid="syncs-feed-empty">{{ $t('syncs.feedEmpty') }}</div>
      <table v-else class="table table-sm small align-middle mb-2" data-testid="syncs-feed">
        <thead><tr><th>{{ $t('syncs.colTime') }}</th><th>{{ $t('syncs.colWriter') }}</th><th>{{ $t('syncs.colOp') }}</th><th>{{ $t('syncs.colPath') }}</th></tr></thead>
        <tbody>
          <tr v-for="(e, i) in feed" :key="i" data-testid="syncs-event">
            <td class="text-nowrap">{{ clockSec(e.ts) }}</td>
            <td><span class="badge text-bg-secondary" data-testid="syncs-event-writer" :title="e.source_pod || ''">{{ e.writer }}</span></td>
            <td>{{ e.op }}</td>
            <td class="font-monospace text-break">{{ e.path }}</td>
          </tr>
        </tbody>
      </table>

      <h6 class="mt-3 mb-2">{{ $t('syncs.finished') }}</h6>
      <div v-if="!syncs.recent.length" class="text-body-secondary small" data-testid="syncs-finished-empty">{{ $t('syncs.finishedEmpty') }}</div>
      <table v-else class="table table-sm small align-middle mb-0" data-testid="syncs-finished">
        <tbody>
          <tr v-for="r in syncs.recent" :key="r.run_id" data-testid="syncs-finished-row" :data-run="r.run_id" :data-state="r.state">
            <td class="text-nowrap">{{ clock(r.started_at) }}</td>
            <td>{{ r.pod_name || r.pod_id }}</td>
            <td><i class="fa-solid" :class="r.direction === 'push' ? 'fa-arrow-up' : 'fa-arrow-down'"></i> {{ $t(`syncs.direction_${r.direction}`) }}</td>
            <td><span class="badge" :class="isAuto(r.trigger) ? 'text-bg-info' : 'text-bg-secondary'">{{ isAuto(r.trigger) ? $t('syncs.trigger_auto') : $t('syncs.trigger_manual') }}</span></td>
            <td><span class="badge" :class="{ done: 'text-bg-success', failed: 'text-bg-danger' }[r.state] || 'text-bg-dark'">{{ $t(`syncs.state_${r.state}`) }}</span></td>
            <td class="text-nowrap">{{ $t('syncs.runLine', { files: r.files ?? 0, bytes: fmtBytes(r.bytes ?? 0) }) }}</td>
            <td class="text-break" :class="r.error ? 'text-danger' : 'text-body-secondary'">{{ r.error || r.summary || '' }}</td>
            <td class="text-end"><a href="#" data-testid="syncs-finished-logs" @click.prevent="openLogs(r)">{{ $t('syncs.logs') }}</a></td>
          </tr>
        </tbody>
      </table>
    </template>
    <SyncLogsModal v-if="logs" v-model="logsOpen" :pod-id="logs.pod_id" :pod-name="logs.pod_name" :run-id="logs.run_id" />
  </div>
</template>

<script setup>
/** The Sync explorer under the Queue (docs/ADR-046): active syncs with file progress, what auto sync is watching, the change feed and the finished runs. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSyncsStore } from '../stores/syncs'
import { useAutosyncStore } from '../stores/autosync'
import { fmtBytes, fmtRate } from '../utils/autosync'
import { clock, clockSec, filePercent, fmtEta, isAuto, runPercent, secondsLeft, shortCursor } from '../utils/syncs'
import SyncLogsModal from './SyncLogsModal.vue'

const { t, te } = useI18n()
const syncs = useSyncsStore()
const auto = useAutosyncStore()
const logs = ref(null)
const logsOpen = computed({ get: () => !!logs.value, set: (v) => { if (!v) logs.value = null } })
const openLogs = (r) => { logs.value = { run_id: r.run_id, pod_id: r.pod_id, pod_name: r.pod_name } }
const feed = computed(() => (syncs.watch.events || []).slice(0, 30))
const stateLabel = (s) => (te(`syncs.watchState_${s}`) ? t(`syncs.watchState_${s}`) : s || '')
/** '12 of 25 files · 1.1 GB of 1.2 GB · 38 MB/s · ETA 3 s' */
function numbers(r) {
  const parts = [t('syncs.filesOf', { done: r.files_done ?? 0, total: r.files_total ?? 0 })]
  if (r.bytes_total > 0) parts.push(t('syncs.bytesOf', { done: fmtBytes(r.bytes_done || 0), total: fmtBytes(r.bytes_total) }))
  if (fmtRate(r.rate_bps)) parts.push(t('syncs.rate', { rate: fmtRate(r.rate_bps) }))
  if (fmtEta(r.eta_s)) parts.push(t('syncs.eta', { eta: fmtEta(r.eta_s) }))
  return parts.join(' · ')
}
onMounted(() => syncs.use())
onBeforeUnmount(() => syncs.release())
</script>
