<template>
  <BModal :model-value="modelValue" :title="$t('sync.title', { name: pod.name })" size="lg" lazy scrollable data-testid="sync-modal" :ok-title="okTitle" :ok-variant="okVariant" :ok-disabled="okDisabled" :cancel-title="started ? $t('sync.close') : $t('picker.cancel')" cancel-variant="outline-light" @ok="onOk" @update:model-value="emit('update:modelValue', $event)" @show="open">
    <template v-if="!syncAPI.available">
      <BAlert :model-value="true" variant="info" class="mb-0" data-testid="sync-unavailable"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('sync.unavailable') }}</BAlert>
    </template>
    <template v-else-if="!started">
      <BAlert :model-value="true" variant="warning" data-testid="sync-confirm"><i class="fa-solid fa-triangle-exclamation me-2"></i>{{ $t('sync.confirm') }}</BAlert>
      <div class="mb-3">
        <BFormRadioGroup v-model="direction" :options="[{ value: 'push', text: $t('sync.push') }, { value: 'pull', text: $t('sync.pull') }]" button-variant="outline-light" size="sm" buttons data-testid="sync-direction" />
      </div>
      <div v-if="direction === 'push'" class="d-flex align-items-center gap-3 mb-2">
        <BFormCheckbox v-model="plates" switch data-testid="sync-plates">{{ $t('sync.plates') }}</BFormCheckbox>
        <BFormInput v-if="plates" v-model.trim="approvedBy" size="sm" style="max-width: 16rem" :placeholder="$t('sync.approvedBy')" data-testid="sync-approved-by" />
      </div>
      <div v-if="direction === 'push' && shared && plan.some((s) => s.key === 'comfy-shared')" class="mb-2" data-testid="sync-shared">
        <div class="small fw-semibold mb-1">{{ $t('sync.sharedTitle') }}</div>
        <div class="d-flex flex-wrap gap-3">
          <div v-for="d in SHARED" :key="d" class="form-check form-check-inline">
            <input :id="`sync-shared-${d}`" type="checkbox" class="form-check-input" :checked="(shared || []).includes(d)" :data-testid="`sync-shared-${d}`" @change="toggleShared(d, $event.target.checked)" />
            <label class="form-check-label" :for="`sync-shared-${d}`">{{ $t(`config.syncShared_${d}`) }}</label>
          </div>
        </div>
        <div class="form-text">{{ $t('sync.sharedHelp') }}</div>
      </div>
      <div v-if="direction === 'push' && plan.some((s) => s.key === 'project')" class="mb-2">
        <BFormCheckbox v-model="skipRenders" switch data-testid="sync-skip-renders">{{ $t('sync.skipRenders') }}</BFormCheckbox>
        <div class="form-text">{{ $t('sync.skipRendersHelp') }}</div>
        <BFormCheckbox v-model="skipTests" switch class="mt-2" data-testid="sync-skip-tests">{{ $t('sync.skipTests') }}</BFormCheckbox>
        <div class="form-text">{{ $t('sync.skipTestsHelp') }}</div>
      </div>
      <div v-if="!planError && plan.length" class="small mb-2" data-testid="sync-plan-counts">
        <template v-if="counts.pending"><BSpinner small class="me-1" />{{ $t('sync.counting') }}</template>
        <template v-else-if="counts.all.total_files != null">{{ $t(skipping ? 'sync.planCountsWithout' : 'sync.planCounts', { files: fmtN(shownCounts.total_files), bytes: formatBytes(shownCounts.total_bytes) }) }}</template>
        <template v-else>{{ $t('sync.noCount') }}</template>
      </div>
      <div v-if="planError" class="text-danger small mb-2" data-testid="sync-plan-error">{{ planError }}</div>
      <BAlert :model-value="true" :variant="transport.kind === 'none' ? 'danger' : 'info'" class="small py-2" data-testid="sync-transport"><i :class="transport.kind === 'none' ? 'fa-solid fa-ban' : 'fa-solid fa-route'" class="me-2"></i>{{ transport.kind === 'none' ? transport.reason : $t('sync.transport', { how: transport.reason }) }}</BAlert>
      <table v-if="!planError" class="table table-sm small mb-3" data-testid="sync-plan">
        <thead class="text-body-secondary"><tr><th>{{ $t('sync.folder') }}</th><th>{{ direction === 'push' ? $t('sync.from') : $t('sync.to') }}</th><th>{{ direction === 'push' ? $t('sync.to') : $t('sync.from') }}</th></tr></thead>
        <tbody>
          <tr v-for="s in plan" :key="s.key" data-testid="sync-step"><td>{{ s.key }}</td><td class="font-monospace text-break">{{ s.local }}</td><td class="font-monospace">{{ s.remote }}</td></tr>
          <tr v-if="!plan.length"><td colspan="3" class="text-body-secondary">{{ $t('sync.nothing') }}</td></tr>
        </tbody>
      </table>
    </template>
    <template v-else>
      <BAlert v-if="running" :model-value="true" variant="info" class="small py-2"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('sync.background') }}</BAlert>
      <div class="d-flex align-items-center gap-2 mb-2">
        <BSpinner v-if="running" small />
        <span data-testid="sync-status">{{ status }}</span>
      </div>
      <BProgress :value="progress.value" :max="100" height="8px" variant="warning" :striped="running || progress.indeterminate" :animated="running || progress.indeterminate" class="mb-2" data-testid="sync-bar" :data-indeterminate="progress.indeterminate ? 'true' : undefined" />
      <div v-if="detail" class="small text-body-secondary mb-2 text-break" data-testid="sync-detail">{{ detail }}</div>
      <div class="d-flex gap-3 small mb-2" data-testid="sync-counts">
        <span><i class="fa-solid fa-folder me-1"></i>{{ $t('sync.countSteps', { step: progress.step, steps: progress.steps }) }}</span>
        <span class="text-success"><i class="fa-solid fa-check me-1"></i>{{ $t('sync.countFiles', { n: fileCount }) }}</span>
        <span :class="problems.length ? 'text-danger' : 'text-body-secondary'"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('sync.countErrors', { n: problems.length }) }}</span>
      </div>
      <div v-if="problems.length" class="mb-2" data-testid="sync-errors">
        <div class="small fw-semibold text-danger mb-1">{{ $t('sync.errors') }}</div>
        <div v-for="(e, i) in problems" :key="i" class="small text-danger font-monospace text-break">{{ e.key }}: {{ e.text }}</div>
      </div>
      <div class="small fw-semibold mb-1">{{ $t('sync.files') }}</div>
      <div ref="fileList" class="small font-monospace bg-body-tertiary rounded p-2 mb-2" style="max-height: 30vh; overflow: auto" data-testid="sync-files">
        <div v-for="f in files" :key="f.n" class="text-break" data-testid="sync-file"><i class="fa-solid fa-check text-success me-1"></i>{{ f.key }}/{{ f.path }}</div>
        <div v-if="!fileCount" class="text-body-secondary">{{ $t('sync.noFilesYet') }}</div>
      </div>
      <details>
        <summary class="small text-body-secondary">{{ $t('sync.rawOutput') }}</summary>
        <pre ref="out" class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="max-height: 40vh; overflow: auto; white-space: pre-wrap" data-testid="sync-output"><div v-for="l in lines" :key="l.n">{{ l.text }}</div></pre>
      </details>
    </template>
  </BModal>
</template>

<script setup>
/**
 * SyncModal — from a card's Sync button: a confirmation naming what will be copied, then the run with
 * rsync's output streamed from the main process. Push copies the folders mapped on this PC onto the
 * pod's volume (plates only with a named yes); Pull brings renders back. The run outlives this window:
 * reopening shows the job's state; the card shows it as an action in flight.
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { syncAPI } from '../api/sync'
import { usePodsStore } from '../stores/pods'
import { barValue, detailParts, fold, formatBytes, fresh } from '../sync-progress'
import { t } from '../i18n'

const props = defineProps({ modelValue: Boolean, pod: { type: Object, required: true } })
const emit = defineEmits(['update:modelValue'])
const pods = usePodsStore()

const direction = ref('push')
const plates = ref(false)
const approvedBy = ref('')
const SHARED = ['input', 'models', 'output', 'workflows']
const shared = ref(null)   // the ComfyUI-Shared subfolders this run carries: this pod's own configuration, else the default's, until changed here
const skipTests = ref(true)   // Binc's 80_TEST-BUCKET stays home too
const skipRenders = ref(true)   // the shots' existing renders stay behind on a push; Pull brings renders back
const plan = ref([])
const transport = ref({ kind: 'none', reason: '' })
const planError = ref(null)
const counts = ref({ pending: false, all: {}, without_renders: undefined })   // from the listing passes: what the push would send, both ways
// the figure follows the switch: with the renders skipped, what the push sends without them (a pull, or no project step, has one figure)
const skipping = computed(() => (skipRenders.value || skipTests.value) && counts.value.without_renders?.total_files != null)
const shownCounts = computed(() => (skipping.value ? counts.value.without_renders : counts.value.all))
const fmtN = (x) => Number(x).toLocaleString('en-US')
let countRun = 0
async function loadCounts() {
  const mine = ++countRun
  counts.value = { pending: true, all: {}, without_renders: undefined }
  try { const r = await syncAPI.count(request()); if (mine === countRun) counts.value = { pending: false, ...r } }
  catch { if (mine === countRun) counts.value = { pending: false, all: {}, without_renders: undefined } }
}
const started = ref(false)   // a run is showing (in flight or finished): the confirmation gives way to it
const running = ref(false)
const out = ref(null)

// The run's events, folded as they arrive rather than kept and re-scanned: a push of the project tree is tens of
// thousands of lines, and filtering, reversing and joining them all again on every one froze the window.
const KEEP_FILES = 500, KEEP_LINES = 2000
const files = ref([])          // the last KEEP_FILES that landed, { n, key, path }
const fileCount = ref(0)
const problems = ref([])       // every rsync complaint, { key, text }
const lines = ref([])          // the raw output's last KEEP_LINES, { n, text }
const last = ref(null)         // the latest step, result or error: what the status says
const local = ref(fresh())     // the progress state, when the store has none for this pod (a run started elsewhere)
let n = 0
function reset() { files.value = []; fileCount.value = 0; problems.value = []; lines.value = []; last.value = null; local.value = fresh(); n = 0 }
let scrollQueued = false
function ingest(ev) {
  if (ev.kind === 'result') { last.value = ev; running.value = false; pods.syncEnded(props.pod.id); return }
  fold(local.value, ev)
  if (ev.kind === 'step' || ev.kind === 'listing' || ev.kind === 'error') last.value = ev
  if (ev.kind === 'error') { running.value = false; pods.syncEnded(props.pod.id) }
  if (ev.kind === 'file') { fileCount.value += 1; files.value.push({ n: ++n, key: ev.key, path: ev.path }); if (files.value.length > KEEP_FILES) files.value.shift() }
  if (ev.kind === 'problem' || ev.kind === 'error') problems.value.push({ key: ev.key, text: ev.text })
  const text = ev.kind === 'listing' ? `== listing ${ev.key}` : ev.kind === 'step' ? `== ${ev.key}: ${ev.local} -> ${ev.remote}` : ev.kind === 'step-done' ? `== ${ev.key}: ${ev.code === 0 ? 'done' : 'exit ' + ev.code}` : ev.text
  if (text != null) { lines.value.push({ n: ++n, text }); if (lines.value.length > KEEP_LINES) lines.value.shift() }
  if (!scrollQueued) { scrollQueued = true; nextTick(() => { scrollQueued = false; for (const el of [out.value, fileList.value]) if (el) el.scrollTop = el.scrollHeight }) }
}

const request = () => ({ pod_id: props.pod.id, direction: direction.value, plates: plates.value, approved_by: approvedBy.value, skip_renders: skipRenders.value, skip_tests: skipTests.value, ...(shared.value ? { shared: [...shared.value] } : {}) })
async function loadPlan() {
  planError.value = null
  try { const r = await syncAPI.plan(request()); plan.value = r.steps; transport.value = r.transport; if (shared.value === null && r.shared) shared.value = [...r.shared] } catch (e) { plan.value = []; planError.value = e.message }
  if (plan.value.length && transport.value.kind !== 'none') loadCounts()
}
watch([direction, plates, approvedBy], loadPlan)
watch([skipRenders, skipTests], () => { if (plan.value.length && transport.value.kind !== 'none') loadCounts() })   // the figure is for the switches as set
watch(shared, (v, old) => { if (old) { loadPlan() } }, { deep: true })   // another set of folders is another plan and another count

let off = () => {}
async function open() {
  shared.value = null
  await loadPlan()
  off()   // a second opening must not listen twice
  // Listen first, then ask for the job's state: everything the main process sent before it answered is in that
  // answer (one ordered channel), so the live events count only once the answer has been folded in.
  let primed = false
  off = syncAPI.onEvent((ev) => { if (ev.id === props.pod.id && primed) ingest(ev) })
  const state = await syncAPI.state(props.pod.id)
  reset(); for (const ev of state.events) ingest(ev)
  running.value = state.running; started.value = state.running || state.events.length > 0
  primed = true
}
onUnmounted(() => off())

async function start() {
  // clear and mark running before the call: a short (simulated) run sends every event before start() returns
  reset(); running.value = true; started.value = true
  pods.syncStarted(props.pod.id)
  const r = await syncAPI.start(request())
  if (!r.ok) { running.value = false; started.value = false; pods.syncEnded(props.pod.id) }
}
const cancel = () => syncAPI.cancel(props.pod.id)
function again() { reset(); started.value = false }
// The modal's own footer (Lucas, 2026-10-21: the built-in buttons): OK starts the copy, then stops it, then offers another run; Cancel closes, the run goes on in the app.
const okTitle = computed(() => (!started.value ? (direction.value === 'push' ? t('sync.startPush') : t('sync.startPull')) : running.value ? t('sync.cancelRun') : t('sync.again')))
const okVariant = computed(() => (!started.value ? 'warning' : running.value ? 'outline-danger' : 'outline-light'))
const okDisabled = computed(() => !started.value && (!plan.value.length || transport.value.kind === 'none' || (plates.value && !approvedBy.value)))
function onOk(e) { e.preventDefault(); if (!started.value) start(); else if (running.value) cancel(); else again() }

const state = computed(() => pods.sync[props.pod.id] || local.value)
const progress = computed(() => { const p = state.value; const v = barValue(p); return { step: p.step, steps: p.steps, value: v ?? 100, indeterminate: v == null } })
/** The line under the bar: the file index, ok and errors, bytes, rate, time left, and the file under way. */
const detail = computed(() => {
  const p = state.value
  if (p.listing || !p.step) return ''
  const parts = detailParts(p, t)
  if (running.value && p.currentFile) parts.push(t('sync.currentFile', { path: p.currentFile, percent: p.filePercent ?? 0 }))
  return parts.join(' · ')
})
const fileList = ref(null)
const status = computed(() => {
  const l = last.value
  if (!l) return t('sync.starting')
  if (l.kind === 'listing') return t('sync.listing', { folder: l.key })
  if (l.kind === 'error') return t('sync.failed', { error: l.text })
  if (l.kind === 'result') {
    const r = l.result
    return r.cancelled ? t('sync.cancelled') : r.failed ? t('sync.failedSteps', { failed: r.failed, steps: r.steps }) : r.warned ? t('sync.finishedWarnings', { steps: r.steps, warned: r.warned }) : t('sync.finished', { steps: r.steps })
  }
  return t('sync.copying', { folder: l.key })
})

function toggleShared(d, on) {
  const have = new Set(shared.value || [])
  if (on) have.add(d); else have.delete(d)
  shared.value = SHARED.filter((x) => have.has(x))
}
</script>
