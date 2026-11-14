<template>
  <BModal :model-value="!!volume" :title="$t('volumes.eraseTitle', { name: volume?.name || '' })" size="lg" scrollable lazy no-footer data-testid="volume-erase-modal" @update:model-value="(v) => !v && close()">
    <BAlert :model-value="true" variant="danger" class="small py-2">{{ $t('volumes.eraseWarn') }}</BAlert>
    <BAlert v-if="error" :model-value="true" variant="danger" data-testid="volume-erase-error">{{ error }}</BAlert>
    <div class="mb-2 fw-semibold small">{{ $t('volumes.eraseWhat') }}</div>
    <div v-for="e in options" :key="e.key" class="d-flex align-items-center gap-2 small mb-1" data-testid="volume-erase-option" :data-key="e.key">
      <input :id="`er-${e.key}`" v-model="picked" type="checkbox" class="form-check-input mt-0" :value="e.key" :disabled="busy" />
      <label :for="`er-${e.key}`" class="mb-0 flex-grow-1">{{ e.label }}</label>
      <span v-if="sizes[e.key] != null" class="text-body-secondary" data-testid="volume-erase-size">{{ fmt(sizes[e.key]) }}</span>
      <span v-if="e.key === 'models'" class="badge text-bg-warning fw-normal">{{ $t('volumes.eraseModelsWarn') }}</span>
    </div>
    <div class="d-flex align-items-center gap-2 my-3 small flex-wrap">
      <BButton variant="outline-light" size="sm" :disabled="busy || scanning" data-testid="volume-erase-scan" @click="scan"><BSpinner v-if="scanning" small class="me-1" /><i v-else class="fa-solid fa-ruler me-1"></i>{{ $t('volumes.eraseScan') }}</BButton>
      <span class="text-body-secondary">{{ $t('volumes.eraseScanNote') }}</span>
    </div>
    <BAlert v-if="plan && plan.s3_note === 'keys' && plan.route !== 's3' && volume?.s3" :model-value="true" variant="warning" class="small py-2" data-testid="volume-s3-keys-alert"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('volumes.s3KeysPrompt', { dc: volume.datacenter }) }}<BButton variant="link" size="sm" class="p-0 ms-1 align-baseline" data-testid="volume-add-s3-keys" @click="ui.configFocus = 's3'; ui.configOpen = true">{{ $t('volumes.addS3Keys') }}</BButton></BAlert>
    <div v-if="plan" class="small text-body-secondary mb-3" data-testid="volume-erase-plan">{{ plan.route === 's3' ? $t('volumes.runsOnS3') : plan.route === 'active' ? $t('volumes.runsOnYours', { pod: plan.pod?.name }) : $t('volumes.runsOnTemp', { gpu: plan.gpu, price: plan.price_per_hour ?? '?' }) }}<span v-if="plan.s3_note" class="d-block" data-testid="volume-s3-note">{{ $t(`volumes.s3Note.${plan.s3_note}`) }}</span></div>
    <div class="row g-2 align-items-center mb-2">
      <div class="col-sm-5"><label class="small mb-0" for="er-by">{{ $t('importRound.approvedBy') }}</label><BFormInput id="er-by" v-model="approvedBy" size="sm" data-testid="volume-erase-by" /></div>
      <div class="col-sm-7"><label class="small mb-0" for="er-name">{{ $t('volumes.eraseType', { name: volume?.name || '' }) }}</label><BFormInput id="er-name" v-model="typed" size="sm" autocomplete="off" data-testid="volume-erase-name" /></div>
    </div>
    <div v-if="job" class="small my-2" data-testid="volume-erase-job">
      <template v-if="job.state === 'done'"><i class="fa-solid fa-check text-success me-1"></i>{{ $t('volumes.eraseDone', { size: fmt(freedTotal) }) }}<span v-for="(b, k) in job.freed || {}" :key="k" class="ms-2 text-body-secondary">{{ k }}: {{ fmt(b) }}</span></template>
      <template v-else-if="['failed', 'cancelled'].includes(job.state)"><i class="fa-solid fa-triangle-exclamation text-danger me-1"></i>{{ job.error || job.state }}</template>
      <template v-else><BSpinner small class="me-2" />{{ $t('volumes.jobWorking', { state: job.state, pod: job.pod_name || '' }) }}</template>
    </div>
    <div class="d-flex justify-content-end gap-2">
      <BButton variant="outline-light" size="sm" @click="close">{{ $t('panama.filesClose') }}</BButton>
      <BButton variant="danger" size="sm" :disabled="!canErase" data-testid="volume-erase-go" @click="go"><i class="fa-solid fa-eraser me-1"></i>{{ $t('volumes.erase') }}</BButton>
    </div>
  </BModal>
</template>

<script setup>
/** EraseVolumeModal: empty chosen folders of a network volume (the volume and the folders stay). A list the app fixes (never a path from the user), rounds/inputs/workflows/output ticked and models not; sizes by a scan (a Browse job); the user's name and the volume's name typed back; refused while a pull or run is on the volume. */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { volumesAPI } from '../api/volumes'
import { errorText } from '../stores/toast'
import { fmtBytes as fmt } from '../utils/studioTree'
import { useUiStore } from '../stores/ui'

const props = defineProps({ volume: { type: Object, default: null } })
const ui = useUiStore()
const emit = defineEmits(['close', 'erased'])
const options = ref([]), picked = ref([]), sizes = ref({}), plan = ref(null), job = ref(null), error = ref(''), scanning = ref(false), typed = ref(''), approvedBy = ref('')
try { approvedBy.value = localStorage.getItem('runpod-manager.approved-by') || '' } catch { /* storage blocked */ }
let timer = null
const busy = computed(() => !!job.value && !['done', 'failed', 'cancelled'].includes(job.value.state))
const canErase = computed(() => !busy.value && picked.value.length > 0 && approvedBy.value.trim().length > 0 && typed.value === props.volume?.name)
const freedTotal = computed(() => Object.values(job.value?.freed || {}).reduce((a, b) => a + b, 0))
const stop = () => { if (timer) { clearInterval(timer); timer = null } }
async function track(onDone) {
  stop()
  timer = setInterval(async () => {
    try { job.value = await volumesAPI.job(job.value.id); if (['done', 'failed', 'cancelled'].includes(job.value.state)) { stop(); onDone(job.value) } } catch (e) { stop(); error.value = errorText(e) }
  }, 2000)
}
async function scan() {
  error.value = ''; scanning.value = true
  try {
    job.value = await volumesAPI.browse(props.volume.id)
    track((j) => { scanning.value = false; if (j.state !== 'done') { error.value = j.error || j.state; return } const by = Object.fromEntries((j.listing || []).map((e) => [e.path, e.bytes])); const n = {}; for (const o of options.value) n[o.key] = by[o.path] ?? 0; sizes.value = n })
  } catch (e) { scanning.value = false; error.value = errorText(e) }
}
async function go() {
  error.value = ''
  try { localStorage.setItem('runpod-manager.approved-by', approvedBy.value.trim()) } catch { /* storage blocked */ }
  try { job.value = await volumesAPI.erase(props.volume.id, picked.value, { approved_by: approvedBy.value.trim(), confirm_name: typed.value }); track((j) => { if (j.state === 'done') emit('erased', j) }) } catch (e) { error.value = errorText(e) }
}
function close() { stop(); if (busy.value) volumesAPI.cancel(job.value.id).catch(() => {}); emit('close') }
watch(() => props.volume?.id, async (id) => {
  stop(); job.value = null; plan.value = null; error.value = ''; typed.value = ''; sizes.value = {}; scanning.value = false
  if (!id) return
  // nothing is ticked for you: what goes is what you chose
  try { options.value = await volumesAPI.erasable(); picked.value = [] } catch (e) { error.value = errorText(e) }
  try { plan.value = await volumesAPI.plan(id) } catch { /* the erase says why */ }
}, { immediate: true })
onBeforeUnmount(stop)
</script>
