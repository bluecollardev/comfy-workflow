<template>
  <BModal :model-value="!!volume" :title="$t('volumes.cloneTitle', { name: volume?.name || '' })" size="lg" scrollable lazy no-footer data-testid="volume-clone-modal" @update:model-value="(v) => !v && close()">
    <p class="small text-body-secondary mb-3">{{ $t('volumes.cloneIntro') }}</p>
    <BAlert v-if="error" :model-value="true" variant="danger" class="small py-2" data-testid="volume-clone-error">{{ error }}</BAlert>
    <div class="d-flex gap-3 mb-3 small">
      <label class="d-flex align-items-center gap-2"><input v-model="kind" type="radio" value="existing" class="form-check-input mt-0" :disabled="busy" data-testid="volume-clone-kind-existing" />{{ $t('volumes.cloneExisting') }}</label>
      <label class="d-flex align-items-center gap-2"><input v-model="kind" type="radio" value="new" class="form-check-input mt-0" :disabled="busy" data-testid="volume-clone-kind-new" />{{ $t('volumes.cloneNew') }}</label>
    </div>
    <div v-if="kind === 'existing'" class="mb-3">
      <label class="small mb-1" for="cl-to">{{ $t('volumes.cloneTo') }}</label>
      <BFormSelect id="cl-to" v-model="toId" :options="existingOptions" size="sm" :disabled="busy" data-testid="volume-clone-to" />
      <div v-if="!others.length" class="small text-warning mt-1">{{ $t('volumes.cloneNoOthers') }}</div>
    </div>
    <div v-else class="row g-2 mb-3">
      <div class="col-sm-5"><label class="small mb-1" for="cl-dc">{{ $t('volumes.datacenter') }}</label><BFormSelect id="cl-dc" v-model="newDc" :options="dcOptions" size="sm" :disabled="busy" data-testid="volume-clone-dc" /></div>
      <div class="col-sm-4"><label class="small mb-1" for="cl-name">{{ $t('volumes.name') }}</label><BFormInput id="cl-name" v-model="newName" size="sm" maxlength="60" :disabled="busy" data-testid="volume-clone-name" /></div>
      <div class="col-sm-3"><label class="small mb-1" for="cl-size">GB</label><BFormInput id="cl-size" v-model.number="newSize" type="number" min="10" max="4000" size="sm" :disabled="busy" data-testid="volume-clone-size" /></div>
    </div>
    <div v-if="way" class="small mb-3 p-2 border rounded" data-testid="volume-clone-way">
      {{ $t(way.mode === 'push' ? 'volumes.clonePush' : way.mode === 'pull' ? 'volumes.clonePull' : 'volumes.cloneRsync', { from: volume.datacenter, to: targetDc }) }}<span v-if="kind === 'new'" class="d-block text-body-secondary" data-testid="volume-clone-cost">{{ $t('volumes.cloneCost', { usd: newCost }) }}</span>
    </div>
    <label class="d-flex align-items-center gap-2 small mb-3"><input v-model="includeInput" type="checkbox" class="form-check-input mt-0" :disabled="busy" data-testid="volume-clone-input" />{{ $t('volumes.cloneInput') }}</label>
    <div class="row g-2 align-items-end mb-2">
      <div class="col-sm-6"><label class="small mb-1" for="cl-by">{{ $t('importRound.approvedBy') }}</label><BFormInput id="cl-by" v-model="approvedBy" size="sm" :disabled="busy" data-testid="volume-clone-by" /></div>
      <div class="col-sm-6 text-end"><BButton variant="primary" size="sm" :disabled="!canStart" data-testid="volume-clone-go" @click="go"><i class="fa-solid fa-clone me-1"></i>{{ $t('volumes.cloneStart') }}</BButton></div>
    </div>
    <div v-if="job" class="small my-2" data-testid="volume-clone-job">
      <template v-if="job.state === 'done'"><i class="fa-solid fa-check text-success me-1"></i>{{ $t('volumes.cloneDone', { files: job.files, size: fmt(job.bytes_done || 0) }) }}</template>
      <template v-else-if="['failed', 'cancelled'].includes(job.state)"><i class="fa-solid fa-triangle-exclamation text-danger me-1"></i>{{ job.error || job.state }}</template>
      <template v-else><BSpinner small class="me-2" />{{ $t('volumes.jobWorking', { state: job.state, pod: job.pod_name || '' }) }}<span v-if="job.files"> · {{ $t('volumes.cloneProgress', { files: job.files, size: fmt(job.bytes_done || 0) }) }}</span></template>
    </div>
  </BModal>
</template>

<script setup>
/** CloneVolumeModal: copy a network volume's files into another volume in another datacenter (an existing one, or a new one made here). RunPod's S3 API does the copying, by a short pod on the side without one; at least one side must be in an S3 datacenter. The source is never changed. */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { volumesAPI } from '../api/volumes'
import { podsAPI } from '../api/pods'
import { settingsAPI } from '../api/settings'
import { errorText } from '../stores/toast'
import { fmtBytes as fmt } from '../utils/studioTree'
import { useVolumesStore } from '../stores/volumes'
import { t } from '../i18n'
import { volumeDatacenterOptions } from '../utils/datacenters'

const props = defineProps({ volume: { type: Object, default: null } })
const emit = defineEmits(['close'])
const store = useVolumesStore()
const kind = ref('existing'), toId = ref(''), newDc = ref(''), newName = ref(''), newSize = ref(250), includeInput = ref(false), approvedBy = ref(''), job = ref(null), error = ref('')
const dcs = ref([]), hasKeys = ref(false)   // RunPod S3 keys in Default Configuration: with them an S3 datacenter is reached through its S3 API, one pod; without, RunPod to RunPod over SSH, a pod on each volume
try { approvedBy.value = localStorage.getItem('runpod-manager.approved-by') || '' } catch { /* storage blocked */ }
let timer = null
const others = computed(() => store.volumes.filter((v) => v.id !== props.volume?.id))
const existingOptions = computed(() => [{ value: '', text: t('volumes.clonePick') }, ...others.value.map((v) => ({ value: v.id, text: `${v.name} · ${v.size_gb} GB · ${v.datacenter}${v.s3 ? ' · S3' : ''}` }))])
const dcOptions = computed(() => volumeDatacenterOptions(dcs.value.filter((d) => d.value !== props.volume?.datacenter), { value: '', text: t('volumes.pickDatacenter') }))
const targetDc = computed(() => (kind.value === 'existing' ? others.value.find((v) => v.id === toId.value)?.datacenter : newDc.value) || '')
const s3 = (dc) => store.volumes.some((v) => v.datacenter === dc && v.s3) || dcs.value.some((d) => d.value === dc && d.s3)
/** The same rule as the core: a target with the S3 API is pushed to from a pod on the source; else a source with it is pulled from by a pod on the target. */
const way = computed(() => { if (!targetDc.value) return null; if (hasKeys.value && s3(targetDc.value)) return { mode: 'push' }; if (hasKeys.value && props.volume.s3) return { mode: 'pull' }; return { mode: 'rsync' } })
const newCost = computed(() => Math.round((Math.min(newSize.value || 0, 1000) * 0.07 + Math.max((newSize.value || 0) - 1000, 0) * 0.05) * 100) / 100)
const busy = computed(() => !!job.value && !['done', 'failed', 'cancelled'].includes(job.value.state))
const canStart = computed(() => !busy.value && !!way.value && approvedBy.value.trim().length > 0 && (kind.value === 'existing' ? !!toId.value : !!newDc.value && newName.value.trim().length > 0 && newSize.value >= 10))
const stop = () => { if (timer) { clearInterval(timer); timer = null } }
async function go() {
  error.value = ''
  try { localStorage.setItem('runpod-manager.approved-by', approvedBy.value.trim()) } catch { /* storage blocked */ }
  const o = { approved_by: approvedBy.value.trim(), include_input: includeInput.value, ...(kind.value === 'existing' ? { to_volume_id: toId.value } : { new_volume: { name: newName.value.trim(), size_gb: newSize.value, datacenter: newDc.value } }) }
  try {
    job.value = await volumesAPI.clone(props.volume.id, o)
    timer = setInterval(async () => { try { job.value = await volumesAPI.job(job.value.id); if (['done', 'failed', 'cancelled'].includes(job.value.state)) { stop(); store.load() } } catch (e) { stop(); error.value = errorText(e) } }, 3000)
  } catch (e) { error.value = errorText(e); store.load() }
}
function close() { stop(); if (busy.value) volumesAPI.cancel(job.value.id).catch(() => {}); emit('close') }
watch(() => props.volume?.id, async (id) => {
  stop(); job.value = null; error.value = ''; toId.value = ''; newDc.value = ''; kind.value = 'existing'
  if (!id) return
  newName.value = `${props.volume.name}-clone`; newSize.value = props.volume.size_gb
  try { dcs.value = (await podsAPI.datacenters()).datacenters || [] } catch { /* the S3 flags come from the volumes then */ }
  try { hasKeys.value = !!(await settingsAPI.get()).s3_keys_set } catch { hasKeys.value = false }
}, { immediate: true })
onBeforeUnmount(stop)
</script>
