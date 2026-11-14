<template>
  <BModal :model-value="!!volume" :title="$t('volumes.browseTitle', { name: volume?.name || '' })" size="xl" scrollable lazy ok-only :ok-title="$t('panama.filesClose')" ok-variant="outline-light" data-testid="volume-files-modal" @update:model-value="(v) => !v && close()">
    <BAlert v-if="error" :model-value="true" variant="danger" data-testid="volume-files-error">{{ error }}</BAlert>
    <div v-if="!job && !starting" data-testid="volume-files-intro">
      <p class="small mb-2">{{ $t('volumes.browseIntro') }}</p>
      <div v-if="plan" class="small text-body-secondary mb-3" data-testid="volume-files-plan">{{ plan.route === 's3' ? $t('volumes.runsOnS3') : plan.route === 'active' ? $t('volumes.runsOnYours', { pod: plan.pod?.name }) : $t('volumes.runsOnTemp', { gpu: plan.gpu, price: plan.price_per_hour ?? '?' }) }}<span v-if="plan.s3_note" class="d-block" data-testid="volume-s3-note">{{ $t(`volumes.s3Note.${plan.s3_note}`) }}</span></div>
      <BButton variant="primary" size="sm" data-testid="volume-files-start" @click="start"><i class="fa-solid fa-folder-tree me-1"></i>{{ $t('volumes.browseStart') }}</BButton>
    </div>
    <div v-else-if="!listing" class="small text-body-secondary" data-testid="volume-files-working"><BSpinner small class="me-2" />{{ $t('volumes.jobWorking', { state: job?.state || 'creating', pod: job?.pod_name || '' }) }}</div>
    <template v-else>
      <div class="small text-body-secondary mb-2" data-testid="volume-files-summary">{{ $t('volumes.browseSummary', { size: fmt(total), n: rows.length }) }}</div>
      <div class="explorer rounded p-2" data-testid="volume-files-tree">
        <div v-for="r in rows" :key="r.path" class="d-flex align-items-baseline gap-2 small" :style="{ paddingLeft: `${r.depth * 1.25}rem` }" data-testid="volume-files-row" :data-path="r.path">
          <i class="fa-regular fa-folder text-body-secondary"></i><span class="font-monospace">{{ r.label }}</span><span class="ms-auto text-body-secondary">{{ fmt(r.bytes) }}</span>
        </div>
      </div>
    </template>
  </BModal>
</template>

<script setup>
/** VolumeFilesModal: what is on a network volume, folders to depth 3 with sizes. A volume cannot be read without a pod, so Browse starts a short-lived pod (or uses yours on it), lists, and deletes it. Read-only. */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { volumesAPI } from '../api/volumes'
import { errorText } from '../stores/toast'
import { fmtBytes as fmt } from '../utils/studioTree'

const props = defineProps({ volume: { type: Object, default: null } })
const emit = defineEmits(['close'])
const job = ref(null), plan = ref(null), error = ref(''), starting = ref(false)
let timer = null
const listing = computed(() => (job.value?.state === 'done' ? job.value.listing || [] : null))
const rows = computed(() => (listing.value || []).filter((e) => e.path !== '/workspace').map((e) => { const rel = e.path.replace(/^\/workspace\//, ''); const parts = rel.split('/'); return { path: rel, label: parts[parts.length - 1], depth: parts.length - 1, bytes: e.bytes } }).sort((a, b) => a.path.localeCompare(b.path)))
const total = computed(() => (listing.value || []).find((e) => e.path === '/workspace')?.bytes ?? 0)
function stop() { if (timer) { clearInterval(timer); timer = null } }
async function poll() {
  try {
    job.value = await volumesAPI.job(job.value.id)
    if (['done', 'failed', 'cancelled'].includes(job.value.state)) { stop(); if (job.value.state !== 'done') error.value = job.value.error || job.value.state }
  } catch (e) { stop(); error.value = errorText(e) }
}
async function start() {
  error.value = ''; starting.value = true
  try { job.value = await volumesAPI.browse(props.volume.id); timer = setInterval(poll, 2000) } catch (e) { error.value = errorText(e) } finally { starting.value = false }
}
function close() { stop(); if (job.value && !['done', 'failed', 'cancelled'].includes(job.value.state)) volumesAPI.cancel(job.value.id).catch(() => {}); emit('close') }
watch(() => props.volume?.id, async (id) => { stop(); job.value = null; plan.value = null; error.value = ''; if (id) { try { plan.value = await volumesAPI.plan(id) } catch { /* the start says why */ } } }, { immediate: true })
onBeforeUnmount(stop)
</script>

<style scoped>
.explorer { background: #20232a; max-height: 60vh; overflow: auto; }
</style>
