<template>
  <div v-if="entries.length" class="mb-3" data-testid="sync-jobs">
    <div class="small fw-semibold mb-1">{{ $t('syncTargets.jobsTitle') }}</div>
    <BAlert v-if="actionError" :model-value="true" variant="danger" class="small py-2" data-testid="sync-job-action-error"><i class="fa-solid fa-circle-xmark me-2"></i>{{ actionError }}</BAlert>
    <div v-for="e in entries" :key="e.id" class="border rounded p-2 mb-2" data-testid="sync-job" :data-id="e.id" :data-ns="e.ns" :data-state="viewOf(e)?.state || 'starting'" :data-target="e.label">
      <div class="d-flex align-items-center gap-2 mb-1">
        <span class="fw-semibold" data-testid="sync-job-label">{{ e.label }}</span>
        <span v-if="e.sub" class="small text-body-secondary" data-testid="sync-job-sub">{{ e.sub }}</span>
        <span class="badge ms-auto" :class="chip(viewOf(e))" data-testid="sync-job-state">{{ stateText(viewOf(e)) }}</span>
      </div>
      <template v-if="viewOf(e)">
        <BProgress :value="pct(viewOf(e))" :max="100" height="6px" :variant="viewOf(e).state === 'failed' ? 'danger' : 'warning'" :striped="!ended(viewOf(e))" :animated="!ended(viewOf(e))" class="mb-1" data-testid="sync-job-bar" />
        <div class="small" data-testid="sync-job-progress">{{ $t('syncTargets.jobFiles', { done: fmtN(viewOf(e).files_done + viewOf(e).files_skipped), total: fmtN(viewOf(e).files_total) }) }} · {{ $t('syncTargets.jobBytes', { done: formatBytes(viewOf(e).bytes_done), total: formatBytes(viewOf(e).bytes_total) }) }}<template v-if="viewOf(e).rate"> · {{ formatBytes(viewOf(e).rate) }}/s</template></div>
        <div v-if="viewOf(e).files_skipped || viewOf(e).files_failed" class="small text-body-secondary" data-testid="sync-job-counts">{{ $t('syncTargets.jobCounts', { skipped: fmtN(viewOf(e).files_skipped), failed: fmtN(viewOf(e).files_failed) }) }}</div>
        <div v-if="viewOf(e).current && !ended(viewOf(e))" class="small font-monospace text-break text-body-secondary" data-testid="sync-job-current">{{ viewOf(e).current }}</div>
        <BAlert v-if="viewOf(e).error" :model-value="true" variant="danger" class="small py-2 mt-1 mb-0" data-testid="sync-job-error"><i class="fa-solid fa-circle-xmark me-2"></i>{{ viewOf(e).error }}</BAlert>
        <div v-if="(viewOf(e).warnings || []).length" class="small text-warning mt-1" data-testid="sync-job-warnings">
          <div v-for="(w, i) in viewOf(e).warnings.slice(0, 5)" :key="i" class="text-break" data-testid="sync-job-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ w }}</div>
          <div v-if="viewOf(e).warnings.length > 5" class="text-body-secondary">{{ $t('syncTargets.moreWarnings', { n: viewOf(e).warnings.length - 5 }) }}</div>
        </div>
        <div class="mt-2 d-flex gap-2">
          <BButton v-if="!ended(viewOf(e))" size="sm" variant="outline-danger" data-testid="sync-job-cancel" @click="cancel(e)">{{ $t('syncTargets.cancel') }}</BButton>
          <BButton v-if="canRetry(viewOf(e))" size="sm" variant="outline-warning" data-testid="sync-job-retry" @click="retry(e)">{{ $t('syncTargets.retryFailed') }}</BButton>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
/**
 * SyncJobs: the jobs this window started (a volume's copy to a storage, a download to this PC), each labelled with its target: files, bytes, rate, the file under way, warnings,
 * state, Cancel while it runs and Retry Failed after it ends. Polls the core every 2 s while one is running; an error is shown, never dropped.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { volumesyncAPI } from '../api/volumesync'
import { sourcesyncAPI } from '../api/sourcesync'
import { bucketsyncAPI } from '../api/bucketsync'
import { formatBytes } from '../sync-progress'
import { errorText } from '../stores/toast'

const emit = defineEmits(['running', 'count'])
const APIS = { volumesync: volumesyncAPI, sourcesync: sourcesyncAPI, bucketsync: bucketsyncAPI }
const TERMINAL = ['done', 'done_with_warning', 'failed', 'cancelled']
const entries = ref([]), views = ref({}), actionError = ref('')
let timer = null, alive = true
const fmtN = (x) => Number(x || 0).toLocaleString('en-US')
const viewOf = (e) => views.value[e.id]
const ended = (j) => TERMINAL.includes(j.state)
const pct = (j) => (j.bytes_total > 0 ? Math.min(100, Math.round((100 * j.bytes_done) / j.bytes_total)) : j.files_total > 0 ? Math.min(100, Math.round((100 * (j.files_done + j.files_skipped)) / j.files_total)) : ended(j) ? 100 : 0)
const canRetry = (j) => ended(j) && j.state !== 'cancelled' && j.files_failed > 0
const stateText = (j) => (j ? j.state.replace(/_/g, ' ') : 'starting')
const chip = (j) => (!j ? 'text-bg-secondary' : j.state === 'done' ? 'text-bg-success' : j.state === 'failed' ? 'text-bg-danger' : j.state === 'done_with_warning' ? 'text-bg-warning' : j.state === 'cancelled' ? 'text-bg-secondary' : 'text-bg-primary')
const running = computed(() => entries.value.some((e) => !viewOf(e) || !ended(viewOf(e))))
watch(running, (v) => emit('running', v), { immediate: true })
watch(() => entries.value.length, (n) => emit('count', n), { immediate: true })

async function refresh() {
  clearTimeout(timer)
  for (const e of entries.value.filter((x) => !viewOf(x) || !ended(viewOf(x)))) {
    try { const j = (await APIS[e.ns].status(e.id)).jobs?.find((x) => x.job_id === e.id); if (j) views.value = { ...views.value, [e.id]: j } }
    catch (err) { actionError.value = `${e.label}: ${errorText(err)}` }
  }
  if (alive && running.value) timer = setTimeout(refresh, 2000)
}
/** Add a started job: { id, ns: 'volumesync' | 'sourcesync' | 'bucketsync', label, sub? }. */
function add(e) { entries.value = [...entries.value, e]; clearTimeout(timer); refresh() }
function clear() { clearTimeout(timer); entries.value = []; views.value = {}; actionError.value = '' }
async function cancel(e) {
  actionError.value = ''
  try { await APIS[e.ns].cancel(e.id) } catch (err) { actionError.value = `${e.label}: ${errorText(err)}` }
  refresh()
}
async function retry(e) {
  actionError.value = ''
  try { const r = await APIS[e.ns].retry(e.id); entries.value = entries.value.map((x) => (x.id === e.id ? { ...x, id: r.job_id } : x)); refresh() }
  catch (err) { actionError.value = `${e.label}: ${errorText(err)}` }
}
defineExpose({ add, clear, running })
onBeforeUnmount(() => { alive = false; clearTimeout(timer) })
</script>
