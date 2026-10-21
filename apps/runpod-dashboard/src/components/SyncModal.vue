<template>
  <BModal :model-value="modelValue" :title="$t('sync.title', { name: pod.name })" size="lg" lazy scrollable hide-footer data-testid="sync-modal" @update:model-value="emit('update:modelValue', $event)" @show="open">
    <template v-if="!syncAPI.available">
      <BAlert :model-value="true" variant="info" class="mb-0" data-testid="sync-unavailable"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('sync.unavailable') }}</BAlert>
    </template>
    <template v-else-if="!running && !events.length">
      <BAlert :model-value="true" variant="warning" data-testid="sync-confirm"><i class="fa-solid fa-triangle-exclamation me-2"></i>{{ $t('sync.confirm') }}</BAlert>
      <div class="mb-3">
        <BFormRadioGroup v-model="direction" :options="[{ value: 'push', text: $t('sync.push') }, { value: 'pull', text: $t('sync.pull') }]" button-variant="outline-light" size="sm" buttons data-testid="sync-direction" />
      </div>
      <div v-if="direction === 'push'" class="d-flex align-items-center gap-3 mb-2">
        <BFormCheckbox v-model="plates" switch data-testid="sync-plates">{{ $t('sync.plates') }}</BFormCheckbox>
        <BFormInput v-if="plates" v-model.trim="approvedBy" size="sm" style="max-width: 16rem" :placeholder="$t('sync.approvedBy')" data-testid="sync-approved-by" />
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
      <div class="d-flex gap-2 justify-content-end">
        <BButton variant="outline-light" size="sm" @click="emit('update:modelValue', false)">{{ $t('picker.cancel') }}</BButton>
        <BButton variant="warning" size="sm" :disabled="!plan.length || transport.kind === 'none' || (plates && !approvedBy)" data-testid="sync-start" @click="start">{{ direction === 'push' ? $t('sync.startPush') : $t('sync.startPull') }}</BButton>
      </div>
    </template>
    <template v-else>
      <BAlert v-if="running" :model-value="true" variant="info" class="small py-2"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('sync.background') }}</BAlert>
      <div class="d-flex align-items-center gap-2 mb-2">
        <BSpinner v-if="running" small />
        <span data-testid="sync-status">{{ status }}</span>
        <BButton v-if="running" size="sm" variant="outline-danger" class="ms-auto" data-testid="sync-cancel" @click="cancel">{{ $t('sync.cancelRun') }}</BButton>
        <BButton v-else size="sm" variant="outline-light" class="ms-auto" data-testid="sync-again" @click="events = []">{{ $t('sync.again') }}</BButton>
      </div>
      <BProgress :value="progress.value" :max="100" height="8px" variant="warning" :striped="running" :animated="running" class="mb-2" data-testid="sync-bar" />
      <div class="d-flex gap-3 small mb-2" data-testid="sync-counts">
        <span><i class="fa-solid fa-folder me-1"></i>{{ $t('sync.countSteps', { step: progress.step, steps: progress.steps }) }}</span>
        <span class="text-success"><i class="fa-solid fa-check me-1"></i>{{ $t('sync.countFiles', { n: files.length }) }}</span>
        <span :class="problems.length ? 'text-danger' : 'text-body-secondary'"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('sync.countErrors', { n: problems.length }) }}</span>
      </div>
      <div v-if="problems.length" class="mb-2" data-testid="sync-errors">
        <div class="small fw-semibold text-danger mb-1">{{ $t('sync.errors') }}</div>
        <div v-for="(e, i) in problems" :key="i" class="small text-danger font-monospace text-break">{{ e.key }}: {{ e.text }}</div>
      </div>
      <div class="small fw-semibold mb-1">{{ $t('sync.files') }}</div>
      <div ref="fileList" class="small font-monospace bg-body-tertiary rounded p-2 mb-2" style="max-height: 30vh; overflow: auto" data-testid="sync-files">
        <div v-for="(f, i) in files.slice(-500)" :key="i" class="text-break" data-testid="sync-file"><i class="fa-solid fa-check text-success me-1"></i>{{ f.key }}/{{ f.path }}</div>
        <div v-if="!files.length" class="text-body-secondary">{{ $t('sync.noFilesYet') }}</div>
      </div>
      <details>
        <summary class="small text-body-secondary">{{ $t('sync.rawOutput') }}</summary>
        <pre ref="out" class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="max-height: 40vh; overflow: auto; white-space: pre-wrap" data-testid="sync-output">{{ outputText }}</pre>
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
import { t } from '../i18n'

const props = defineProps({ modelValue: Boolean, pod: { type: Object, required: true } })
const emit = defineEmits(['update:modelValue'])
const pods = usePodsStore()

const direction = ref('push')
const plates = ref(false)
const approvedBy = ref('')
const plan = ref([])
const transport = ref({ kind: 'none', reason: '' })
const planError = ref(null)
const events = ref([])
const running = ref(false)
const out = ref(null)

const request = () => ({ pod_id: props.pod.id, direction: direction.value, plates: plates.value, approved_by: approvedBy.value })
async function loadPlan() {
  planError.value = null
  try { const r = await syncAPI.plan(request()); plan.value = r.steps; transport.value = r.transport } catch (e) { plan.value = []; planError.value = e.message }
}
watch([direction, plates, approvedBy], loadPlan)

let off = () => {}
async function open() {
  await loadPlan()
  const state = await syncAPI.state(props.pod.id)
  events.value = state.events; running.value = state.running
  off = syncAPI.onEvent((ev) => {
    if (ev.id !== props.pod.id) return
    events.value.push(ev)
    if (ev.kind === 'result' || ev.kind === 'error') { running.value = false; pods.syncEnded(props.pod.id) }
    nextTick(() => { for (const el of [out.value, fileList.value]) if (el) el.scrollTop = el.scrollHeight })
  })
}
onUnmounted(() => off())

async function start() {
  // clear and mark running before the call: a short (simulated) run sends every event before start() returns
  events.value = []; running.value = true
  pods.syncStarted(props.pod.id)
  const r = await syncAPI.start(request())
  if (!r.ok) { running.value = false; pods.syncEnded(props.pod.id) }
}
const cancel = () => syncAPI.cancel(props.pod.id)

const files = computed(() => events.value.filter((e) => e.kind === 'file'))
const problems = computed(() => events.value.filter((e) => e.kind === 'problem' || e.kind === 'error'))
const progress = computed(() => {
  const p = pods.sync[props.pod.id]
  if (p) return { step: p.step, steps: p.steps, value: p.steps ? Math.round((((p.step - 1) + p.percent / 100) / p.steps) * 100) : 0 }
  const steps = events.value.find((e) => e.kind === 'plan')?.steps?.length || 0
  const step = events.value.filter((e) => e.kind === 'step').length
  const last = [...events.value].reverse().find((e) => e.kind === 'progress')
  return { step, steps, value: steps ? Math.round((((step - 1) + (last?.percent || 0) / 100) / steps) * 100) : 0 }
})
const fileList = ref(null)
const status = computed(() => {
  const last = [...events.value].reverse().find((e) => e.kind === 'result' || e.kind === 'error' || e.kind === 'step')
  if (!last) return t('sync.starting')
  if (last.kind === 'error') return t('sync.failed', { error: last.text })
  if (last.kind === 'result') return last.result.cancelled ? t('sync.cancelled') : last.result.failed ? t('sync.failedSteps', { failed: last.result.failed, steps: last.result.steps }) : t('sync.finished', { steps: last.result.steps })
  return t('sync.copying', { folder: last.key })
})
const outputText = computed(() => events.value.filter((e) => e.kind !== 'plan' && e.kind !== 'result').map((e) => e.kind === 'step' ? `== ${e.key}: ${e.local} -> ${e.remote}` : e.kind === 'step-done' ? `== ${e.key}: ${e.code === 0 ? 'done' : 'exit ' + e.code}` : e.text).join('\n'))
</script>
