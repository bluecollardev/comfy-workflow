<template>
  <BModal v-model="open" :title="podName ? $t('syncs.logsTitle', { name: podName }) : $t('syncs.logsTitleAll')" size="xl" scrollable no-footer data-testid="sync-logs-modal" @hidden="open = false">
    <div class="row g-3">
      <div class="col-md-4">
        <div class="small fw-semibold mb-1">{{ $t('syncs.runs') }}</div>
        <div v-if="runsError" class="alert alert-danger small py-2" data-testid="sync-logs-runs-error">{{ $t('syncs.failed', { why: runsError }) }} <a href="#" data-testid="sync-logs-runs-retry" @click.prevent="loadRuns">{{ $t('syncs.retry') }}</a></div>
        <div v-else-if="old" class="alert alert-info small py-2" data-testid="sync-logs-old">{{ $t('syncs.old') }}</div>
        <div v-else-if="runsLoaded && !runs.length" class="text-body-secondary small" data-testid="sync-logs-empty">{{ podId ? $t('syncs.noRuns') : $t('syncs.noRunsAll') }}</div>
        <div class="list-group" data-testid="sync-logs-runs">
          <button v-for="r in runs" :key="r.run_id" type="button" class="list-group-item list-group-item-action small" :class="{ active: r.run_id === selected }" data-testid="sync-logs-run" :data-run="r.run_id" :data-state="r.state" :data-selected="r.run_id === selected ? 'true' : 'false'" @click="select(r.run_id)">
            <div class="d-flex align-items-center gap-1 flex-wrap">
              <span class="badge" :class="isAuto(r.trigger) ? 'text-bg-info' : 'text-bg-secondary'" data-testid="sync-logs-trigger">{{ isAuto(r.trigger) ? $t('syncs.trigger_auto') : $t('syncs.trigger_manual') }}</span>
              <span>{{ $t(`syncs.direction_${r.direction}`) }}</span>
              <span class="badge" :class="stateBadge(r.state)" data-testid="sync-logs-state">{{ $t(`syncs.state_${r.state}`) }}</span>
              <span class="ms-auto text-nowrap opacity-75">{{ clock(r.started_at) }}</span>
            </div>
            <div class="opacity-75">{{ $t('syncs.runLine', { files: r.files ?? 0, bytes: fmtBytes(r.bytes ?? 0) }) }}</div>
            <div v-if="r.error" class="text-break" :class="r.run_id === selected ? '' : 'text-danger'" data-testid="sync-logs-run-error">{{ r.error }}</div>
          </button>
        </div>
      </div>
      <div class="col-md-8">
        <div v-if="!selected" class="text-body-secondary small" data-testid="sync-logs-select">{{ $t('syncs.selectRun') }}</div>
        <template v-else>
          <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
            <BFormRadioGroup v-model="level" :options="levels" button-variant="outline-light" size="sm" buttons data-testid="sync-logs-level" />
            <BFormInput v-model="query" size="sm" style="max-width: 14rem" :placeholder="$t('syncs.search')" data-testid="sync-logs-search" />
            <span v-if="following" class="badge text-bg-primary" data-testid="sync-logs-following"><i class="fa-solid fa-arrow-down me-1"></i>{{ $t('syncs.following') }}</span>
            <span class="ms-auto d-inline-flex gap-2 align-items-center">
              <span v-if="copied" class="small text-success" data-testid="sync-logs-copied"><i class="fa-solid fa-check me-1"></i>{{ $t('syncs.copied') }}</span>
              <BButton size="sm" variant="outline-light" :disabled="!lines.length" data-testid="sync-logs-copy" @click="copy"><i class="fa-regular fa-copy me-1"></i>{{ $t('syncs.copy') }}</BButton>
              <BButton size="sm" variant="outline-light" :disabled="!lines.length" data-testid="sync-logs-save" @click="save"><i class="fa-solid fa-file-arrow-down me-1"></i>{{ $t('syncs.save') }}</BButton>
            </span>
          </div>
          <div v-if="error" class="alert alert-danger small py-2 d-flex align-items-center gap-2" data-testid="sync-logs-error">
            <span class="flex-grow-1">{{ $t('syncs.failed', { why: error }) }}</span>
            <BButton size="sm" variant="outline-light" data-testid="sync-logs-retry" @click="reload">{{ $t('syncs.retry') }}</BButton>
          </div>
          <pre ref="pane" class="small bg-body-tertiary rounded p-2 mb-1 sync-log-pane" data-testid="sync-logs-pane" @scroll="onScroll"><div v-for="(l, i) in shown" :key="i" class="sync-log-line" :class="levelClass(l.level)" data-testid="sync-logs-line" :data-level="l.level"><span class="text-body-secondary">{{ clockSec(l.ts) }}</span> {{ l.text }}</div><div v-if="loading && !lines.length" class="text-body-secondary" data-testid="sync-logs-loading"><BSpinner small class="me-1" /></div><div v-else-if="!error && !lines.length" class="text-body-secondary" data-testid="sync-logs-nolines">{{ $t('syncs.noLines') }}</div><div v-else-if="!shown.length && lines.length" class="text-body-secondary" data-testid="sync-logs-nomatch">{{ $t('syncs.noMatch') }}</div></pre>
          <div class="d-flex align-items-center gap-2 small text-body-secondary">
            <span data-testid="sync-logs-count">{{ $t('syncs.shown', { shown: lines.length, total }) }}</span>
            <BButton v-if="total > lines.length" size="sm" variant="outline-primary" :disabled="loading" data-testid="sync-logs-more" @click="more">{{ $t('syncs.loadMore', { n: total - lines.length }) }}</BButton>
          </div>
        </template>
      </div>
    </div>
  </BModal>
</template>

<script setup>
/**
 * Sync logs (docs/ADR-046): this pod's runs on the left, the chosen run's log on the right, 500 lines at a time. A running run is read
 * again every second and the pane stays at its end unless the person scrolled up. A failed call shows its reason with Retry; none waits for ever.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { syncsAPI } from '../api/syncs'
import { saveTextFile } from '../api/configio'
import { fmtBytes } from '../utils/autosync'
import { clock, clockSec, isAuto, levelParam } from '../utils/syncs'

const props = defineProps({ modelValue: Boolean, podId: { type: String, default: '' }, podName: { type: String, default: '' }, runId: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()
const open = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })
const PAGE = 500, TIMEOUT_MS = 15000
const old = ref(false)   // the core predates the explorer
const runs = ref([]), runsLoaded = ref(false), runsError = ref('')
const selected = ref(props.runId || '')
const level = ref('all'), query = ref('')
const lines = ref([]), total = ref(0), loading = ref(false), error = ref(''), copied = ref(false)
const pane = ref(null)
const pinned = ref(true)   // at the end of the log: new lines keep it there
const levels = computed(() => [{ value: 'all', text: t('syncs.levelAll') }, { value: 'warn', text: t('syncs.levelWarn') }, { value: 'error', text: t('syncs.levelError') }])
const stateBadge = (s) => ({ running: 'text-bg-primary', queued: 'text-bg-secondary', done: 'text-bg-success', failed: 'text-bg-danger', cancelled: 'text-bg-dark' }[s] || 'text-bg-secondary')
const levelClass = (l) => (l === 'error' ? 'text-danger' : l === 'warn' ? 'text-warning' : '')
const errText = (e) => e?.response?.data?.detail || e?.message || String(e)
const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(t('syncs.timeout'))), TIMEOUT_MS))])
const current = computed(() => runs.value.find((r) => r.run_id === selected.value))
const isRunning = computed(() => ['running', 'queued'].includes(current.value?.state))
const following = computed(() => isRunning.value && pinned.value)
const shown = computed(() => { const q = query.value.trim().toLowerCase(); return q ? lines.value.filter((l) => `${l.text} ${l.path || ''}`.toLowerCase().includes(q)) : lines.value })

let alive = true, timer = null, ticks = 0, runsBusy = false, logBusy = false, logGen = 0

/** The pod's active run first (marked running), then the finished ones, newest first. */
async function loadRuns() {
  if (runsBusy) return
  runsBusy = true
  try {
    const [a, r] = await withTimeout(Promise.all([syncsAPI.active(), syncsAPI.recent(props.podId, 30)]))
    if (!alive) return
    old.value = a.old || r.old
    const act = a.items.filter((i) => !props.podId || i.pod_id === props.podId).map((i) => ({ run_id: i.run_id, pod_id: i.pod_id, direction: i.direction, trigger: i.trigger, state: i.state || 'running', started_at: i.started_at, files: i.files_done, bytes: i.bytes_done }))
    const ids = new Set(act.map((x) => x.run_id))
    const wasRunning = isRunning.value
    runs.value = [...act, ...r.runs.filter((x) => !ids.has(x.run_id))]
    runsError.value = ''; runsLoaded.value = true
    if (!selected.value && runs.value.length) select(runs.value[0].run_id)
    if (wasRunning && selected.value && !isRunning.value) followUp()   // it just finished: read the rest once more
  } catch (e) { if (alive) runsError.value = errText(e) } finally { runsBusy = false }
}
function select(id) {
  if (id === selected.value && lines.value.length) return
  selected.value = id; lines.value = []; total.value = 0; error.value = ''; pinned.value = true
  loadLog(true)
}
/** Reads from the start (reset) or from the first line not yet loaded. */
async function loadLog(reset) {
  if (!selected.value) return
  if (logBusy && !reset) return
  const gen = ++logGen, id = selected.value
  logBusy = true; loading.value = true
  try {
    const r = await withTimeout(syncsAPI.log(id, { offset: reset ? 0 : lines.value.length, limit: PAGE, level: levelParam(level.value) }))
    if (!alive || gen !== logGen) return
    lines.value = reset ? r.lines : [...lines.value, ...r.lines]; total.value = r.total; error.value = ''
    toEnd()
  } catch (e) { if (alive && gen === logGen) error.value = errText(e) } finally { if (gen === logGen) { logBusy = false; loading.value = false } }
}
const reload = () => { logBusy = false; loadLog(true) }
const more = () => loadLog(false)
/** A running run: catch up with what was written since the last second (up to 10 pages in one go). */
async function followUp() { for (let i = 0; i < 10 && alive && selected.value && !error.value; i++) { const n = lines.value.length; await loadLog(false); if (lines.value.length >= total.value || lines.value.length === n) break } }
function toEnd() { if (pinned.value) nextTick(() => { if (pane.value) pane.value.scrollTop = pane.value.scrollHeight }) }
function onScroll() { const p = pane.value; if (p) pinned.value = p.scrollHeight - p.scrollTop - p.clientHeight < 24 }
async function tick() {
  if (!alive) return
  ticks++
  if (runs.value.some((r) => ['running', 'queued'].includes(r.state)) || ticks % 5 === 0 || !runsLoaded.value) await loadRuns()
  if (isRunning.value && !error.value) await followUp()
  if (alive) timer = setTimeout(tick, 1000)
}
watch(level, () => { lines.value = []; total.value = 0; pinned.value = true; loadLog(true) })
async function copy() {
  try { await navigator.clipboard.writeText(text()); copied.value = true; setTimeout(() => { copied.value = false }, 2000) } catch (e) { error.value = errText(e) }
}
const text = () => lines.value.map((l) => `${l.ts || ''} ${String(l.level || '').toUpperCase()} ${l.text}`.trim()).join('\n') + '\n'
async function save() { try { await saveTextFile(`sync-${selected.value}.log`, text()) } catch (e) { error.value = errText(e) } }
onMounted(async () => { await loadRuns(); if (selected.value && !lines.value.length && !logBusy) await loadLog(true); if (alive) timer = setTimeout(tick, 1000) })
onBeforeUnmount(() => { alive = false; clearTimeout(timer) })
</script>

<style scoped>
.sync-log-pane { max-height: 55vh; min-height: 12rem; overflow: auto; white-space: pre-wrap; font-family: var(--bs-font-monospace); }
.sync-log-line { word-break: break-word; }
</style>
