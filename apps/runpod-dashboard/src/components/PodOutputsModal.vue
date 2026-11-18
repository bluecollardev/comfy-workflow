<template>
  <BModal :model-value="true" :title="$t('outputs.title', { name: pod.name })" size="xl" scrollable lazy no-footer data-testid="pod-outputs-modal" @update:model-value="(v) => !v && $emit('close')">
    <div class="d-flex align-items-center gap-2 mb-2" data-testid="pod-outputs-toolbar">
      <span class="small text-body-secondary">{{ $t('outputs.buttonTitle') }}</span>
      <div class="ms-auto d-flex gap-2">   <!-- the buttons sit at the right, whatever else shows -->
        <BButton v-if="all.length > 1" variant="outline-light" size="sm" class="text-nowrap" :disabled="!canZip || zipping || !anyBase" :title="canZip ? '' : $t('outputs.zipApp')" data-testid="pod-outputs-zip-all" @click="zipAll"><BSpinner v-if="zipping" small class="me-1" /><i v-else class="fa-solid fa-file-zipper me-1"></i>{{ $t('outputs.zipAllRuns') }}</BButton>
        <BButton variant="outline-light" size="sm" class="text-nowrap" data-testid="pod-outputs-clear-previews" :title="$t('outputs.dpx.clearCacheTitle')" @click="clearPreviews"><i class="fa-regular fa-trash-can me-1"></i>{{ $t('outputs.dpx.cached', { n: cachedCount }) }} · {{ $t('outputs.dpx.clearCache') }}</BButton>
        <BButton variant="outline-light" size="sm" class="text-nowrap" data-testid="pod-outputs-previews" :title="$t('outputs.dpx.previewsTitle')" @click="previewsOpen = true"><BSpinner v-if="previewBus.batch" small class="me-1" /><i v-else class="fa-regular fa-images me-1"></i>{{ previewBus.batch ? $t('outputs.dpx.generating', { done: batchDone, total: previewBus.batchTotal }) : $t('outputs.dpx.previews') }}</BButton>
        <BButton variant="outline-light" size="sm" class="text-nowrap" data-testid="pod-outputs-refresh" @click="refresh"><i class="fa-solid fa-rotate me-1"></i>{{ $t('outputs.refresh') }}</BButton>
      </div>
    </div>
    <div v-if="!base && !s3ok" class="alert alert-warning py-2 small" data-testid="pod-outputs-offline">{{ $t('outputs.startPod', { volume: volumeName || pod.name }) }}</div>
    <div v-if="volumeId && vol.loaded && !vol.ok && (!base || vol.failed)" class="alert alert-info py-2 small d-flex align-items-center gap-2 flex-wrap" data-testid="pod-outputs-s3-unavailable">
      <span data-testid="pod-outputs-volume-error">{{ vol.restart ? $t('outputs.dpx.reason.restart') : vol.keysMissing ? $t('outputs.s3Keys') : $t('outputs.volumeError', { reason: vol.reason }) }}</span>
      <BButton v-if="vol.keysMissing" variant="outline-primary" size="sm" data-testid="pod-outputs-open-config" @click="openConfig">{{ $t('outputs.s3KeysButton') }}</BButton>
    </div>
    <div v-if="volumeId && (vol.ok || vol.loading)" class="mb-3" data-testid="pod-outputs-volume">
      <nav class="d-flex align-items-center gap-1 flex-wrap small mb-1" :aria-label="$t('outputs.volumeBreadcrumb')" data-testid="pod-outputs-breadcrumb">
        <i class="fa-solid fa-hard-drive text-body-secondary me-1"></i>
        <BButton variant="link" size="sm" class="p-0" data-testid="pod-outputs-crumb" data-prefix="" @click="go('')">{{ $t('outputs.volumeRoot') }}</BButton>
        <template v-for="c in crumbs" :key="c.prefix"><span class="text-body-secondary">›</span><BButton variant="link" size="sm" class="p-0" data-testid="pod-outputs-crumb" :data-prefix="c.prefix" @click="go(c.prefix)">{{ c.name }}</BButton></template>
      </nav>
      <div class="d-flex align-items-center gap-2 flex-wrap small mb-2" data-testid="pod-outputs-scope">
        <span class="text-body-secondary">{{ $t('outputs.scope') }}</span>
        <div class="btn-group btn-group-sm" role="group">
          <button type="button" class="btn btn-outline-light" :class="{ active: scope === 'all' }" data-testid="pod-outputs-scope-all" :title="$t('outputs.scopeAllTitle')" @click="scope = 'all'">{{ $t('outputs.scopeAll') }}</button>
          <button type="button" class="btn btn-outline-light" :class="{ active: scope === 'folder' }" data-testid="pod-outputs-scope-folder" :title="$t('outputs.scopeFolderTitle')" @click="scope = 'folder'">{{ vol.prefix ? $t('outputs.scopeFolder', { path: vol.prefix }) : $t('outputs.scopeFolderRoot') }}</button>
        </div>
        <span class="text-body-secondary" data-testid="pod-outputs-scope-count">{{ $t('outputs.scopeCount', { n: all.length, files: fileCount(all), total: fileCount(mergeWithVolume(shotRuns, vol.runs)) }) }}<template v-if="scope === 'folder' && hiddenByFolder"> · {{ $t('outputs.scopeHidden', { n: hiddenByFolder }) }}</template></span>
      </div>
      <div v-if="vol.loading" class="text-body-secondary small" data-testid="pod-outputs-volume-loading"><BSpinner small class="me-1" />{{ $t('outputs.volumeLoading', { path: `output/${vol.prefix}`.replace(/\/$/, '') }) }}</div>
      <div v-else>
        <div class="d-flex gap-1 flex-wrap" data-testid="pod-outputs-folders"><BButton v-for="f in vol.folders" :key="f" variant="outline-light" size="sm" data-testid="pod-outputs-folder" :data-name="f" @click="go(vol.prefix ? `${vol.prefix}/${f}` : f)"><i class="fa-regular fa-folder me-1"></i>{{ f }}</BButton></div>
        <div v-if="vol.capped" class="text-warning small mt-1" data-testid="pod-outputs-capped">{{ $t('outputs.volumeCapped', { n: vol.shownCount, total: vol.total }) }}</div>
        <div v-if="vol.note" class="text-body-secondary small mt-1" data-testid="pod-outputs-volume-note">{{ vol.note }}</div>
      </div>
    </div>
    <label v-if="shot" class="d-flex align-items-center gap-2 small mb-3" data-testid="pod-outputs-shot-filter">
      <input v-model="onlyShot" type="checkbox" class="form-check-input mt-0" />{{ $t('outputs.onlyShot', { shot }) }}
      <span v-if="onlyShot && hidden" class="text-body-secondary">{{ $t('outputs.hiddenRuns', { n: hidden }) }}</span>
    </label>
    <div v-if="!all.length && !vol.loading" class="text-body-secondary small" data-testid="pod-outputs-empty">{{ vol.ok ? $t('outputs.volumeNoRuns') : $t(onlyShot && runs.length ? 'outputs.noRunsShot' : 'outputs.noRuns', { shot }) }}</div>
    <div v-for="r in all" :key="r.prompt_id" class="mb-4" data-testid="pod-outputs-run" :data-prompt="r.prompt_id" :data-source="r.source || 'pod'">
      <div class="d-flex align-items-baseline gap-2 flex-wrap mb-2 small" data-testid="pod-outputs-run-title">
        <template v-if="r.source === 'volume'"><span class="fw-semibold font-monospace" data-testid="pod-outputs-folder-name" :title="`output/${r.folder}`">{{ r.folder.split('/').pop() || $t('outputs.volumeRoot') }}</span><span class="text-body-secondary font-monospace">{{ r.folder.split('/').slice(0, -1).join('/') }}</span></template>
        <template v-else-if="r.workflow"><span class="fw-semibold font-monospace" data-testid="pod-outputs-workflow" :title="r.workflow">{{ runName(r) }}</span><span class="text-body-secondary font-monospace" :title="r.workflow">{{ folderOf(r.workflow) }}</span></template>
        <template v-else-if="r.guess"><span class="fw-semibold font-monospace" data-testid="pod-outputs-workflow" :title="$t('outputs.guessTitle')">≈ {{ r.guess }}</span><span class="text-body-secondary">{{ $t('outputs.guessed') }}</span></template>
        <span v-else class="fw-semibold text-body-secondary" data-testid="pod-outputs-workflow">{{ $t('outputs.unnamed') }}</span>
        <span v-if="r.saved" class="badge text-bg-secondary" data-testid="pod-outputs-saved" :title="$t('outputs.savedTitle')">{{ $t('outputs.saved') }}</span>
        <span v-if="r.source === 'volume'" class="badge text-bg-info" data-testid="pod-outputs-source" data-source="volume" :title="$t('outputs.sourceVolumeTitle')">{{ $t('outputs.sourceVolume') }}</span>
        <span v-else-if="r.source === 'pod'" class="badge text-bg-success" data-testid="pod-outputs-source" data-source="pod" :title="$t('outputs.sourcePodTitle')">{{ $t('outputs.sourcePod') }}</span>
        <span v-if="r.source === 'volume'" class="text-body-secondary ms-auto" data-testid="pod-outputs-volume-run">{{ $t('outputs.volumeRun', { when: r.started_at ? new Date(r.started_at).toLocaleString() : '?', files: r.files.length, size: sizeText(r.files.reduce((n, f) => n + (f.bytes || 0), 0)) }) }}</span>
        <span v-else class="text-body-secondary ms-auto">{{ $t('outputs.run', { when: new Date(r.started_at).toLocaleString(), s: r.duration_s ?? '?' }) }} · <span class="font-monospace">{{ r.prompt_id.slice(0, 8) }}</span></span>
      </div>
      <OutputsGallery :files="r.files" :total-files="r.totalFiles || 0" :base="baseFor(r)" :scope="volumeId || pod.id" :volume-name="volumeName" :offline="!baseFor(r)" :zip-name="`${runName(r) || pod.name}-${idOf(r)}.zip`" />
    </div>
  </BModal>
  <BModal v-model="previewsOpen" :title="$t('outputs.dpx.previewsModalTitle')" size="md" lazy ok-only :ok-title="$t('outputs.dpx.close')" data-testid="pod-outputs-previews-modal">
    <div class="border rounded p-2 mb-2">
      <div class="fw-semibold">{{ $t('outputs.dpx.loadAllOption') }}</div>
      <div class="small text-body-secondary mb-2">{{ $t('outputs.dpx.loadAllTitle') }}</div>
      <div class="small mb-2" data-testid="pod-outputs-previews-counts">{{ $t('outputs.dpx.previewCounts', { ready: previewBus.counts.ready + previewBus.counts.empty, waiting, failed: previewBus.counts.error }) }}</div>
      <div v-if="previewBus.batch" class="mb-2"><BProgress :value="batchDone" :max="Math.max(1, previewBus.batchTotal)" animated striped height="0.6rem" :data-percent="Math.round((batchDone / Math.max(1, previewBus.batchTotal)) * 100)" data-testid="pod-outputs-previews-progress" /></div>
      <div class="d-flex gap-2 align-items-center">
        <BButton variant="primary" size="sm" :disabled="previewBus.batch || waiting === 0" data-testid="pod-outputs-load-previews" @click="generateAll"><BSpinner v-if="previewBus.batch" small class="me-1" />{{ previewBus.batch ? $t('outputs.dpx.generating', { done: batchDone, total: previewBus.batchTotal }) : $t('outputs.dpx.loadAll', { n: waiting }) }}</BButton>
        <BButton v-if="previewBus.batch" variant="outline-warning" size="sm" data-testid="pod-outputs-stop-previews" @click="stopGenerate"><i class="fa-solid fa-stop me-1"></i>{{ $t('outputs.dpx.stopGenerate') }}</BButton>
        <span v-if="previewBus.counts.error" class="small text-warning">{{ $t('outputs.dpx.generatingFailed', { n: previewBus.counts.error }) }}</span>
      </div>
    </div>
  </BModal>
</template>

<script setup>
/** PodOutputsModal: every file the pod's finished runs produced (from ComfyUI's history), run by run, in the reusable OutputsGallery (viewer, download). With a network volume it also browses the volume's comfy-shared/output/ by folder over RunPod's S3 API, no pod needed (docs/ADR-045). */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import OutputsGallery from './OutputsGallery.vue'
import { core } from '../api/bridge'
import { historyAPI } from '../api/history'
import { useUiStore } from '../stores/ui'
import { viewUrl, runName, runsForShot, inFolder, narrowToFolder, volumeAsRuns, mergeWithVolume, s3Base, sizeText } from '../utils/outputs'
import { errorText } from '../stores/toast'
import { sharedThumbs, thumbTimeouts, withTimeout } from '../utils/thumbs'
import { previewBus } from '../utils/thumbsBus'
const folderOf = (p) => p.split('/').slice(0, -1).join('/')
/** `base`: the web address files are served from (this pod, or another running pod on its volume); '' when none runs: the files are then read from the volume over S3 when its keys are set, else only listed. */
const props = defineProps({ pod: { type: Object, required: true }, runs: { type: Array, default: () => [] }, base: { type: String, default: '' }, volumeName: { type: String, default: '' }, volumeId: { type: String, default: '' } })
const emit = defineEmits(['close', 'refresh'])
const ui = useUiStore()
const canZip = !!core?.files?.downloadZip, zipping = ref(false)
// The pod's Shot (the card's field) narrows the list to that shot's runs; "All Shots", or no shot, shows every run. A checkbox turns it off.
const shot = computed(() => (props.pod.shot && props.pod.shot !== 'All Shots' ? props.pod.shot : ''))
const onlyShot = ref(true)
// The folder chosen in the volume browser narrows the pod's own and the saved runs too (Lucas: 'an option to view all or just in the folder selection'): scope 'folder' keeps the runs with files in it, 'all' shows every run of the pod and the volume folder listed.
const scope = ref('folder')
const inScope = (rs) => (scope.value === 'folder' && vol.prefix ? rs.map((r) => narrowToFolder(r, vol.prefix)).filter((r) => r.files.length) : rs)
const shotRuns = computed(() => (shot.value && onlyShot.value ? runsForShot(props.runs, shot.value) : props.runs))
const shown = computed(() => inScope(shotRuns.value))
const hidden = computed(() => props.runs.length - shotRuns.value.length)
const hiddenByFolder = computed(() => shotRuns.value.length - shown.value.length)
const fileCount = (rs) => rs.reduce((n, r) => n + (r.files || []).length, 0)

// The volume source: one prefix at a time (the whole tree takes minutes to list), starting in the pod's shot folder when there is one.
const vol = reactive({ failed: false, restart: false, loaded: false, loading: false, ok: false, reason: '', keysMissing: false, runs: [], folders: [], prefix: '', capped: false, total: 0, shownCount: 0, note: '' })
let seq = 0
async function loadVolume(prefix, fresh = false) {
  if (!props.volumeId) return
  const mine = ++seq
  vol.loading = true
  try {
    vol.failed = false; vol.restart = false
    const a = await withTimeout(historyAPI.listOutputs({ pod_id: props.pod.id, volume_id: props.volumeId, shot: shot.value, round: props.pod.round || '' }, { source: 'volume-s3', ...(prefix === undefined ? {} : { prefix }), fresh }), thumbTimeouts().list, 'The volume listing')   // never an endless spinner: a hung call ends in a visible error
    if (mine !== seq) return
    const st = (a.sources || []).find((x) => x.id === 'volume-s3') || { ok: false, reason: '' }
    vol.ok = !!st.ok; vol.reason = st.reason || ''; vol.keysMissing = !st.ok && /S3_ACCESS_KEY|S3 keys/.test(vol.reason)
    vol.runs = volumeAsRuns(a.runs); vol.folders = a.folders || []; vol.prefix = a.prefix || ''; vol.capped = !!a.capped; vol.total = a.total || 0
    vol.shownCount = vol.runs.reduce((n, r) => n + r.files.length, 0); vol.note = prefix === undefined ? a.start_note || '' : ''
  } catch (e) { if (mine === seq) { vol.ok = false; vol.failed = true; vol.runs = []; vol.folders = []; vol.reason = errorText(e); vol.restart = /no core call/i.test(vol.reason); vol.keysMissing = !vol.restart && /S3_ACCESS_KEY|S3 keys/.test(vol.reason) } } finally { if (mine === seq) { vol.loading = false; vol.loaded = true } }
}
onMounted(() => { sharedThumbs().reset(); previewBus.capped = 0; previewBus.loadAll = false; loadVolume(undefined) })   // the automatic preview cap starts again for each open
onBeforeUnmount(() => { sharedThumbs().abortAll(); previewBus.capped = 0; previewBus.loadAll = false })
/** The preview cache (IndexedDB): how many are kept, and a Clear that only means they are downloaded again. */
const cachedCount = ref(0)
const countCached = async () => { try { cachedCount.value = await sharedThumbs().count() } catch { cachedCount.value = 0 } }
onMounted(countCached)
watch(() => previewBus.cacheVer, countCached)
/** Sequences still without a preview (not yet made, waiting for a click, or failed): what "Generate all previews" will work through, one at a time; one already in the cache is a hit and costs no download. */
const previewsOpen = ref(false)
const waiting = computed(() => previewBus.counts.idle + previewBus.counts.capped + previewBus.counts.error)
const batchLeft = computed(() => previewBus.counts.idle + previewBus.counts.capped + previewBus.counts.loading)
const batchDone = computed(() => Math.max(0, previewBus.batchTotal - batchLeft.value))
function generateAll() { previewBus.batchTotal = waiting.value; previewBus.batch = true; previewBus.loadAll = true; previewBus.tick++ }
function stopGenerate() { previewBus.batch = false; previewBus.loadAll = false; previewBus.stopTick++; sharedThumbs().abortAll() }
watch(batchLeft, (n) => { if (previewBus.batch && n === 0) { previewBus.batch = false; previewBus.loadAll = false } })   // the batch ends by itself when nothing is left
async function clearPreviews() { try { await sharedThumbs().clear() } finally { cachedCount.value = 0 } }
const go = (prefix) => loadVolume(prefix)
const crumbs = computed(() => vol.prefix.split('/').filter(Boolean).map((name, i, a) => ({ name, prefix: a.slice(0, i + 1).join('/') })))
const s3ok = computed(() => vol.ok)
const openConfig = () => { ui.configFocus = 's3'; ui.configOpen = true; emit('close') }
const refresh = () => { emit('refresh'); loadVolume(vol.loaded ? vol.prefix : undefined, true) }

/** The runs shown: the pod's and the saved ones, and the volume's folder runs that are not already one of them. */
const all = computed(() => mergeWithVolume(shown.value, vol.runs))
/** Where a run's files are fetched from: a running pod's address when there is one, else the volume over S3 (its keys set), else nowhere (only listed). */
const baseFor = (r) => props.base || (s3ok.value ? s3Base(props.volumeId) : '')
const anyBase = computed(() => !!props.base || s3ok.value)
const idOf = (r) => (r.source === 'volume' ? r.folder.split('/').pop().slice(-8).replace(/[^\w.-]/g, '_') : r.prompt_id.slice(0, 8))
/** Every run's files in one zip, a folder per run. */
async function zipAll() {
  zipping.value = true
  try { await core.files.downloadZip(all.value.flatMap((r) => r.files.map((f) => ({ url: viewUrl(baseFor(r), f, { web: true }), name: `${(runName(r) || (r.source === 'volume' ? r.folder.split('/').pop() : '') || String(r.started_at).replace(/[:T]/g, '-').slice(0, 19)).replace(/[^\w.-]+/g, '_')}-${idOf(r)}/${[f.subfolder, f.filename].filter(Boolean).join('/')}` }))), `${props.pod.name}-outputs.zip`) } catch (e) { alert(errorText(e)) } finally { zipping.value = false }
}
</script>
