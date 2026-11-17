<template>
  <BModal v-model="open" :title="$t('runflows.title', { name: pod.name })" size="xl" scrollable no-footer data-testid="runflows-modal" @hidden="onHidden">
    <StepperNav v-if="!loading && !error && files.length" testid="runflows" :steps="stepItems" :active="step" @go="goStep" />
    <template v-if="step === 2 && hasOutputs">
      <div v-for="r in withOutputs" :key="r.path" class="mb-4" data-testid="runflows-outputs" :data-path="r.path">
        <div class="d-flex align-items-baseline gap-2 mb-2 small">
          <i class="fa-solid fa-check text-success"></i><span class="font-monospace fw-semibold text-truncate" :title="r.path">{{ r.path.split('/').pop() }}</span>
          <span class="text-body-secondary">{{ $t('runflows.tookSeconds', { s: r.seconds ?? 0 }) }} · {{ $t('runflows.filesCount', { n: r.files.length }) }}</span>
        </div>
        <OutputsGallery :files="r.files" :base="baseUrl" />
      </div>
      <div v-if="failedCount" class="small text-body-secondary mb-2" data-testid="runflows-outputs-failed">{{ $t('runflows.outputsFailed', { n: failedCount }) }}</div>
      <hr />
      <div class="d-flex gap-2 justify-content-end">
        <BButton variant="outline-light" size="sm" data-testid="runflows-back" @click="step = 1"><i class="fa-solid fa-arrow-left me-1"></i>{{ $t('importRound.back') }}</BButton>
        <BButton variant="outline-light" size="sm" data-testid="runflows-close" @click="open = false">{{ $t('pod.close') }}</BButton>
      </div>
    </template>
    <template v-else>
    <div v-if="loading" class="text-body-secondary small" data-testid="runflows-loading">{{ $t('runflows.loading') }}</div>
    <div v-else-if="error" class="alert alert-danger small py-2" data-testid="runflows-error">{{ error }}</div>
    <div v-else-if="!files.length" class="text-body-secondary small" data-testid="runflows-empty">{{ $t('runflows.empty') }}</div>
    <template v-else>
      <div class="rf-split" data-testid="runflows-split">
      <div class="rf-left" data-testid="runflows-left">
      <div class="d-flex align-items-center gap-2 mb-2 flex-wrap small">
        <button type="button" class="btn btn-sm btn-outline-light" data-testid="runflows-all" @click="setAll(true)">{{ $t('runflows.selectAll') }}</button>
        <button type="button" class="btn btn-sm btn-outline-light" data-testid="runflows-none" @click="setAll(false)">{{ $t('runflows.selectNone') }}</button>
        <span class="text-body-secondary" data-testid="runflows-count">{{ $t('runflows.selected', { n: picked.size, of: files.length }) }}</span>
      </div>
      <div v-for="g in groups" :key="g.group" class="mb-3" data-testid="runflows-group" :data-group="g.group">
        <label class="d-flex align-items-center gap-2 fw-semibold small mb-1">
          <input type="checkbox" class="form-check-input mt-0" :checked="g.files.every((f) => picked.has(f.path))" :indeterminate.prop="g.files.some((f) => picked.has(f.path)) && !g.files.every((f) => picked.has(f.path))" data-testid="runflows-group-toggle" @change="toggleGroup(g, $event.target.checked)" />
          <span class="font-monospace">{{ g.group || $t('runflows.top') }}</span>
          <span class="text-body-secondary fw-normal">{{ g.files.length }}</span>
        </label>
        <div v-for="f in g.files" :key="f.path" class="d-flex align-items-center gap-2 ms-4 small rf-row" :class="{ 'rf-sel': shownPath === f.path }" data-testid="runflows-file" :data-path="f.path" @click="selectedPath = f.path">
          <input :id="`rf-${f.path}`" type="checkbox" class="form-check-input mt-0" :checked="picked.has(f.path)" :disabled="running" @change="toggle(f.path, $event.target.checked)" />
          <label :for="`rf-${f.path}`" class="font-monospace flex-grow-1 mb-0 text-truncate" :title="f.path">{{ f.name }}</label>
          <span v-if="result(f.path)" class="badge" :class="badgeClass(result(f.path).state)" :title="result(f.path).error || ''" data-testid="runflows-result" :data-state="result(f.path).state">{{ $t(`runflows.state.${result(f.path).state}`) }}</span>
        </div>
        <div v-for="f in g.files.filter((x) => result(x.path)?.error)" :key="`e-${f.path}`" class="ms-5 small text-danger font-monospace" data-testid="runflows-error-line">{{ f.name }}: {{ result(f.path).error }}</div>
      </div>
      <div v-if="job?.error" class="alert alert-danger small py-2" data-testid="runflows-job-error">{{ job.error }}</div>
      <div v-if="job && job.state !== 'running'" class="small text-body-secondary" data-testid="runflows-summary">{{ $t('runflows.summary', { ok: job.ok, failed: job.failed, total: job.results.length }) }} · {{ $t('runflows.logged') }}</div>
      </div>
      <div class="rf-right" data-testid="runflows-pane">
        <div v-if="job" class="mb-3" data-testid="runflows-progress">
          <div class="d-flex align-items-baseline gap-2 small mb-1">
            <BSpinner v-if="running" small />
            <strong data-testid="runflows-progress-text">{{ $t('runflows.progress', { done: doneCount, total: results.length }) }}</strong>
            <span class="text-body-secondary ms-auto" data-testid="runflows-elapsed">{{ elapsedText }}</span>
          </div>
          <BProgress :value="pct" :max="100" height="8px" :variant="job.failed ? 'warning' : 'info'" :striped="running" :animated="running" data-testid="runflows-bar" :data-percent="pct" />
          <div v-if="current" class="small text-body-secondary mt-1 text-truncate" data-testid="runflows-now">{{ $t('runflows.now') }}: <span class="font-monospace">{{ current.path.split('/').pop() }}</span> · {{ sinceText(current.started_at || job.started_at) }}</div>
        </div>
        <div v-else class="small text-body-secondary mb-3" data-testid="runflows-pane-empty">{{ $t('runflows.paneEmpty') }}</div>
        <div v-if="shown" class="border rounded p-2 mb-3 small" data-testid="runflows-report" :data-path="shown.path" :data-state="shown.state">
          <div class="d-flex align-items-center gap-2 mb-1">
            <span class="font-monospace fw-semibold text-truncate" :title="shown.path">{{ shown.path.split('/').pop() }}</span>
            <span class="badge" :class="badgeClass(shown.state)">{{ $t(`runflows.state.${shown.state}`) }}</span>
          </div>
          <div v-if="shown.state === 'running'" class="text-body-secondary">{{ $t('runflows.fTime') }}: {{ sinceText(shown.started_at || job.started_at) }}</div>
          <div v-else-if="shown.seconds != null" class="text-body-secondary">{{ $t('runflows.fTime') }}: {{ $t('runflows.tookSeconds', { s: shown.seconds }) }}</div>
          <div v-if="shown.prompt_id" class="text-body-secondary">{{ $t('runflows.fPrompt') }}: <span class="font-monospace">{{ shown.prompt_id }}</span></div>
          <div v-if="shown.outputs != null" class="text-body-secondary">{{ $t('runflows.fOutputs') }}: {{ shown.outputs }}</div>
          <div v-if="shown.models?.length" class="text-body-secondary">{{ $t('runflows.fModels') }}: <span class="font-monospace">{{ shown.models.join('; ') }}</span></div>
          <div v-if="shown.error" class="text-danger font-monospace mt-1" data-testid="runflows-report-error">{{ shown.node ? `[node ${shown.node}] ` : '' }}{{ shown.error }}</div>
        </div>
        <div class="d-flex align-items-center gap-2 small mb-1">
          <div class="btn-group btn-group-sm" role="group">
            <button type="button" class="btn btn-outline-light" :class="{ active: logTab === 'run' }" data-testid="runflows-tab-run" @click="logTab = 'run'">{{ $t('runflows.logRun') }}</button>
            <button type="button" class="btn btn-outline-light" :class="{ active: logTab === 'pod' }" data-testid="runflows-tab-pod" @click="logTab = 'pod'">{{ $t('runflows.logPod') }}</button>
          </div>
          <label v-if="logTab === 'run'" class="ms-auto d-flex align-items-center gap-1 mb-0"><input v-model="logAll" type="checkbox" class="form-check-input mt-0" data-testid="runflows-log-all" />{{ $t('runflows.logAll') }}</label>
          <span v-else class="ms-auto text-body-secondary">{{ $t('runflows.podLogLive') }}</span>
        </div>
        <div v-if="logTab === 'run'" ref="logBox" class="rf-log font-monospace small border rounded p-2" data-testid="runflows-log">
          <div v-if="!logLines.length" class="text-body-secondary">{{ $t('runflows.noLog') }}</div>
          <div v-for="(l, n) in logLines" :key="n" :class="l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warning' : ''" data-testid="runflows-log-line"><span class="text-body-secondary">{{ clock(l.ts) }}</span> {{ l.text }}<span v-if="logAll && l.path" class="text-body-secondary"> · {{ l.path.split('/').pop() }}</span></div>
        </div>
        <div v-else ref="podBox" class="rf-log font-monospace small border rounded p-2" data-testid="runflows-podlog">
          <div v-if="podLog.error" class="text-warning" data-testid="runflows-podlog-error">{{ podLog.error }}</div>
          <div v-if="!podLog.entries.length && !podLog.error" class="text-body-secondary">{{ $t('runflows.noPodLog') }}</div>
          <div v-for="(l, n) in podLog.entries" :key="`${l.ts}-${n}`" :class="l.level === 'error' ? 'text-danger' : l.level === 'warning' ? 'text-warning' : ''" data-testid="runflows-podlog-line"><span class="text-body-secondary">{{ podClock(l.ts) }}</span> {{ (l.text || '').replace(/\r/g, '') }}</div>
        </div>
      </div>
      </div>
    </template>
    <template v-if="!loading && !error && files.length">
      <hr />
      <div class="d-flex gap-2 justify-content-end">
        <BButton variant="outline-light" size="sm" data-testid="runflows-close" @click="open = false">{{ $t('pod.close') }}</BButton>
        <BButton v-if="running" variant="outline-danger" size="sm" data-testid="runflows-cancel" @click="cancel">{{ $t('runflows.cancel') }}</BButton>
        <BButton variant="primary" size="sm" :disabled="running || !picked.size" data-testid="runflows-run" @click="run"><i class="fa-solid fa-play me-1"></i>{{ $t('runflows.run', { n: picked.size }) }}</BButton>
      </div>
    </template>
    </template>
  </BModal>
</template>

<script setup>
/**
 * Run workflows (ADR-037): a pod card's button opens this. It lists the graphs in the pod's Workflows panel grouped by folder (a shot or a round), all ticked, so the user picks which to run;
 * running converts each to an API graph, queues it on the pod, waits, and shows each one's result. Every error is also written to the History (see the core).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { runflowsAPI } from '../api/runflows'
import { historyAPI } from '../api/history'
import { useRunflowsStore } from '../stores/runflows'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import OutputsGallery from './OutputsGallery.vue'
import StepperNav from './StepperNav.vue'

const props = defineProps({ modelValue: { type: Boolean, default: false }, pod: { type: Object, required: true }, round: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue', 'finished'])
const open = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })
const store = useRunflowsStore()   // the ticked graphs, kept per pod: closing the window does not lose them
const files = ref([]), picked = ref(new Set()), loading = ref(false), error = ref(''), job = ref(null)
const running = computed(() => job.value?.state === 'running')
// The right pane: progress, the report of the selected graph, and the run's log. The selection follows the graph that is running until a row is clicked.
const selectedPath = ref(null), logAll = ref(false), logBox = ref(null), now = ref(Date.now())
const results = computed(() => job.value?.results || [])
const doneCount = computed(() => results.value.filter((r) => ['done', 'failed', 'skipped'].includes(r.state)).length)
const pct = computed(() => (results.value.length ? Math.round((doneCount.value / results.value.length) * 100) : 0))
const current = computed(() => results.value.find((r) => r.state === 'running') || null)
const shownPath = computed(() => selectedPath.value || current.value?.path || results.value.find((r) => r.state === 'failed')?.path || results.value[0]?.path || null)
const shown = computed(() => results.value.find((r) => r.path === shownPath.value) || null)
const logLines = computed(() => { const all = Array.isArray(job.value?.log) ? job.value.log : []; return logAll.value || !shownPath.value ? all : all.filter((l) => !l.path || l.path === shownPath.value) })
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const sinceText = (iso) => (iso ? mmss(now.value - Date.parse(iso)) : '')
const elapsedText = computed(() => (job.value ? mmss((job.value.finished_at ? Date.parse(job.value.finished_at) : now.value) - Date.parse(job.value.started_at)) : ''))
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour12: false })
const tick = setInterval(() => { now.value = Date.now() }, 1000)
// The pod's own ComfyUI log, line for line (every 2.5 s while its tab is open; the next read waits for the last, the pod's proxy can be slow while it works). Times from ComfyUI carry no zone: they are UTC.
const logTab = ref('run'), podLog = ref({ entries: [], error: '' }), podBox = ref(null)
const podClock = (ts) => (ts ? new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`).toLocaleTimeString([], { hour12: false }) : '')
let podTimer = null, podAlive = true
async function pollPodLog() {
  clearTimeout(podTimer)
  if (!podAlive || logTab.value !== 'pod' || step.value !== 1) return
  try {
    const r = await historyAPI.logs(props.pod.id, 'all', 400)
    const box = podBox.value, atEnd = !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 40
    podLog.value = { entries: r?.entries || [], error: '' }
    if (atEnd) { await nextTick(); if (podBox.value) podBox.value.scrollTop = podBox.value.scrollHeight }
  } catch (e) { podLog.value = { ...podLog.value, error: errorText(e) } }
  if (podAlive && logTab.value === 'pod' && step.value === 1) podTimer = setTimeout(pollPodLog, 2500)
}
watch(logTab, (t) => { if (t === 'pod') pollPodLog(); else clearTimeout(podTimer) })
watch(() => logLines.value.length, async () => { await nextTick(); if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight })
// Step 2: what the successful runs produced (the Outputs gallery). It opens by itself when a run ends with something to show, and can be left and re-entered.
const step = ref(1)
watch(step, (n) => { if (n === 1 && logTab.value === 'pod') pollPodLog() })   // the pod log is not shown on the Outputs step: it stops there and picks up again on return
const withOutputs = computed(() => (job.value?.results || []).filter((r) => r.state === 'done' && r.files?.length))
const hasOutputs = computed(() => withOutputs.value.length > 0 && job.value?.state !== 'running')
const outputCount = computed(() => withOutputs.value.reduce((n, r) => n + r.files.length, 0))
const failedCount = computed(() => (job.value?.results || []).filter((r) => r.state === 'failed').length)
const stepItems = computed(() => [{ label: t('runflows.stepRun'), done: !!job.value && job.value.state !== 'running' && job.value.ok > 0 }, { label: t('runflows.stepOutputs'), done: hasOutputs.value && step.value === 2, blocked: !hasOutputs.value, why: t('runflows.stepOutputsWait') }])
const goStep = (n) => { if (n === 2 && !hasOutputs.value) return; step.value = n }
const baseUrl = computed(() => job.value?.base_url || props.pod.web_ui_url || '')
watch(() => job.value?.state, (s, was) => { if (was === 'running' && s && s !== 'running') { emit('finished'); if (withOutputs.value.length) step.value = 2 } })
let timer = null

const groups = computed(() => {
  const m = new Map()
  for (const f of files.value) { if (!m.has(f.group)) m.set(f.group, []); m.get(f.group).push(f) }
  return [...m.entries()].map(([group, fs]) => ({ group, files: fs }))
})
const result = (path) => job.value?.results.find((r) => r.path === path) || null
const badgeClass = (s) => ({ done: 'text-bg-success', failed: 'text-bg-danger', running: 'text-bg-primary', pending: 'text-bg-secondary', skipped: 'text-bg-warning' }[s] || 'text-bg-secondary')

async function load() {
  loading.value = true; error.value = ''; job.value = null; step.value = 1; selectedPath.value = null
  try {
    files.value = (await runflowsAPI.list(props.pod.id)).workflows
    picked.value = new Set(files.value.map((f) => f.path))   // every graph ticked ...
    if (props.round) { const mine = files.value.filter((f) => `/${f.path}`.includes(`/${props.round}/`)); if (mine.length) picked.value = new Set(mine.map((f) => f.path)) }   // ... or every graph of the round it was opened from
    // A pod with a Shot set (the card's field) runs that shot: only its graphs are ticked. "All Shots", or no shot, leaves them all ticked; nothing matching also leaves them all.
    const shot = props.pod.shot && props.pod.shot !== 'All Shots' ? props.pod.shot.toLowerCase() : ''
    if (shot) { const mine = files.value.filter((f) => f.path.toLowerCase().includes(shot)); if (mine.length) picked.value = new Set(mine.map((f) => f.path)) }
    // What the person ticked last time wins over those defaults (only the graphs still in the panel), unless the window was opened from a round, which is an explicit choice.
    const saved = props.round ? null : store.pickedFor(props.pod.id)
    if (saved) { const have = new Set(files.value.map((f) => f.path)); picked.value = new Set(saved.filter((p) => have.has(p))) }
  }
  catch (e) { error.value = errorText(e); files.value = [] }
  finally { loading.value = false }
  await resume()
}
/** The run lives in the core, not in this window: ask for the pod's current one, show it, and carry on polling if it is still going (its graphs are the selection). */
async function resume() {
  try {
    const last = await runflowsAPI.latest(props.pod.id)
    if (!last || !last.id || !Array.isArray(last.results)) return   // no run on this pod (the core answers null)
    job.value = last
    if (last.state === 'running') { picked.value = new Set(last.results.map((r) => r.path)); poll() }
    else emit('finished')   // it ended while the window was closed: the card's Outputs button reads the pod again
  } catch { /* no run to show: the window just opens on the list */ }
}
const save = () => store.setPicked(props.pod.id, picked.value)
const toggle = (path, on) => { const s = new Set(picked.value); on ? s.add(path) : s.delete(path); picked.value = s; save() }
const toggleGroup = (g, on) => { const s = new Set(picked.value); for (const f of g.files) on ? s.add(f.path) : s.delete(f.path); picked.value = s; save() }
const setAll = (on) => { picked.value = on ? new Set(files.value.map((f) => f.path)) : new Set(); save() }

async function run() {
  error.value = ''; save(); selectedPath.value = null
  try { job.value = await runflowsAPI.run(props.pod.id, [...picked.value]); poll() } catch (e) { error.value = errorText(e) }
}
let pollFails = 0
function poll() {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    try { job.value = await runflowsAPI.job(job.value.id); pollFails = 0 }
    catch (e) { if (++pollFails >= 5) { error.value = errorText(e); return } poll(); return }   // one dropped answer does not stop the progress; five in a row do
    if (job.value.state === 'running') poll()
  }, 1500)
}
async function cancel() { try { job.value = await runflowsAPI.cancel(job.value.id) } catch (e) { error.value = errorText(e) } }
function onHidden() { clearTimeout(timer); emit('update:modelValue', false) }
onMounted(load)   // the card mounts this only when the button is pressed
onBeforeUnmount(() => { podAlive = false; clearTimeout(timer); clearTimeout(podTimer); clearInterval(tick) })
</script>

<style scoped>
.rf-split { display: flex; gap: 1rem; align-items: flex-start; }
.rf-left { flex: 0 0 44%; min-width: 0; }
.rf-right { flex: 1; min-width: 0; position: sticky; top: 0; }
.rf-row { cursor: pointer; border-radius: 0.25rem; }
.rf-sel { background: var(--bs-secondary-bg); }
.rf-log { height: 16rem; overflow: auto; background: var(--bs-tertiary-bg); }
@media (max-width: 991px) { .rf-split { flex-direction: column; } .rf-left { flex-basis: auto; width: 100%; } .rf-right { position: static; width: 100%; } }
</style>
