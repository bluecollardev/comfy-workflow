<template>
  <BModal :model-value="!!volume" :title="$t('volumes.browseTitle', { name: volume?.name || '' })" size="xl" scrollable lazy ok-only :ok-title="$t('panama.filesClose')" ok-variant="outline-light" data-testid="volume-files-modal" @update:model-value="(v) => !v && close()">
    <BAlert v-if="error" :model-value="true" variant="danger" data-testid="volume-files-error">{{ error }}</BAlert>
    <div v-if="!entries.size && !working" data-testid="volume-files-intro">
      <p class="small mb-2">{{ $t('volumes.browseIntro') }}</p>
      <!-- This volume could be read through RunPod's S3 API, but there are no S3 keys: say so before a pod is started and paid for -->
      <BAlert v-if="plan && plan.s3_note === 'keys' && plan.route !== 's3'" :model-value="true" variant="warning" class="small py-2 mb-3" data-testid="volume-s3-keys-alert">
        <i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('volumes.s3KeysPrompt', { dc: volume.datacenter }) }}
        <BButton variant="link" size="sm" class="p-0 ms-1 align-baseline" data-testid="volume-add-s3-keys" @click="addKeys">{{ $t('volumes.addS3Keys') }}</BButton>
      </BAlert>
      <div v-if="plan" class="small text-body-secondary mb-3" data-testid="volume-files-plan">{{ plan.route === 's3' ? $t('volumes.runsOnS3') : plan.route === 'active' ? $t('volumes.runsOnYours', { pod: plan.pod?.name }) : $t('volumes.runsOnTemp', { gpu: plan.gpu, price: plan.price_per_hour ?? '?' }) }}<span v-if="plan.s3_note && plan.s3_note !== 'keys'" class="d-block" data-testid="volume-s3-note">{{ $t(`volumes.s3Note.${plan.s3_note}`) }}</span><span v-else-if="plan.s3_note === 'keys' && !volume.s3" class="d-block" data-testid="volume-s3-note">{{ $t('volumes.s3Note.keys') }}</span></div>
      <BButton variant="primary" size="sm" data-testid="volume-files-start" @click="list('/workspace')"><i class="fa-solid fa-folder-tree me-1"></i>{{ plan && plan.route !== 's3' ? $t('volumes.browseStartPod') : $t('volumes.browseStart') }}</BButton>
    </div>
    <div v-else-if="!entries.size" class="small text-body-secondary" data-testid="volume-files-working"><BSpinner small class="me-2" />{{ $t('volumes.jobWorking', { state: job?.state || 'creating', pod: job?.pod_name || '' }) }}</div>
    <template v-else>
      <div class="d-flex align-items-center gap-2 mb-2 small flex-wrap" data-testid="volume-files-summary">
        <span class="text-body-secondary">{{ $t('volumes.browseSummary', { size: fmt(total), n: Math.max(0, entries.size - 1) }) }}</span>
        <span v-if="working" class="text-body-secondary" data-testid="volume-files-working"><BSpinner small class="me-1" />{{ $t('volumes.jobWorking', { state: job?.state || 'creating', pod: job?.pod_name || '' }) }}</span>
        <BButton size="sm" variant="outline-light" class="py-0 ms-auto" data-testid="volume-files-expand" @click="expandAll"><i class="fa-solid fa-angles-down me-1"></i>{{ $t('volumes.expandAll') }}</BButton>
        <BButton size="sm" variant="outline-light" class="py-0" data-testid="volume-files-collapse" @click="collapsed = new Set(openable)"><i class="fa-solid fa-angles-up me-1"></i>{{ $t('volumes.collapseAll') }}</BButton>
      </div>
      <div class="explorer rounded p-2" data-testid="volume-files-tree">
        <div v-for="r in rows" :key="r.path" class="d-flex align-items-center gap-2 small row-line" :style="{ paddingLeft: `${r.depth * 1.25}rem` }" data-testid="volume-files-row" :data-path="r.path" :data-depth="r.depth">
          <button v-if="r.hasKids" type="button" class="caret" :aria-expanded="!collapsed.has(r.path)" data-testid="volume-files-toggle" @click="toggle(r.path)"><i class="fa-solid" :class="collapsed.has(r.path) ? 'fa-chevron-right' : 'fa-chevron-down'"></i></button>
          <span v-else class="caret"></span>
          <i class="fa-regular text-body-secondary" :class="r.hasKids && !collapsed.has(r.path) ? 'fa-folder-open' : 'fa-folder'"></i>
          <span class="font-monospace name" :title="r.path">{{ r.label }}</span>
          <BButton v-if="r.edge" size="sm" variant="outline-light" class="py-0 ms-1 text-nowrap" :disabled="working" :title="$t('volumes.listInsideTitle')" data-testid="volume-files-inside" @click="list(r.path)"><i class="fa-solid fa-magnifying-glass-plus me-1"></i>{{ $t('volumes.listInside') }}</BButton>
          <span class="ms-auto text-body-secondary">{{ fmt(r.bytes) }}</span>
          <span class="share"><span class="share-bar" :style="{ width: `${r.share}%` }"></span></span>
        </div>
      </div>
    </template>
  </BModal>
</template>

<script setup>
/**
 * VolumeFilesModal: what is on a network volume, as folders you open and close, with sizes. A volume cannot be read without a pod or RunPod's S3 API, so a listing is a job (three levels
 * from the folder asked for); a folder at the edge of what was listed has "List inside", which lists that folder the same way and adds it to the tree. Read-only.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { volumesAPI } from '../api/volumes'
import { errorText } from '../stores/toast'
import { fmtBytes as fmt } from '../utils/studioTree'
import { useUiStore } from '../stores/ui'

const props = defineProps({ volume: { type: Object, default: null } })
const ui = useUiStore()
/** Opens Default Configuration at the S3 key fields; this window stays, so the volume can be listed afterwards. */
const addKeys = () => { ui.configFocus = 's3'; ui.configOpen = true }
const emit = defineEmits(['close'])
const job = ref(null), plan = ref(null), error = ref(''), working = ref(false)
const entries = ref(new Map())       // absolute path -> bytes, merged across the listings
const edge = ref(new Set())          // folders whose insides were not listed (they sat at the edge of a listing)
const collapsed = ref(new Set())
let timer = null, base = '/workspace'
const root = '/workspace'
const total = computed(() => entries.value.get(root) ?? 0)
const kidsOf = (p) => [...entries.value.keys()].filter((k) => k !== root && k.slice(0, k.lastIndexOf('/')) === p)
const openable = computed(() => [...entries.value.keys()].filter((k) => kidsOf(k).length))
const rows = computed(() => {
  const out = []
  const walk = (p, depth) => {
    for (const k of kidsOf(p).sort((a, b) => (entries.value.get(b) - entries.value.get(a)) || a.localeCompare(b))) {
      const hasKids = kidsOf(k).length > 0
      out.push({ path: k, label: k.slice(k.lastIndexOf('/') + 1), depth, bytes: entries.value.get(k), hasKids, edge: edge.value.has(k) && !hasKids && entries.value.get(k) > 0, share: total.value ? Math.max(1, Math.round((entries.value.get(k) / total.value) * 100)) : 0 })
      if (hasKids && !collapsed.value.has(k)) walk(k, depth + 1)
    }
  }
  walk(root, 0)
  return out
})
const toggle = (p) => { const s = new Set(collapsed.value); s.has(p) ? s.delete(p) : s.add(p); collapsed.value = s }
const expandAll = () => { collapsed.value = new Set() }
function stop() { if (timer) { clearInterval(timer); timer = null } }
/** Add a finished listing: its entries, and the folders at its far edge (three levels below the folder listed) as ones whose insides are still unknown. New folders start closed; the folder just listed opens. */
const seen = new Set()
function merge(j) {
  const m = new Map(entries.value), e = new Set(edge.value)
  const baseDepth = base.split('/').length
  for (const x of j.listing || []) { m.set(x.path, x.bytes); if (x.path.split('/').length - baseDepth >= 3) e.add(x.path) }
  e.delete(base)
  const c = new Set(collapsed.value)
  for (const k of m.keys()) if (!seen.has(k)) { seen.add(k); c.add(k) }
  c.delete(base)
  entries.value = m; edge.value = e; collapsed.value = c
}
async function poll() {
  try {
    job.value = await volumesAPI.job(job.value.id)
    if (['done', 'failed', 'cancelled'].includes(job.value.state)) { stop(); working.value = false; if (job.value.state === 'done') merge(job.value); else error.value = job.value.error || job.value.state }
  } catch (e) { stop(); working.value = false; error.value = errorText(e) }
}
async function list(path) {
  error.value = ''; working.value = true; base = path
  try { job.value = await volumesAPI.browse(props.volume.id, path === '/workspace' ? '' : path); timer = setInterval(poll, 2000) } catch (e) { working.value = false; error.value = errorText(e) }
}
function close() { stop(); if (job.value && working.value) volumesAPI.cancel(job.value.id).catch(() => {}); emit('close') }
watch(() => props.volume?.id, async (id) => { stop(); job.value = null; plan.value = null; error.value = ''; entries.value = new Map(); edge.value = new Set(); collapsed.value = new Set(); seen.clear(); working.value = false; if (id) { try { plan.value = await volumesAPI.plan(id) } catch { /* the start says why */ } } }, { immediate: true })
onBeforeUnmount(stop)
</script>

<style scoped>
.explorer { background: #20232a; max-height: 60vh; overflow: auto; }
.row-line { padding-top: 0.15rem; padding-bottom: 0.15rem; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
.caret { width: 1rem; background: none; border: 0; padding: 0; color: var(--bs-secondary-color); font-size: 0.7rem; }
.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.share { width: 5rem; height: 0.35rem; background: rgba(255, 255, 255, 0.08); border-radius: 0.2rem; overflow: hidden; flex: none; }
.share-bar { display: block; height: 100%; background: #508cff; }
</style>
