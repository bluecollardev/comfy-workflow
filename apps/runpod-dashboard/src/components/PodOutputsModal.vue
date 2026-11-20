<template>
  <BModal :model-value="true" :title="$t('outputs.title', { name: pod.name })" size="xl" scrollable lazy no-footer data-testid="pod-outputs-modal" @update:model-value="(v) => !v && $emit('close')">
    <div class="d-flex align-items-center gap-2 mb-2" data-testid="pod-outputs-toolbar">
      <span class="small text-body-secondary">{{ $t('outputs.buttonTitle') }}</span>
      <div class="ms-auto d-flex gap-2">   <!-- the buttons sit at the right, whatever else shows -->
        <BButton v-if="all.length > 1" variant="outline-light" size="sm" class="text-nowrap" :disabled="!canZip || zipping || !anyBase" :title="canZip ? '' : $t('outputs.zipApp')" data-testid="pod-outputs-zip-all" @click="zipAll"><BSpinner v-if="zipping" small class="me-1" /><i v-else class="fa-solid fa-file-zipper me-1"></i>{{ $t('outputs.zipAllRuns') }}</BButton>
        <BButton variant="outline-light" size="sm" class="text-nowrap" data-testid="pod-outputs-clear-previews" :title="$t('outputs.dpx.clearCacheTitle')" @click="clearPreviews"><i class="fa-regular fa-trash-can me-1"></i>{{ $t('outputs.dpx.cached', { n: cachedCount }) }} · {{ $t('outputs.dpx.clearCache') }}</BButton>
        <BButton variant="outline-light" size="sm" class="text-nowrap" data-testid="pod-outputs-previews" :title="$t('outputs.dpx.previewsTitle')" @click="previewsOpen = true"><BSpinner v-if="batchRunning || renderJob" small class="me-1" /><i v-else class="fa-regular fa-images me-1"></i>{{ batchRunning ? $t('outputs.dpx.generating', { done: batchDone, total: batchTotal }) : $t('outputs.dpx.previews') }}<span v-if="renderJob" class="ms-1 text-info" data-testid="pod-outputs-render-button-status">· {{ renderJob.state === 'pulling' ? $t('outputs.render.buttonSyncing') : $t('outputs.render.buttonRendering', { done: renderJob.frames_done || 0, total: renderJob.frames_total || 0 }) }}</span></BButton>
        <BButton v-if="!publishStore.old" variant="outline-light" size="sm" class="text-nowrap" :title="$t('publish.buttonTitle')" data-testid="pod-outputs-publish" @click="publishOpen = true"><i class="fa-solid fa-cloud-arrow-up me-1"></i>{{ $t('publish.button') }}</BButton>
        <BButton variant="outline-light" size="sm" class="text-nowrap" data-testid="pod-outputs-refresh" @click="refresh"><i class="fa-solid fa-rotate me-1"></i>{{ $t('outputs.refresh') }}</BButton>
      </div>
    </div>
    <div v-if="!base && !s3ok" class="alert alert-warning py-2 small" data-testid="pod-outputs-offline">{{ $t('outputs.startPod', { volume: volumeName || pod.name }) }}</div>
    <div v-if="volumeId && vol.loaded && !vol.ok && (!base || vol.failed)" class="alert alert-info py-2 small d-flex align-items-center gap-2 flex-wrap" data-testid="pod-outputs-s3-unavailable">
      <span data-testid="pod-outputs-volume-error">{{ vol.restart ? $t('outputs.dpx.reason.restart') : vol.keysMissing ? $t('outputs.s3Keys') : $t('outputs.volumeError', { reason: vol.reason }) }}</span>
      <BButton v-if="vol.keysMissing" variant="outline-primary" size="sm" data-testid="pod-outputs-open-config" @click="openConfig">{{ $t('outputs.s3KeysButton') }}</BButton>
    </div>
    <div v-if="volumeId && (vol.ok || vol.loading)" class="mb-3" data-testid="pod-outputs-volume">
      <nav class="d-flex align-items-center gap-1 flex-wrap small mb-1" :class="{ 'opacity-50': allActive }" :title="allActive ? $t('outputs.all.crumbNote') : ''" :aria-label="$t('outputs.volumeBreadcrumb')" data-testid="pod-outputs-breadcrumb">
        <i class="fa-solid fa-hard-drive text-body-secondary me-1"></i>
        <BButton variant="link" size="sm" class="p-0" data-testid="pod-outputs-crumb" data-prefix="" @click="go('')">{{ $t('outputs.volumeRoot') }}</BButton>
        <template v-for="c in crumbs" :key="c.prefix"><span class="text-body-secondary">›</span><BButton variant="link" size="sm" class="p-0" data-testid="pod-outputs-crumb" :data-prefix="c.prefix" @click="go(c.prefix)">{{ c.name }}</BButton></template>
      </nav>
      <div class="d-flex align-items-center gap-2 flex-wrap small mb-2" data-testid="pod-outputs-scope">
        <span class="text-body-secondary">{{ $t('outputs.scope') }}</span>
        <div class="btn-group btn-group-sm" role="group">
          <button type="button" class="btn btn-outline-light" :class="{ active: scope === 'all' }" data-testid="pod-outputs-scope-all" :title="$t('outputs.scopeAllTitle')" @click="setScope('all')">{{ $t('outputs.scopeAll') }}</button>
          <button type="button" class="btn btn-outline-light" :class="{ active: scope === 'folder' }" data-testid="pod-outputs-scope-folder" :title="$t('outputs.scopeFolderTitle')" @click="setScope('folder')">{{ vol.prefix ? $t('outputs.scopeFolder', { path: vol.prefix }) : $t('outputs.scopeFolderRoot') }}</button>
        </div>
        <span v-if="!(scope === 'all' && volAll.running)" class="text-body-secondary" data-testid="pod-outputs-scope-count">{{ $t('outputs.scopeCount', { n: all.length, files: fileCount(all), total: fileCount(mergeWithVolume(shotRuns, vol.runs)) }) }}<template v-if="scope === 'folder' && hiddenByFolder"> · {{ $t('outputs.scopeHidden', { n: hiddenByFolder }) }}</template></span>
      </div>
      <div v-if="scope === 'all' && volAll.running" class="d-flex align-items-center gap-2 small mb-1" data-testid="pod-outputs-all-loading"><BSpinner small /><span data-testid="pod-outputs-all-loading-text">{{ volAll.progress ? $t('outputs.all.listingCount', { files: volAll.filesSeen.toLocaleString('en-US'), folders: volAll.foldersSeen.toLocaleString('en-US') }) : $t('outputs.all.listing') }}</span><BButton size="sm" variant="outline-warning" data-testid="pod-outputs-all-stop" @click="stopAll"><i class="fa-solid fa-stop me-1"></i>{{ $t('outputs.all.stop') }}</BButton></div>
      <div v-else-if="scope === 'all' && volAll.stopped" class="text-warning small mb-1" data-testid="pod-outputs-all-stopped">{{ $t('outputs.all.stopped') }}</div>
      <div v-else-if="scope === 'all' && volAll.error" class="alert alert-warning py-1 px-2 small d-flex align-items-center gap-2 mb-1" data-testid="pod-outputs-all-error"><span data-testid="pod-outputs-all-error-text">{{ volAll.error }}</span><BButton size="sm" variant="outline-primary" data-testid="pod-outputs-all-retry" @click="ensureAll(true)">{{ $t('outputs.all.retry') }}</BButton></div>
      <div v-if="vol.loading" class="text-body-secondary small" data-testid="pod-outputs-volume-loading"><BSpinner small class="me-2" />{{ $t('outputs.volumeLoading', { path: `output/${vol.prefix}`.replace(/\/$/, '') }) }}</div>
      <div v-else>
        <div class="d-flex align-items-center gap-3 small mb-1" data-testid="pod-outputs-empty-toggle-row"><label class="mb-0"><input v-model="hideEmpty" type="checkbox" class="form-check-input me-1" data-testid="pod-outputs-hide-empty" />{{ $t('outputs.hideEmpty') }}</label><span v-if="hideEmpty && emptyHidden" class="text-body-secondary" data-testid="pod-outputs-empty-hidden">{{ $t('outputs.emptyHidden', { n: emptyHidden }) }}</span></div>
        <div class="d-flex gap-1 flex-wrap" data-testid="pod-outputs-folders"><BButton v-for="f in shownFolders" :key="f" variant="outline-light" size="sm" data-testid="pod-outputs-folder" :data-name="f" :data-empty="vol.info[f]?.empty ? 'true' : 'false'" :class="{ 'opacity-50': vol.info[f]?.empty }" @click="go(vol.prefix ? `${vol.prefix}/${f}` : f)"><i class="fa-regular fa-folder me-1"></i>{{ f }}<span v-if="vol.info[f]?.empty" class="ms-1 text-body-secondary" data-testid="pod-outputs-folder-empty">{{ $t('outputs.emptyTag') }}</span></BButton></div>
        <div v-if="vol.capped" class="text-warning small mt-1" data-testid="pod-outputs-capped">{{ allActive ? $t('outputs.all.capped', { n: vol.shownCount.toLocaleString('en-US'), total: vol.total.toLocaleString('en-US') }) : $t('outputs.volumeCapped', { n: vol.shownCount, total: vol.total }) }}</div>
        <div v-if="vol.note" class="text-body-secondary small mt-1" data-testid="pod-outputs-volume-note">{{ vol.note }}</div>
      </div>
    </div>
    <div class="d-flex align-items-center gap-2 small mb-2" data-testid="pod-outputs-name-filter-row">
      <BFormInput v-model="nameFilter" size="sm" type="search" :placeholder="$t('outputs.nameFilterPlaceholder')" :aria-label="$t('outputs.nameFilter')" style="max-width: 24rem" data-testid="pod-outputs-name-filter" />
      <BButton v-if="nameFilter" variant="outline-light" size="sm" data-testid="pod-outputs-name-filter-clear" @click="nameFilter = ''">{{ $t('outputs.nameFilterClear') }}</BButton>
      <span v-if="nameFilter.trim()" class="text-body-secondary" data-testid="pod-outputs-name-filter-count">{{ $t('outputs.nameFilterCount', { n: matchCount }) }}</span>
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
      <OutputsGallery :files="r.files" :total-files="r.totalFiles || 0" :base="baseFor(r)" :scope="volumeId || pod.id" :volume-name="volumeName" :offline="!baseFor(r)" :zip-name="`${runName(r) || pod.name}-${idOf(r)}.zip`" :pod-id="pod.id" />
    </div>
  </BModal>
  <BModal v-model="previewsOpen" :title="$t('outputs.dpx.previewsModalTitle')" size="xl" scrollable lazy ok-only :ok-title="$t('outputs.dpx.close')" data-testid="pod-outputs-previews-modal">
    <!-- What this window generates for: always on screen, never dismissed (docs/ADR-051): the preview batch and the render plan touch exactly this -->
    <BAlert :model-value="true" :variant="genEmpty ? 'warning' : 'info'" class="gen-scope-alert mb-2 py-1 px-2 small" data-testid="pod-outputs-generate-scope-alert" :data-scope="genEffective" :data-empty="genEmpty ? 'true' : 'false'">
      <!-- one compact summary row; the folders are a collapsed list (the alert scrolls away with the body: it never floats over the options) -->
      <div class="d-flex align-items-baseline gap-1 flex-wrap" data-testid="generate-scope-title">
        <strong>{{ $t('outputs.generate.alertTitle') }}</strong>
        <span v-if="genEffective === 'folder'">{{ $t('outputs.generate.alertFolder') }}</span>
        <span v-else data-testid="pod-outputs-generate-scope-all">{{ $t('outputs.generate.alertAll') }}</span>
        <span class="text-body-secondary">·</span>
        <span data-testid="pod-outputs-generate-scope-counts"><BSpinner v-if="listingBusy" small class="me-1" data-testid="generate-scope-loading" />{{ listingBusy ? $t('outputs.generate.checkingShort') : genEmpty ? $t(genEffective === 'folder' ? 'outputs.generate.emptyFolder' : 'outputs.generate.emptyAll') : $t(genStats.n === 1 ? 'outputs.generate.countsOne' : 'outputs.generate.counts', { n: genStats.n, frames: genStats.frames.toLocaleString('en-US') }) }}</span>
        <span class="text-body-secondary">·</span>
        <span class="text-body-secondary text-break" data-testid="pod-outputs-generate-scope-where">{{ $t('outputs.generate.on', { where: [pod.name, volumeName].filter(Boolean).join(' · ') }) }}</span>
        <BButton v-if="genEffective === 'all' && genFolders.length" variant="link" size="sm" class="p-0 ms-auto" data-testid="pod-outputs-generate-scope-more" :aria-expanded="genMore" @click="genMore = !genMore">{{ genMore ? $t('outputs.generate.hideFolders') : $t('outputs.generate.showFolders', { n: genFolders.length }) }}</BButton>
      </div>
      <div v-if="genEffective === 'folder'" class="d-flex align-items-center gap-2 mt-1" data-testid="generate-scope-list">
        <div class="gen-scope-row font-monospace text-body-secondary flex-grow-1" :title="genPath" data-testid="generate-scope-folder"><code :title="genPath" data-testid="pod-outputs-generate-scope-path">{{ genPathShort }}</code></div>
        <BButton size="sm" variant="outline-secondary" class="py-0 flex-shrink-0" data-testid="pod-outputs-generate-scope-copy" @click="copyGenPath">{{ genCopied ? $t('outputs.generate.copied') : $t('outputs.generate.copy') }}</BButton>
      </div>
      <div v-else-if="genMore && genFolders.length" class="mt-1" data-testid="pod-outputs-generate-scope-covers">
        <div class="gen-scope-list text-body-secondary" data-testid="generate-scope-list">
          <div v-for="f in genFolders" :key="f" class="gen-scope-row font-monospace" :title="f" data-testid="generate-scope-folder">{{ f }}</div>
        </div>
      </div>
      <div v-if="runningScope && runningScope !== genScopeLabel" class="text-warning" data-testid="pod-outputs-generate-scope-running">{{ $t('outputs.generate.running', { scope: runningScope }) }}</div>
    </BAlert>
    <div data-testid="pod-outputs-generate-tabs">
    <!-- two plain tabs: both panels stay mounted (only hidden), so nothing typed, ticked or loading is ever rebuilt by switching -->
    <ul class="nav nav-tabs mb-2" role="tablist">
      <li class="nav-item" role="presentation"><button type="button" class="nav-link" :class="{ active: genTab === 0 }" role="tab" :aria-selected="genTab === 0 ? 'true' : 'false'" data-testid="pod-outputs-tab-previews-button" @click="genTab = 0">{{ $t('outputs.generate.tabPreviews') }}</button></li>
      <li class="nav-item" role="presentation"><button type="button" class="nav-link" :class="{ active: genTab === 1 }" role="tab" :aria-selected="genTab === 1 ? 'true' : 'false'" data-testid="pod-outputs-tab-render-button" @click="genTab = 1">{{ $t('outputs.generate.tabRender') }}</button></li>
    </ul>
      <div v-show="genTab === 0" role="tabpanel" data-testid="pod-outputs-tab-previews">
      <div class="border rounded p-2 mb-2">
        <div class="fw-semibold">{{ $t('outputs.dpx.loadAllOption') }}</div>
        <div class="small text-body-secondary mb-2">{{ $t('outputs.dpx.loadAllTitle') }}</div>
        <label class="d-flex align-items-center gap-2 small mb-1" :title="$t('outputs.skipPreviewsHelp')"><input v-model="skipExisting" type="checkbox" class="form-check-input mt-0" :disabled="batchRunning" data-testid="pod-outputs-previews-skip-existing" />{{ $t('outputs.skipExisting') }}</label>
        <div v-if="!skipExisting" class="small text-warning mb-1" data-testid="pod-outputs-previews-regenerate-help">{{ $t('outputs.regenerateHelp') }}</div>
        <div class="small mb-2 d-flex align-items-center gap-1" data-testid="pod-outputs-previews-counts" :data-final="countsFinal ? 'true' : 'false'"><BSpinner v-if="!countsFinal || batchRunning" small data-testid="generate-counts-loading" />{{ countsLine }}</div>
        <div v-if="batchRunning" class="mb-2"><BProgress :value="batchDone" :max="Math.max(1, batchTotal)" animated striped height="0.6rem" :data-percent="Math.round((batchDone / Math.max(1, batchTotal)) * 100)" data-testid="pod-outputs-previews-progress" /></div>
        <div class="d-flex gap-2 align-items-center">
          <BButton variant="primary" size="sm" :disabled="batchRunning || genProbing || genTodo === 0" data-testid="pod-outputs-load-previews" @click="generateAll"><BSpinner v-if="batchRunning" small class="me-1" />{{ batchRunning ? $t('outputs.dpx.generating', { done: batchDone, total: batchTotal }) : $t(skipExisting ? 'outputs.dpx.loadAll' : 'outputs.regenerateAll', { n: genTodo }) }}</BButton>
          <BButton v-if="batchRunning" variant="outline-warning" size="sm" data-testid="pod-outputs-stop-previews" @click="stopGenerate"><i class="fa-solid fa-stop me-1"></i>{{ $t('outputs.dpx.stopGenerate') }}</BButton>
          <span v-if="genCounts.failed" class="small text-warning">{{ $t('outputs.dpx.generatingFailed', { n: genCounts.failed }) }}</span>
        </div>
      </div>
      </div>
      <div v-show="genTab === 1" role="tabpanel" data-testid="pod-outputs-tab-render">
      <RenderSequences v-model:skip-existing="skipExisting" :pod="pod" :items="genItems" :thumbs="genThumbs" :scope="volumeId || pod.id" :volume-name="volumeName" :skipped="genSkipped" :scope-label="genScopeLabel" @play="previewsOpen = false" @publish="publishOpen = true" />
      </div>
    </div>
  </BModal>
  <PublishModal v-if="publishOpen" :preselect="vol.prefix ? [] : publishPreselect" :volume-dir="vol.prefix" :volume-name="volumeName || ''" @close="publishOpen = false" />
</template>

<script setup>
/** PodOutputsModal: every file the pod's finished runs produced (from ComfyUI's history), run by run, in the reusable OutputsGallery (viewer, download). With a network volume it also browses the volume's comfy-shared/output/ by folder over RunPod's S3 API, no pod needed (docs/ADR-045). */
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import OutputsGallery from './OutputsGallery.vue'
import RenderSequences from './RenderSequences.vue'
import PublishModal from './PublishModal.vue'
import { usePublishStore } from '../stores/publish'
import { useAutopublishStore } from '../stores/autopublish'
import { useMountsStore } from '../stores/mounts'
import { localPath } from '../utils/publish'
import { core } from '../api/bridge'
import { historyAPI } from '../api/history'
import { useUiStore } from '../stores/ui'
import { viewUrl, galleryTiles, runName, runsForShot, inFolder, narrowToFolder, filterByName, volumeAsRuns, mergeWithVolume, s3Base, sizeText } from '../utils/outputs'
import { errorText } from '../stores/toast'
import { sharedThumbs, thumbTimeouts, withTimeout, thumbKey, appReader, createLimiter } from '../utils/thumbs'
import { t } from '../i18n'
import { usePreviewsStore } from '../stores/previews'
import { previewBus } from '../utils/thumbsBus'
import { clearColourCache } from '../utils/ocio'
import { useRendersStore } from '../stores/renders'
import { sequenceItems, sequenceItem, isActive } from '../utils/renders'
const folderOf = (p) => p.split('/').slice(0, -1).join('/')
/** `base`: the web address files are served from (this pod, or another running pod on its volume); '' when none runs: the files are then read from the volume over S3 when its keys are set, else only listed. */
const props = defineProps({ pod: { type: Object, required: true }, runs: { type: Array, default: () => [] }, base: { type: String, default: '' }, volumeName: { type: String, default: '' }, volumeId: { type: String, default: '' } })
const emit = defineEmits(['close', 'refresh'])
const ui = useUiStore(), mountsStore = useMountsStore()
const canZip = !!core?.files?.downloadZip, zipping = ref(false)
// The pod's Shot (the card's field) narrows the list to that shot's runs; "All Shots", or no shot, shows every run. A checkbox turns it off.
const shot = computed(() => (props.pod.shot && props.pod.shot !== 'All Shots' ? props.pod.shot : ''))
const onlyShot = ref(true)
// The folder chosen in the volume browser narrows the pod's own and the saved runs too (Lucas: 'an option to view all or just in the folder selection'): scope 'folder' keeps the runs with files in it, 'all' shows every run of the pod and the volume folder listed.
const scope = ref((typeof window !== 'undefined' && window.__e2eOutputsScope) || 'all')   // (a browser test seam starts in the folder scope)  // All outputs is the starting scope (the whole tree, one listing); 'Just in the folder I pick' is one click away, from the cache
const inScope = (rs) => (scope.value === 'folder' && vol.prefix ? rs.map((r) => narrowToFolder(r, vol.prefix)).filter((r) => r.files.length) : rs)
const shotRuns = computed(() => (shot.value && onlyShot.value ? runsForShot(props.runs, shot.value) : props.runs))
const shown = computed(() => inScope(shotRuns.value))
const hidden = computed(() => props.runs.length - shotRuns.value.length)
const hiddenByFolder = computed(() => shotRuns.value.length - shown.value.length)
const fileCount = (rs) => rs.reduce((n, r) => n + (r.files || []).length, 0)

// The volume source: one prefix at a time (the whole tree takes minutes to list), starting in the pod's shot folder when there is one.
const vol = reactive({ info: {}, failed: false, restart: false, loaded: false, loading: false, ok: false, reason: '', keysMissing: false, runs: [], folders: [], prefix: '', capped: false, total: 0, shownCount: 0, note: '' })
let seq = 0
const VIEW_KEYS = ['ok', 'reason', 'keysMissing', 'runs', 'folders', 'info', 'capped', 'total', 'shownCount', 'note']
const snapOf = (a, prefix) => {
  const st = (a.sources || []).find((x) => x.id === 'volume-s3') || { ok: false, reason: '' }, runs = volumeAsRuns(a.runs)
  return { ok: !!st.ok, reason: st.reason || '', keysMissing: !st.ok && /S3_ACCESS_KEY|S3 keys/.test(st.reason || ''), runs, folders: a.folders || [], info: a.folder_info || {}, capped: !!a.capped, total: a.total || 0, shownCount: runs.reduce((n, r) => n + r.files.length, 0), note: prefix === undefined ? a.start_note || '' : '', prefix: a.prefix || '' }
}
/** Two listings are kept while the window is open and swapped instantly: the one-folder listing (folderSnap, one per prefix in folderCache) and the whole tree (allSnap, `all: true`). `vol` is the one on screen. */
const folderSnap = shallowRef(null), allSnap = shallowRef(null), folderCache = new Map()
const showSnap = (sn) => { for (const k of VIEW_KEYS) vol[k] = sn[k] }
const allActive = computed(() => scope.value === 'all' && !!allSnap.value)
const allMode = computed(() => scope.value === 'all' && !volAll.unsupported)   // in All outputs the folder listing never fills the view (it only teaches the pre-selected folder)
const applyOk = (sn) => { vol.ok = sn.ok; vol.reason = sn.reason; vol.keysMissing = sn.keysMissing }
async function loadVolume(prefix, fresh = false) {
  if (!props.volumeId) return
  const mine = ++seq
  vol.loading = true
  try {
    vol.failed = false; vol.restart = false
    const a = await withTimeout(historyAPI.listOutputs({ pod_id: props.pod.id, volume_id: props.volumeId, shot: shot.value, round: props.pod.round || '' }, { source: 'volume-s3', ...(prefix === undefined ? {} : { prefix }), fresh }), thumbTimeouts().list, 'The volume listing')   // never an endless spinner: a hung call ends in a visible error
    if (mine !== seq) return
    const sn = snapOf(a, prefix)
    folderSnap.value = sn; folderCache.set(sn.prefix, sn); vol.prefix = sn.prefix
    if (allMode.value) applyOk(sn); else showSnap(sn)
  } catch (e) { if (mine === seq) { vol.ok = false; vol.failed = true; vol.runs = []; vol.folders = []; vol.reason = errorText(e); vol.restart = /no core call/i.test(vol.reason); vol.keysMissing = !vol.restart && /S3_ACCESS_KEY|S3 keys/.test(vol.reason) } } finally { if (mine === seq) { vol.loading = false; vol.loaded = true } }
}
// All outputs (docs/ADR-051): the whole comfy-shared/output/ tree in ONE recursive listing (`all: true`, as a job when the core runs it as one: progress and Stop), whatever folder the pod's shot pre-selected.
// Clicking All outputs always makes sure it is there: a fresh cached result is shown at once, a running listing is followed (never a second one), anything else (stopped, failed, timed out, older than 5 minutes) lists again.
const ALL_TIMEOUT_MS = 120_000, ALL_FRESH_MS = 5 * 60_000, ALL_POLL_MS = 700
const volAll = reactive({ running: false, filesSeen: 0, foldersSeen: 0, progress: false, error: '', stopped: false, unsupported: false, at: 0 })
let allRun = null, allJobId = '', allToken = 0
async function listAll() {
  const token = ++allToken, t0 = Date.now(), limit = (typeof window !== 'undefined' && window.__e2eAllTimeoutMs) || ALL_TIMEOUT_MS   // the seam lets a browser test wait 2 seconds instead of 2 minutes
  volAll.running = true; volAll.error = ''; volAll.stopped = false; volAll.filesSeen = 0; volAll.foldersSeen = 0; volAll.progress = false; allJobId = ''
  const ctx = { pod_id: props.pod.id, volume_id: props.volumeId, shot: shot.value, round: props.pod.round || '' }
  const deadline = () => { if (Date.now() - t0 > limit) throw new Error(t('outputs.all.timeout')) }
  try {
    let a = await withTimeout(historyAPI.listOutputs(ctx, { source: 'volume-s3', all: true, job: true, fresh: true }), limit, 'The listing of every folder')
    if (a?.job_id) {
      allJobId = a.job_id
      for (;;) {
        if (token !== allToken) return
        deadline()
        let st
        try { st = await historyAPI.outputsStatus(allJobId) } catch { st = null }   // a core that cannot report progress: an indeterminate loader until it answers
        if (token !== allToken) return
        if (st) {
          if (st.progress_available !== false && st.files_seen != null) { volAll.progress = true; volAll.filesSeen = st.files_seen || 0; volAll.foldersSeen = st.folders_seen || 0 }
          if (st.state === 'failed') throw new Error(st.error || t('outputs.all.failed'))
          if (st.state === 'cancelled') return
          if (st.state === 'done') { a = st.result; break }
        }
        await new Promise((r) => setTimeout(r, ALL_POLL_MS))
      }
    }
    if (token !== allToken) return
    if (!a || a.all !== true) { volAll.unsupported = true; scope.value = 'folder'; if (folderSnap.value) showSnap(folderSnap.value); return }   // an older core answers the one-level listing: the folder scope, as before
    allSnap.value = snapOf(a, ''); volAll.at = Date.now()
    if (scope.value === 'all') showSnap(allSnap.value)
  } catch (e) { if (token === allToken) { volAll.error = errorText(e); if (folderSnap.value) showSnap(folderSnap.value) } } finally { if (token === allToken) { volAll.running = false; allRun = null } }
}
function ensureAll(force = false) {
  if (!props.volumeId || volAll.unsupported) return allRun
  if (volAll.running && allRun) return allRun
  if (!force && allSnap.value && Date.now() - volAll.at < ALL_FRESH_MS) { showSnap(allSnap.value); volAll.error = ''; volAll.stopped = false; return null }
  allRun = listAll()
  return allRun
}
function stopAll() {
  allToken++; volAll.running = false; volAll.stopped = true; allRun = null
  if (allJobId) historyAPI.outputsCancel?.(allJobId)?.catch?.(() => {})
  if (folderSnap.value) showSnap(folderSnap.value)   // keeps what is loaded: the top level
}
function setScope(v) {
  scope.value = v
  if (v === 'all') { ensureAll(); return }
  if (folderSnap.value) showSnap(folderSnap.value)   // the folder listing comes back from the cache at once
}
onMounted(async () => {
  if (!mountsStore.config) { await mountsStore.load(); if (!hideTouched) { hideEmpty.value = mountsStore.config?.outputs?.hide_empty_folders !== false; hideTouched = false } if (!skipTouched) { skipExisting.value = mountsStore.config?.render?.skip_existing !== false; skipTouched = false } }
})
onMounted(() => { sharedThumbs().reset(); previewBus.capped = 0; previewBus.loadAll = false; loadVolume(undefined); if (scope.value === 'all') ensureAll() })   // the automatic preview cap starts again for each open
onBeforeUnmount(() => { allToken++; if (!previewsStore.running) sharedThumbs().abortAll(); previewBus.capped = 0; previewBus.loadAll = false })   // a running batch is the app's job: closing the window does not stop it
/** The preview cache (IndexedDB): how many are kept, and a Clear that only means they are downloaded again. */
const cachedCount = ref(0)
const countCached = async () => { try { cachedCount.value = await sharedThumbs().count() } catch { cachedCount.value = 0 } }
onMounted(countCached)
watch(() => previewBus.cacheVer, countCached)
/** Sequences still without a preview (not yet made, waiting for a click, or failed): what "Generate all previews" will work through, one at a time; one already in the cache is a hit and costs no download. */
const previewsOpen = ref(false)
// The batch is the app's job (stores/previews.js): it goes on when this window is closed and shows in the Queue's Generations.
const previewsStore = usePreviewsStore()
const batchRunning = computed(() => previewsStore.running)
const batchDone = computed(() => previewsStore.batch?.done || 0)
const batchTotal = computed(() => previewsStore.batch?.total || 0)
/** What this window generates for (docs/ADR-051): "This folder" (the volume folder that is open: the runs' files in it or inside it, the same rule as the Outputs window's folder scope) or "All outputs" (every run and folder loaded here).
 * It is this window's own choice (it follows the Outputs window's toggle until chosen) and never changes that toggle; the preview batch and the render plan are for exactly these sequences. */
/** What the window generates for: what the Outputs window has selected (the open folder, or All outputs). No second choice to make; the banner above says which. */
const genEffective = computed(() => (scope.value === 'folder' && vol.prefix ? 'folder' : 'all'))
const runsFor = (which) => (which === 'folder' && vol.prefix ? mergeWithVolume(shotRuns.value.map((r) => narrowToFolder(r, vol.prefix)).filter((r) => r.files.length), folderSnap.value?.runs || vol.runs) : mergeWithVolume(shotRuns.value, which === 'all' && allSnap.value ? allSnap.value.runs : folderSnap.value?.runs || vol.runs))
const genRuns = computed(() => runsFor(genEffective.value))
const dpxTiles = (runs) => runs.flatMap((r) => galleryTiles(r.files).filter((tl) => tl.kind === 'dpx'))
const statsOf = (runs) => { const seen = new Set(); let frames = 0; for (const tl of dpxTiles(runs)) { const k = `${tl.file.subfolder}/${tl.key}`; if (seen.has(k)) continue; seen.add(k); frames += tl.frames.length } return { n: seen.size, frames } }
const genStats = computed(() => statsOf(genRuns.value))
const genCountAll = computed(() => statsOf(runsFor('all')).n), genCountFolder = computed(() => (vol.prefix ? statsOf(runsFor('folder')).n : 0))
const countText = (n) => t(n === 1 ? 'outputs.generate.countOne' : 'outputs.generate.countMany', { n })
const genEmpty = computed(() => genStats.value.n === 0)
const genPath = computed(() => `output/${vol.prefix}`)
const genPathShort = computed(() => { const p = genPath.value; return p.length <= 60 ? p : `${p.slice(0, 28)}…${p.slice(-28)}` })   // a long path keeps its start and its end; the full path is the tooltip and what Copy puts on the clipboard
const genCopied = ref(false)
async function copyGenPath() { try { await navigator.clipboard.writeText(genPath.value); genCopied.value = true; setTimeout(() => (genCopied.value = false), 2000) } catch { genCopied.value = false } }
const genFolders = computed(() => [...new Set(dpxTiles(genRuns.value).map((tl) => `output/${tl.file.subfolder || ''}`.replace(/\/$/, '')))].sort())
const genTab = ref(0)   // the tabs of the Generate window: 0 Previews (it opens here), 1 Render Sequences
const genMore = ref(false)   // the covered folders start collapsed
const genScopeLabel = computed(() => (genEffective.value === 'folder' ? t('outputs.generate.scopeIn', { path: genPath.value }) : t('outputs.generate.scopeAll')))
/** The scope a job started here is using, when it differs from the radio. */
const runningScope = computed(() => (previewsStore.running ? previewsStore.batch.scope : renderJob.value ? renders.scopes[renderJob.value.job_id] || '' : ''))
// Render sequences: the in-scope sequences
const genTiles = computed(() => genRuns.value.flatMap((r) => galleryTiles(r.files)))
const genSeqs = computed(() => sequenceItems(genTiles.value))
const genItems = computed(() => genSeqs.value.items), genSkipped = computed(() => genSeqs.value.skipped)
/** `${dir}/${name}` -> the DPX tile of that sequence and the base URL its first frame is read from (the Generate rows show it as a preview). */
const genThumbs = computed(() => { const m = {}; for (const r of genRuns.value) { const base = baseFor(r); for (const tl of galleryTiles(r.files)) { const it = sequenceItem(tl); if (!it) continue; const k = `${it.dir}/${it.name}`; if (!m[k] || (!m[k].base && base)) m[k] = { tile: tl, base } } } return m })
// The previews: one item per in-scope sequence; what is in the cache is looked up there (no download, no queue), so the counts are exact without a tile having been on screen.
const previewItems = computed(() => {
  const items = [], seen = new Set()
  for (const r of genRuns.value) {
    const base = baseFor(r)
    if (!base) continue
    for (const tl of galleryTiles(r.files)) {
      if (tl.kind !== 'dpx') continue
      const first = tl.frames[0], key = thumbKey(props.volumeId || props.pod.id || base, first)
      if (seen.has(key)) continue
      seen.add(key); items.push({ key, job: { url: viewUrl(base, first), fallback: appReader(core), bytes: first.bytes ?? null, modified: first.modified ?? null } })
    }
  }
  return items
})
const probeMap = reactive({}), probeLimit = createLimiter(8)   // thumb key -> 'ready' (cached) | 'none'
let probeGen = 0
async function probe(items, force = false) {
  const gen = probeGen
  await Promise.all(items.filter((i) => force || probeMap[i.key] === undefined).map((i) => probeLimit(async () => { const r = await sharedThumbs().peek(i.key, i.job); if (gen === probeGen) probeMap[i.key] = r.status === 'none' ? 'none' : 'ready' })))
}
watch(() => previewBus.cacheVer, () => probe(previewItems.value.filter((i) => probeMap[i.key] !== 'ready'), true))   // a preview made in this session counts at once
const genProbing = computed(() => previewItems.value.some((i) => probeMap[i.key] === undefined))
/** ready = cached or produced (an empty first frame counts), failed = the batch's errors, waiting = the rest. */
const genCounts = computed(() => {
  let ready = 0, failed = 0
  for (const i of previewItems.value) { const r = previewsStore.results[i.key]; if (probeMap[i.key] === 'ready' || ['ready', 'empty'].includes(r?.status)) ready++; else if (r?.status === 'error') failed++ }
  return { ready, failed, waiting: previewItems.value.length - ready - failed }
})
/** The numbers are final only when nothing is loading: the saved-preview probes, the Outputs listings (the folder one, the All outputs one) or a refresh. While a batch runs they are live and the spinner stays. */
const listingBusy = computed(() => vol.loading || volAll.running)
const countsFinal = computed(() => !genProbing.value && !listingBusy.value)
const countsLine = computed(() => { const ph = t('outputs.generate.checkingShort'); return countsFinal.value ? t('outputs.dpx.previewCounts', { ready: genCounts.value.ready, waiting: genCounts.value.waiting, failed: genCounts.value.failed }) : t('outputs.dpx.previewCounts', { ready: ph, waiting: ph, failed: ph }) })
let skipTouched = false
const skipExisting = ref(mountsStore.config?.render?.skip_existing !== false)   // the Default Configuration's starting value until the plan brings the pod's own; per-run changes are never saved
watch(skipExisting, () => { skipTouched = true })   // per Generate window: ticked leaves what exists alone (previews and renders), unticked regenerates it
const genTodo = computed(() => (skipExisting.value ? genCounts.value.waiting + genCounts.value.failed : previewItems.value.length))
async function generateAll() {
  await probe(previewItems.value)
  const todo = skipExisting.value ? previewItems.value.filter((i) => probeMap[i.key] !== 'ready' && !['ready', 'empty'].includes(previewsStore.results[i.key]?.status)) : [...previewItems.value]   // ticked: a cached one is never asked for again; unticked: every one is read again and replaces its saved preview
  previewsStore.start(todo, props.pod.name, genScopeLabel.value, !skipExisting.value)
}
function stopGenerate() { previewsStore.stop() }
async function clearPreviews() { try { await sharedThumbs().clear(); previewsStore.clearResults(); probeGen++; for (const k of Object.keys(probeMap)) delete probeMap[k]; previewBus.resetTick++; probe(previewItems.value) } finally { cachedCount.value = 0 } }
const volumeId_ = computed(() => props.volumeId)
const go = (prefix) => { if (allActive.value || (scope.value === 'all' && volAll.running)) setScope('folder'); return loadVolume(prefix) }
/** Folders the volume says are empty (folder_info): greyed with (empty), and hidden by default. */
let hideTouched = false
const hideEmpty = ref(mountsStore.config?.outputs?.hide_empty_folders !== false)   // the Default Configuration's starting value (true when it has none); changes stay with this window
watch(hideEmpty, () => { hideTouched = true })
const shownFolders = computed(() => (hideEmpty.value ? vol.folders.filter((f) => !vol.info[f]?.empty) : vol.folders))
const emptyHidden = computed(() => vol.folders.filter((f) => vol.info[f]?.empty).length)
const crumbs = computed(() => vol.prefix.split('/').filter(Boolean).map((name, i, a) => ({ name, prefix: a.slice(0, i + 1).join('/') })))
const s3ok = computed(() => vol.ok)
const openConfig = () => { ui.configFocus = 's3'; ui.configOpen = true; emit('close') }
const refresh = () => { clearColourCache(); emit('refresh'); loadVolume(vol.loaded ? vol.prefix : undefined, true); if (scope.value === 'all') ensureAll(true) }

/** The runs shown: the pod's and the saved ones, and the volume's folder runs that are not already one of them. */
const nameFilter = ref('')
const merged = computed(() => mergeWithVolume(shown.value, vol.runs))
/** The file-name filter narrows every run (pod, saved and volume) to the files that match, and drops the runs with none. */
const all = computed(() => (nameFilter.value.trim() ? merged.value.map((r) => filterByName(r, nameFilter.value)).filter((r) => r.files.length) : merged.value))
const matchCount = computed(() => fileCount(all.value))
/** Render sequences (docs/ADR-048): the DPX sequences this window lists (folder scope respected) are what the core renders; the proxies' state is asked in ONE batched call per open (and again when a job ends) for the tile badges and the viewer. */
const renders = useRendersStore()
const publishStore = usePublishStore(), publishOpen = ref(false), apStore = useAutopublishStore()
onMounted(() => { publishStore.loadSettings(); apStore.loadReviews(); if (ui.openPublish) { ui.openPublish = false; publishOpen.value = true } })   // the Queue's Publishing section asks for the Publish window
watch(() => renders.finished, () => apStore.loadReviews())   // a render job ended: its review may exist now
/** The Publish window opens with the review and proxy files of the sequences listed here already ticked (the ones that are on this PC). */
const publishPreselect = computed(() => {
  const out = []
  for (const it of renderItems.value) {
    const d = renders.reviewFor(it), p = renders.proxyFor(it)
    if (d && d.exists_local) { const dir = localPath(d.file).replace(/[^/]*$/, ''); const mp4 = (d.files || []).filter((f) => /\.(mp4|mov)$/i.test(f.name)); if (mp4.length) out.push(...mp4.map((f) => `${dir}${f.name}`)); else out.push(localPath(d.file)) }
    else if (p && p.exists_local) out.push(`.proxies/${it.dir ? `${it.dir}/` : ''}${it.name}${p.width === 'source' || p.width == null ? '' : `_${p.width}`}.mp4`)
  }
  return [...new Set(out)]
})
const renderTiles = computed(() => all.value.flatMap((r) => galleryTiles(r.files)))
const renderSeqs = computed(() => sequenceItems(renderTiles.value))
const renderItems = computed(() => renderSeqs.value.items), renderSkipped = computed(() => renderSeqs.value.skipped)
const renderJob = computed(() => { const j = renders.jobForPod(props.pod.id); return isActive(j) ? j : null })
let proxyTimer = null
const proxySig = computed(() => renderItems.value.map((i) => `${i.dir}/${i.name}`).join('|'))
watch(proxySig, () => { clearTimeout(proxyTimer); proxyTimer = setTimeout(() => renders.loadProxies({ pod_id: props.pod.id, ...(props.volumeId ? { volume_id: props.volumeId } : {}), items: renderItems.value.map((i) => ({ dir: i.dir, name: i.name })) }), 120) }, { immediate: true })
onMounted(() => renders.watch())
onBeforeUnmount(() => clearTimeout(proxyTimer))
/** Where a run's files are fetched from: a running pod's address when there is one, else the volume over S3 (its keys set), else nowhere (only listed). */
const baseFor = (r) => props.base || (s3ok.value ? s3Base(props.volumeId) : '')
const anyBase = computed(() => !!props.base || s3ok.value)
const idOf = (r) => (r.source === 'volume' ? r.folder.split('/').pop().slice(-8).replace(/[^\w.-]/g, '_') : r.prompt_id.slice(0, 8))
/** Every run's files in one zip, a folder per run. */
async function zipAll() {
  zipping.value = true
  try { await core.files.downloadZip(all.value.flatMap((r) => r.files.map((f) => ({ url: viewUrl(baseFor(r), f, { web: true }), name: `${(runName(r) || (r.source === 'volume' ? r.folder.split('/').pop() : '') || String(r.started_at).replace(/[:T]/g, '-').slice(0, 19)).replace(/[^\w.-]+/g, '_')}-${idOf(r)}/${[f.subfolder, f.filename].filter(Boolean).join('/')}` }))), `${props.pod.name}-outputs.zip`) } catch (e) { alert(errorText(e)) } finally { zipping.value = false }
}
// the cache lookups start once everything above exists (the sequences, the addresses)
watch(previewItems, (its) => probe(its))
onMounted(() => probe(previewItems.value))
</script>

<style scoped>
/* the Generate window's scope alert stays on screen while the body scrolls; its Bootstrap background is opaque */
/* a normal block at the top of the body (it scrolls away with the content); the folder list is at most five rows, then it scrolls inside its box */
.gen-scope-list { max-height: 6.6rem; overflow-y: auto; }
.gen-scope-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
</style>
