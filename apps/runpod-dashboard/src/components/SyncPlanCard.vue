<template>
  <div class="border rounded p-2 mb-3" data-testid="sync-target" :data-kind="kind" :data-phase="phase" :data-key="cardKey">
    <div class="fw-semibold mb-1" data-testid="sync-target-title"><i class="fa-solid me-2" :class="kind === 'volumesync' ? 'fa-cloud-arrow-up' : kind === 'bucketsync' ? 'fa-bucket' : 'fa-download'"></i>{{ title }}</div>
    <div v-if="editableDest" class="mb-2 small" data-testid="sync-target-dest-block">
      <label class="form-label mb-1" :for="`sync-dest-${cardKey}`">{{ $t('syncTargets.destination') }}</label>
      <BFormInput :id="`sync-dest-${cardKey}`" v-model.trim="destDir" size="sm" class="font-monospace" :placeholder="plan?.dest?.dir || $t('syncTargets.destPlaceholder')" data-testid="sync-dest-dir" @keydown.enter.prevent="changed" @blur="changed" />
    </div>
    <div v-if="phase === 'listing'" class="small d-flex align-items-center gap-2" data-testid="sync-target-listing"><BSpinner small />{{ $t('syncTargets.filesSoFar', { n: fmtN(seen) }) }}</div>
    <BAlert v-else-if="phase === 'failed'" :model-value="true" variant="danger" class="small py-2 mb-0" data-testid="sync-target-error"><i class="fa-solid fa-circle-xmark me-2"></i>{{ error || $t('syncTargets.planFailed') }}</BAlert>
    <div v-else-if="phase === 'cancelled'" class="small text-body-secondary" data-testid="sync-target-cancelled">{{ $t('syncTargets.planCancelled') }}</div>
    <template v-else-if="plan">
      <div v-if="plan.dest?.dir && !editableDest" class="mb-2 small" data-testid="sync-target-dest"><span class="text-body-secondary">{{ $t('syncTargets.destination') }}:</span> <span class="font-monospace text-break">{{ plan.dest.dir }}</span></div>
      <div v-if="plan.dest?.dirs?.length" class="mb-2 small" data-testid="sync-target-dirs">
        <div v-for="d in plan.dest.dirs" :key="d.name" class="text-break" data-testid="sync-target-dir"><span class="font-monospace">{{ d.name }}</span> <i class="fa-solid fa-arrow-right mx-1"></i> <span class="font-monospace">{{ d.dir }}</span></div>
      </div>
      <div v-if="plan.dest?.note" class="form-text mb-2" data-testid="sync-target-dest-note">{{ plan.dest.note }}</div>
      <div class="small" data-testid="sync-target-counts">{{ $t('syncTargets.counts', { files: fmtN(plan.files), bytes: formatBytes(plan.bytes) }) }}</div>
      <div class="small text-body-secondary" data-testid="sync-target-already">{{ $t('syncTargets.alreadyThere', { files: fmtN(plan.already_there.files), bytes: formatBytes(plan.already_there.bytes) }) }}</div>
      <div class="small" data-testid="sync-target-copy">{{ $t('syncTargets.toCopy', { files: fmtN(plan.to_copy.files), bytes: formatBytes(plan.to_copy.bytes) }) }}</div>
      <div v-if="plan.too_big?.files" class="small text-warning" data-testid="sync-target-toobig">{{ $t('syncTargets.tooBig', { n: plan.too_big.files }) }} <span class="font-monospace">{{ (plan.too_big.names || []).slice(0, 5).join(', ') }}</span></div>
      <div v-if="plan.conflicts?.files" class="small text-warning" data-testid="sync-target-conflicts">{{ $t('syncTargets.conflicts', { n: plan.conflicts.files }) }} <span class="font-monospace text-break">{{ (plan.conflicts.names || []).slice(0, 5).join(', ') }}</span></div>
      <div v-if="plan.unsafe?.files" class="small text-warning" data-testid="sync-target-unsafe">{{ $t('syncTargets.unsafe', { n: plan.unsafe.files }) }} <span class="font-monospace text-break">{{ (plan.unsafe.names || []).slice(0, 5).join(', ') }}</span></div>
      <div v-if="plan.excluded_weights" class="small text-body-secondary" data-testid="sync-target-weights">{{ $t('syncTargets.weights', { n: fmtN(plan.excluded_weights) }) }}</div>
      <div v-if="plan.folders?.length" class="mt-2" data-testid="sync-target-folders">
        <div class="small fw-semibold">{{ $t('syncTargets.leaveOut') }}</div>
        <div v-for="f in plan.folders" :key="f.name" class="d-flex align-items-center gap-2 small" data-testid="sync-target-folder" :data-name="f.name" :data-skipped="isOut(f) ? 'true' : undefined">
          <input :id="`sync-tf-${cardKey}-${f.name}`" type="checkbox" class="form-check-input mt-0" :checked="isOut(f)" :disabled="f.name === TOP || locked(f)" data-testid="sync-target-leave-out" :data-name="f.name" @change="toggleSkip(f.name, $event.target.checked)" />
          <label class="mb-0 font-monospace" :for="`sync-tf-${cardKey}-${f.name}`">{{ f.name }}</label>
          <span class="text-body-secondary">{{ $t('syncTargets.folderFacts', { files: fmtN(f.files), bytes: formatBytes(f.bytes) }) }}</span>
          <span v-if="f.dir" class="text-body-secondary font-monospace text-break" data-testid="sync-target-folder-dir"><i class="fa-solid fa-arrow-right me-1"></i>{{ f.dir }}</span>
          <span v-if="f.reason" class="text-warning" data-testid="sync-target-folder-reason">{{ f.reason }}</span>
        </div>
      </div>
      <div v-if="plan.pod" class="small mt-2" data-testid="sync-target-pod">{{ plan.pod.cost_per_hr == null ? $t('syncTargets.podNoPrice', { name: plan.pod.name }) : $t('syncTargets.pod', { name: plan.pod.name, price: plan.pod.cost_per_hr.toFixed(2) }) }}</div>
      <div v-if="plan.estimate" class="small" data-testid="sync-target-estimate">{{ $t('syncTargets.estimate', { hours: plan.estimate.hours, usd: plan.estimate.usd.toFixed(2) }) }}</div>
      <div v-if="plan.free_bytes != null" class="small" data-testid="sync-target-free">{{ $t('syncTargets.free', { bytes: formatBytes(plan.free_bytes) }) }}</div>
      <div v-if="!plan.can_start" class="small text-warning mt-1" data-testid="sync-target-reason"><i class="fa-solid fa-circle-info me-1"></i>{{ plan.reason || $t('syncTargets.cannotStart') }}</div>
    </template>
  </div>
</template>

<script setup>
/**
 * SyncPlanCard: one target's plan (docs/ADR-066, ADR-067). Plans (no pod, no cost), shows "N files so far" while it lists, then the counts, the folder table with leave-out
 * tick boxes (the hidden folders and test folders start left out) and the reason when it cannot start. Another tick or destination plans again; the window starts it.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { volumesyncAPI } from '../api/volumesync'
import { sourcesyncAPI } from '../api/sourcesync'
import { bucketsyncAPI } from '../api/bucketsync'
import { formatBytes } from '../sync-progress'
import { errorText } from '../stores/toast'

const props = defineProps({ kind: { type: String, required: true }, cardKey: { type: String, required: true }, request: { type: Object, required: true }, title: { type: String, required: true }, editableDest: Boolean })
const emit = defineEmits(['state'])
const TOP = '(this folder)'
const api = props.kind === 'volumesync' ? volumesyncAPI : props.kind === 'bucketsync' ? bucketsyncAPI : sourcesyncAPI
const phase = ref('listing'), seen = ref(0), error = ref(''), plan = ref(null), skip = ref([]), destDir = ref('')
let planId = '', run = 0, timer = null, deb = null, defaultsApplied = false
const fmtN = (x) => Number(x).toLocaleString('en-US')
/** Left out from the start: hidden folders and Binc's test folders. */
const defaultOut = (n) => /^\.(previews|proxies)$/.test(n) || /^_TEST_/.test(n) || /_tests$/i.test(n)
const isOut = (f) => skip.value.includes(f.name) || !!(f.skipped && f.reason)
const locked = (f) => !!(f.skipped && f.reason) && !skip.value.includes(f.name)
const publish = () => emit('state', { phase: phase.value, plan_id: planId, plan: plan.value, ready: phase.value === 'done' && !!plan.value?.can_start })

async function replan() {
  clearTimeout(timer); clearTimeout(deb); const mine = ++run
  if (planId && phase.value === 'listing') api.cancelPlan(planId).catch(() => undefined)
  phase.value = 'listing'; seen.value = 0; error.value = ''; plan.value = null; planId = ''; publish()
  try {
    const body = { ...props.request, skip_folders: [...skip.value], ...(props.editableDest && destDir.value ? { dest_dir: destDir.value } : {}) }
    const r = await api.plan(body)
    if (mine !== run) return
    planId = r.plan_id; poll(mine)
  } catch (e) { if (mine === run) { phase.value = 'failed'; error.value = errorText(e); publish() } }
}
async function poll(mine) {
  try {
    const r = await api.planStatus(planId)
    if (mine !== run) return
    seen.value = r.files_so_far || 0
    if (r.state === 'listing') { timer = setTimeout(() => poll(mine), 1000); return }
    if (r.state === 'done' && r.plan) {
      if (!defaultsApplied) {
        defaultsApplied = true
        const d = (r.plan.folders || []).filter((f) => f.name !== TOP && defaultOut(f.name)).map((f) => f.name)
        if (d.length) { skip.value = d; return replan() }
      }
      plan.value = r.plan; phase.value = 'done'; publish()
      if (!r.plan.can_start && props.kind !== 'sourcesync') timer = setTimeout(() => poll(mine), 5000)   // a pod may be resumed meanwhile: the core looks again
      return
    }
    phase.value = r.state === 'cancelled' ? 'cancelled' : 'failed'; error.value = r.error || ''; publish()
  } catch (e) { if (mine === run) { phase.value = 'failed'; error.value = errorText(e); publish() } }
}
function toggleSkip(name, on) {
  skip.value = on ? [...skip.value.filter((x) => x !== name), name] : skip.value.filter((x) => x !== name)
  clearTimeout(deb); deb = setTimeout(replan, 500)
}
let lastDest = ''
const changed = () => { if (destDir.value !== lastDest) { lastDest = destDir.value; replan() } }

watch(() => JSON.stringify(props.request), () => replan())
onMounted(replan)
onBeforeUnmount(() => { run++; clearTimeout(timer); clearTimeout(deb); if (planId && phase.value === 'listing') api.cancelPlan(planId).catch(() => undefined); emit('state', null) })
</script>
