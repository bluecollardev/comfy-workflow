<template>
  <div data-testid="outputs-gallery">
    <div v-if="!files.length" class="text-body-secondary small" data-testid="outputs-empty">{{ $t('outputs.none') }}</div>
    <div v-if="files.length && !hideZip" class="d-flex align-items-center gap-2 mb-2 small">
      <span class="text-body-secondary" data-testid="outputs-files-count">{{ totalShown > shownCount ? $t('outputs.filesOf', { n: shownCount, total: totalShown }) : $t('outputs.filesCount', { n: shownCount }) }}</span>
      <BButton variant="outline-light" size="sm" class="ms-auto" :disabled="!canZip || zipping || offline" :title="canZip ? '' : $t('outputs.zipApp')" data-testid="outputs-zip" @click="zip"><BSpinner v-if="zipping" small class="me-1" /><i v-else class="fa-solid fa-file-zipper me-1"></i>{{ $t('outputs.zip') }}</BButton>
      <span v-if="zipNote" class="text-body-secondary" data-testid="outputs-zip-note">{{ zipNote }}</span>
    </div>
    <div v-if="seqCount || groupCount || tempCount" class="d-flex align-items-center flex-wrap gap-2 mb-2 small" data-testid="outputs-seq-toolbar">
      <span v-if="seqCount" class="text-body-secondary" data-testid="outputs-seq-count">{{ $t('outputs.dpx.sequencesCount', { n: seqCount, open: openCount }) }}</span>
      <span v-if="groupCount" class="text-body-secondary" data-testid="outputs-group-count">{{ $t('outputs.group.groupsCount', { n: groupCount, open: groupOpenCount }) }}</span>
      <span class="ms-auto"></span>
      <BButton v-if="tempCount" variant="outline-light" size="sm" :aria-pressed="groupView.showTemp ? 'true' : 'false'" data-testid="outputs-temp-toggle" @click="setShowTemp(!groupView.showTemp)"><i class="fa-solid me-1" :class="groupView.showTemp ? 'fa-eye-slash' : 'fa-eye'"></i>{{ groupView.showTemp ? $t('outputs.group.hideTemp') : $t('outputs.group.showTemp') }} <span class="text-body-secondary">({{ tempCount }})</span></BButton>
      <BButton v-if="seqCount || groupCount" variant="outline-light" size="sm" data-testid="outputs-collapse-all" @click="setAll('collapsed')"><i class="fa-solid fa-compress me-1"></i>{{ $t('outputs.dpx.collapseAll') }}</BButton>
      <BButton v-if="seqCount || groupCount" variant="outline-light" size="sm" data-testid="outputs-expand-all" @click="setAll('expanded')"><i class="fa-solid fa-expand me-1"></i>{{ $t('outputs.dpx.expandAll') }}</BButton>
    </div>
    <div v-if="files.length" class="gallery">
      <div v-for="t in tiles" :key="t.key" class="cell" :class="{ wide: (t.kind === 'dpx' && t.frames.length > 1) || isGroup(t), seq: t.kind === 'dpx' && t.frames.length > 1 }" data-testid="outputs-cell">
      <div v-if="isGroup(t)" class="group" data-testid="outputs-group" :data-kind="t.kind" :data-cat="t.cat || 'temp'" :data-count="t.count" :data-expanded="groupExpanded(t) ? 'true' : 'false'">
        <div class="head" data-testid="outputs-group-head">
          <i class="fa-solid" :class="groupIcon(t)"></i>
          <span class="headname" :title="groupLabel(t)" data-testid="outputs-group-label">{{ groupLabel(t) }}</span>
          <BButton variant="outline-light" size="sm" class="headbtn" :aria-expanded="groupExpanded(t) ? 'true' : 'false'" data-testid="outputs-group-toggle" @click="toggleGroup(t)"><i class="fa-solid me-1" :class="groupOpen(t) ? 'fa-chevron-up' : 'fa-chevron-down'"></i>{{ groupOpen(t) ? $t('outputs.dpx.collapse') : $t('outputs.dpx.expand') }}</BButton>
        </div>
        <div v-if="!groupExpanded(t)" class="tile grouptile" data-testid="outputs-group-preview" @click="toggleGroup(t)">
          <LazyMedia v-if="!offline && hasPreview(t) && t.main" :kind="t.cat" :src="viewUrl(base, t.main, t.cat === 'image' ? { thumb: true } : undefined)" :alt="t.main.filename" />
          <span v-else class="thumb d-flex align-items-center justify-content-center text-body-secondary" data-testid="outputs-group-icon"><i class="fa-solid fs-3" :class="groupIcon(t)"></i></span>
          <span v-if="t.main" class="cap" :title="t.main.filename" data-testid="outputs-group-main-name">{{ $t('outputs.group.main') }}: {{ shortName(t.main.filename) }}</span>
          <span v-if="t.versions && t.versions[0] !== t.versions[1]" class="cap" data-testid="outputs-group-versions">{{ $t('outputs.group.versionRange', { a: String(t.versions[0]).padStart(3, '0'), b: String(t.versions[1]).padStart(3, '0') }) }}</span>
        </div>
        <div v-if="groupExpanded(t)" class="grouprows" data-testid="outputs-group-rows" :data-shown="shownFiles(t).length">
          <div class="small text-body-secondary mb-1" data-testid="outputs-group-shown">{{ $t('outputs.group.shown', { shown: shownFiles(t).length, total: t.files.length }) }}</div>
          <div class="rowlist" :class="{ media: hasPreview(t) }">
            <button v-for="f in shownFiles(t)" :key="`${f.subfolder}/${f.filename}`" type="button" class="grow" data-testid="outputs-group-row" :data-main="f === t.main ? 'true' : undefined" :disabled="offline" :title="f.filename" @click="openFile(f)">
              <LazyMedia v-if="hasPreview(t) && !offline" :kind="f.kind" :src="viewUrl(base, f, f.kind === 'image' ? { thumb: true } : undefined)" :alt="f.filename" />
              <span class="gname" :title="f.filename">{{ shortName(f.filename) }}</span>
              <span v-if="f === t.main" class="badge text-bg-primary" data-testid="outputs-group-main">{{ $t('outputs.group.main') }}</span>
              <span v-if="f.bytes != null" class="text-body-secondary">{{ sizeText(f.bytes) }}</span>
            </button>
          </div>
          <PageSentinel :more="shownFiles(t).length < t.files.length" :shown="shownFiles(t).length" @more="groupMore(t)" />
          <div v-if="shownFiles(t).length < t.files.length" class="d-flex gap-2 mt-2">
            <BButton v-if="!HAS_IO" variant="outline-light" size="sm" data-testid="outputs-group-more" @click="groupMore(t)">{{ $t('outputs.dpx.showMore') }}</BButton>
            <BButton variant="outline-light" size="sm" data-testid="outputs-group-all" @click="groupShowAll(t)">{{ $t('outputs.group.showAll') }}</BButton>
          </div>
        </div>
      </div>
      <template v-else>
      <div v-if="t.kind === 'dpx' && t.frames.length > 1" class="head" data-testid="outputs-seq-head">
        <i class="fa-solid fa-film"></i>
        <span class="headname" :title="t.name || t.file.filename" data-testid="outputs-seq-name">{{ shortName(t.name || t.file.filename) }}</span>
        <span class="badge text-bg-secondary headcount" data-testid="outputs-seq-headcount">{{ t.frames.length }}</span>
        <span v-if="isExpanded(t)" class="small text-body-secondary" data-testid="outputs-seq-preview-count">{{ $t('outputs.dpx.framePreviews', { n: previewCount(t), total: t.frames.length }) }}</span>
        <span v-if="inJob(srcOf(t))" class="small text-info" data-testid="outputs-seq-job-progress">{{ $t('outputs.frames.progress', { done: jobDone(), total: fpState.job.total || t.frames.length }) }}</span>
        <span v-if="isExpanded(t) && fpState.error" class="small text-warning" data-testid="outputs-seq-job-error">{{ fpState.error }}</span>
        <BButton v-if="isExpanded(t) && !inJob(srcOf(t))" variant="outline-light" size="sm" class="headbtn" :disabled="!canJob || jobRunning()" :title="jobReason" data-testid="outputs-seq-load-frames" @click="loadFrames(t)"><i class="fa-solid fa-images me-1"></i>{{ $t('outputs.frames.load') }}</BButton>
        <BButton v-if="inJob(srcOf(t))" variant="outline-warning" size="sm" class="headbtn" data-testid="outputs-seq-stop-frames" @click="stopJob()"><i class="fa-solid fa-stop me-1"></i>{{ $t('outputs.frames.stop') }}</BButton>
        <BButton variant="outline-light" size="sm" class="headbtn" :aria-expanded="isExpanded(t) ? 'true' : 'false'" data-testid="outputs-seq-toggle" @click="toggleSeq(t)"><i class="fa-solid me-1" :class="isExpanded(t) ? 'fa-chevron-up' : 'fa-chevron-down'"></i>{{ isExpanded(t) ? $t('outputs.dpx.collapse') : $t('outputs.dpx.expand') }}</BButton>
      </div>
      <button type="button" class="tile" data-testid="outputs-tile" :disabled="offline" :data-offline="offline ? 'true' : undefined" :data-kind="t.kind" :data-type="t.file.type" :data-frames="t.frames ? t.frames.length : undefined" :title="t.name || t.file.filename" @click="open(t)">
        <span v-if="offline && t.kind !== 'dpx'" class="thumb d-flex align-items-center justify-content-center text-body-secondary" data-testid="outputs-offline-thumb"><i class="fa-solid fs-3" :class="{ image: 'fa-image', video: 'fa-film', audio: 'fa-music' }[t.kind] || 'fa-file'"></i></span>
        <LazyMedia v-else-if="t.kind === 'image'" kind="image" :src="viewUrl(base, t.file, { thumb: true })" :alt="t.file.filename" />
        <LazyMedia v-else-if="t.kind === 'video'" kind="video" :src="viewUrl(base, t.file)" />
        <span v-else-if="t.kind === 'dpx'" class="thumb d-flex flex-column align-items-center justify-content-center text-body-secondary position-relative" data-testid="outputs-dpx-placeholder"><SequenceThumb :tile="t" :base="base" :scope="scope" :volume-name="volumeName" :offline="offline" @state="(s) => (thumbState[t.key] = s)" @header="(h) => (thumbHeader[t.key] = h)" /><i v-if="!['ready', 'empty'].includes(thumbState[t.key])" class="fa-solid fa-film fs-3"></i><span class="small mt-1 dpxbadge" :class="{ over: thumbState[t.key] === 'ready' }" data-testid="outputs-dpx-badge">{{ t.frames.length > 1 ? $t('outputs.dpx.badge', { n: t.frames.length }) : 'DPX' }}</span><span v-if="problemCounts[t.key]" class="small text-warning" data-testid="outputs-dpx-problems">{{ $t('outputs.dpx.problemsOf', { n: problemCounts[t.key], total: t.frames.length }) }}</span><span v-if="proxyOf(t) || reviewOf(t)" class="rbadges"><span v-if="reviewOf(t)" class="badge text-bg-success" data-testid="outputs-dpx-review" :data-version="reviewOf(t).version">{{ $t('outputs.render.badgeReview', { v: String(reviewOf(t).version).padStart(3, '0') }) }}</span><ApproveControl v-if="reviewOf(t)" :shot="reviewOf(t).shot" :version="reviewOf(t).version" /><span v-if="proxyOf(t)" class="badge" :class="proxyOf(t).exists_local ? 'text-bg-success' : 'text-bg-info'" data-testid="outputs-dpx-rendered" :data-where="proxyOf(t).exists_local ? 'local' : 'remote'" :title="proxyOf(t).exists_local ? $t('outputs.render.badgeLocalTitle') : $t('outputs.render.badgeRemoteTitle')">{{ proxyOf(t).exists_local ? $t('outputs.render.badgeLocal') : $t('outputs.render.badgeRemote') }}</span><span v-if="proxyOf(t)?.partial" class="badge text-bg-warning" data-testid="outputs-dpx-partial">{{ $t('outputs.render.badgePartial') }}</span></span></span>
        <span v-else class="thumb d-flex align-items-center justify-content-center text-body-secondary"><i class="fa-solid fs-3" :class="t.kind === 'audio' ? 'fa-music' : 'fa-file'"></i></span>
        <span class="cap" :title="t.name || t.file.filename" data-testid="outputs-tile-name">{{ shortName(t.name || t.file.filename) }}</span>
        <SequenceColour v-if="t.kind === 'dpx'" :tile="t" :base="base" :offline="offline" :header="thumbHeader[t.key] || null" />
        <SequenceFrames v-if="t.kind === 'dpx'" :tile="t" :neutral="incompleteList" />
        <span v-if="t.file.type === 'temp'" class="badge text-bg-secondary tag">{{ $t('outputs.type.temp') }}</span>
      </button>
      <SequenceStrip v-if="t.kind === 'dpx' && t.frames.length > 1 && stripItems(t).length" :items="stripItems(t)" :disabled="offline" @open="(i) => openAt(t, i)" />
      <template v-if="t.kind === 'dpx' && t.frames.length > 1">
        <div v-if="isExpanded(t)" class="frames" data-testid="outputs-seq-frames" :data-shown="shownFrames(t).length">
          <div class="small text-body-secondary mb-1" data-testid="outputs-seq-frames-count">{{ $t('outputs.dpx.framesShown', { shown: shownFrames(t).length, total: t.frames.length }) }}</div>
          <div class="framelist">
            <button v-for="(f, i) in shownFrames(t)" :key="f.filename" type="button" class="frame" :class="{ hasprev: !!frameImg(t, f) }" data-testid="outputs-seq-frame" :disabled="offline" :title="f.filename" @click="openAt(t, i)"><img v-if="frameImg(t, f)" :src="frameImg(t, f)" alt="" class="fthumb" loading="lazy" decoding="async" data-testid="outputs-seq-frame-thumb" /><span class="frameline"><span>{{ frameNo(f) }}</span><i v-if="frameFailed(t, f)" class="fa-solid fa-triangle-exclamation text-warning" :title="frameFailed(t, f)" data-testid="outputs-seq-frame-warn"></i><span v-if="f.bytes != null" class="text-body-secondary">{{ sizeText(f.bytes) }}</span></span></button>
          </div>
          <PageSentinel :more="shownFrames(t).length < t.frames.length" :shown="shownFrames(t).length" @more="showMore(t)" />
          <div v-if="shownFrames(t).length < t.frames.length" class="d-flex gap-2 mt-2">
            <BButton v-if="!HAS_IO" variant="outline-light" size="sm" data-testid="outputs-seq-more" @click="showMore(t)">{{ $t('outputs.dpx.showMore') }}</BButton>
            <BButton variant="outline-light" size="sm" data-testid="outputs-seq-all" @click="showAll(t)">{{ $t('outputs.group.showAll') }}</BButton>
          </div>
        </div>
      </template>
      </template>
      </div>
    </div>
    <!-- Incomplete sequences (short of the EDL's cut, utils/incomplete.js) are hidden unless Show Incomplete is on; then they sit here, in their own collapsed group at the bottom of the run. Display only. -->
    <div v-if="hideIncomplete && incompleteTiles.length && groupView.showIncomplete" class="group mt-3" data-testid="outputs-incomplete-group" :data-count="incompleteTiles.length" :data-expanded="incOpen ? 'true' : 'false'">
      <div class="head" data-testid="outputs-incomplete-head">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span class="headname" data-testid="outputs-incomplete-label">{{ $t('outputs.incomplete.group', { n: incompleteTiles.length }) }}</span>
        <BButton variant="outline-light" size="sm" class="headbtn" :aria-expanded="incOpen ? 'true' : 'false'" data-testid="outputs-incomplete-toggle" @click="incOpen = !incOpen"><i class="fa-solid me-1" :class="incOpen ? 'fa-chevron-up' : 'fa-chevron-down'"></i>{{ incOpen ? $t('outputs.dpx.collapse') : $t('outputs.dpx.expand') }}</BButton>
      </div>
      <OutputsGallery v-if="incOpen" :files="incompleteFiles" :base="base" :scope="scope" :volume-name="volumeName" :offline="offline" :pod-id="podId" :pod-running="podRunning" hide-zip incomplete-list />
    </div>
    <OutputViewerModal :file="viewable[current] || null" :base="base" :index="current ?? 0" :count="viewable.length" @close="current = null" @step="(d) => (current = Math.min(viewable.length - 1, Math.max(0, current + d)))" />
    <DpxViewerModal :frames="dpx ? dpx.frames : []" :base="base" :proxy="dpx ? proxyOf(dpx) : null" :review="dpx ? reviewOf(dpx) : null" :start-review="dpxReview" :start-index="dpxStart" :sequence="dpx ? sequenceItem(dpx) : null" :pod-id="podId" @close="dpx = null" @problems="(n) => n && dpx && (problemCounts[dpx.key] = n)" />
  </div>
</template>

<script setup>
/**
 * OutputsGallery: the files a run produced (OutputFile: filename, subfolder, type output|temp, kind image|video|audio|other) as a grid of thumbnails read from the pod's ComfyUI /view.
 * Reusable: it only needs the pod's web address (`base`) and the list; a click opens the viewer (large, Previous/Next, Open, Download). A DPX sequence is one tile (frame count) opening the DPX quick-look viewer.
 */
import { computed, inject, reactive, ref, watch, watchEffect } from 'vue'
import { ensureMatch, expectedFramesOf } from '../utils/edlexpect'
import { incompleteOf, tileName } from '../utils/incomplete'
import { viewUrl, galleryTiles, sizeText, isDpx } from '../utils/outputs'
import { isExpanded, toggleSeq, setAll, shownFrames, showMore, showAll, groupView, groupExpanded, toggleGroup, shownFiles, groupMore, groupShowAll, setShowTemp, HAS_IO } from '../utils/dpxcollapse'
import { isTemp, groupTiles, tempGroup, shortName } from '../utils/videogroups'
import { availableFrames } from '../utils/framepreviews'
import { previewed } from '../utils/filmstrip'
import { fpState, startJob, stopJob, queueListing, previewUrl, jpgName, inJob, jobRunning, jobDone, failedOf, failReason } from '../utils/framejob'
import { previewBus } from '../utils/thumbsBus'
import LazyMedia from './LazyMedia.vue'
import PageSentinel from './PageSentinel.vue'
import SequenceStrip from './SequenceStrip.vue'
import { core } from '../api/bridge'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import OutputViewerModal from './OutputViewerModal.vue'
import DpxViewerModal from './DpxViewerModal.vue'
import SequenceThumb from './SequenceThumb.vue'
import SequenceColour from './SequenceColour.vue'
import SequenceFrames from './SequenceFrames.vue'
import ApproveControl from './ApproveControl.vue'
import { useRendersStore } from '../stores/renders'
import { sequenceItem } from '../utils/renders'

const props = defineProps({ podRunning: { type: Boolean, default: false }, files: { type: Array, default: () => [] }, totalFiles: { type: Number, default: 0 }, base: { type: String, default: '' }, zipName: { type: String, default: 'outputs.zip' }, hideZip: { type: Boolean, default: false }, hideIncomplete: { type: Boolean, default: false }, incompleteList: { type: Boolean, default: false }, scope: { type: String, default: '' }, volumeName: { type: String, default: '' }, offline: { type: Boolean, default: false }, podId: { type: String, default: '' } })   // offline: no pod serves the files (a saved run): tiles list the names, nothing opens
const canZip = !!core?.files?.downloadZip
const renders = useRendersStore()
/** The rendered movie of a DPX sequence tile (docs/ADR-048), from the store's one batched list: on this PC, else ready on the volume, else none. */
const proxyOf = (t) => { const it = sequenceItem(t); const p = it && renders.proxyFor(it); return p && (p.exists_local || (p.exists_remote && p.remote_ready !== false)) ? p : null }
const zipping = ref(false), zipNote = ref('')
/** All of this list in one zip: a Save As dialog, then the main process streams the files from the pod into it (the app only). */
async function zip() {
  zipping.value = true; zipNote.value = ''
  try {
    const r = await core.files.downloadZip(displayFiles.value.map((f) => ({ url: viewUrl(props.base, f, { web: true }), name: [f.subfolder, f.filename].filter(Boolean).join('/') })), props.zipName)
    if (!r.canceled) zipNote.value = t('outputs.zipDone', { n: r.files })
  } catch (e) { zipNote.value = errorText(e) } finally { zipping.value = false }
}
/** The tiles: a DPX sequence is one tile (the browser cannot decode DPX; DpxViewerModal does, frame by frame). The other viewer steps through the files that are not DPX. */
const tempFiles = computed(() => props.files.filter(isTemp))
const realFiles = computed(() => props.files.filter((f) => !isTemp(f)))
/** ComfyUI's temp previews are hidden unless Show Temp Files is on: not counted, not listed, never probed, no preview made. Display only, nothing is deleted. */
/** Incomplete sequences (utils/incomplete.js): short of the EDL's cut by the union of the frames over every run listed (injected by the window). Only with `hideIncomplete`; they leave the grid (and the counts) and, when Show Incomplete is on, are listed in their own group below. */
const unions = inject('frameUnions', null)
const incOpen = ref(false)
const seqTiles = computed(() => galleryTiles(realFiles.value).filter((t) => t.kind === 'dpx'))
watchEffect(() => { if (props.hideIncomplete) for (const t of seqTiles.value) ensureMatch(tileName(t)) })
const incompleteTiles = computed(() => (props.hideIncomplete ? seqTiles.value.filter((t) => incompleteOf(t, unions?.value, expectedFramesOf(tileName(t)))) : []))
const incompleteKeys = computed(() => new Set(incompleteTiles.value.map((t) => t.key)))
const incompleteFiles = computed(() => incompleteTiles.value.flatMap((t) => t.frames))
const incompleteSet = computed(() => new Set(incompleteFiles.value))
const displayFiles = computed(() => (incompleteSet.value.size ? (groupView.showTemp ? props.files : realFiles.value).filter((f) => !incompleteSet.value.has(f)) : groupView.showTemp ? props.files : realFiles.value))
const tempCount = computed(() => tempFiles.value.length)
const shownCount = computed(() => displayFiles.value.length)
const totalShown = computed(() => Math.max(shownCount.value, (props.totalFiles || 0) - (groupView.showTemp ? 0 : tempCount.value)))
/** Within a folder the files of one type are ONE group (Videos with a Main video, Images, Audio, Data, Other), each expandable; the shown temp files are their own last group. DPX sequences stay sequences. */
// The frame previews that exist in the app's cache for each EXPANDED sequence (never generated here): one batched cache read per sequence, redone when a preview is made.
const framePrev = reactive({}), prevMark = {}
async function ensurePrev(t) {
  const mark = String(previewBus.cacheVer)
  if (prevMark[t.key] === mark) return
  prevMark[t.key] = mark
  framePrev[t.key] = await availableFrames(props.scope || props.base, t.frames)
}
// Frame previews are a pod job (utils/framejob.js, libs/core/src/framepreviews.ts): one small JPEG per frame, made where the files are. The rows read those JPEGs through /view and count them from one listing.
const srcOf = (t) => t.frames[0]?.subfolder || ''
const canJob = computed(() => !!props.podId && props.podRunning && !props.offline)
const jobReason = computed(() => (!props.podId ? t('outputs.frames.noPod') : !props.podRunning ? t('outputs.frames.podOff') : props.offline ? t('outputs.frames.offline') : ''))
const jpgNames = (t) => fpState.listing[srcOf(t)]?.names || null
const frameImg = (t, f) => framePrev[t.key]?.get(f.filename) || (jpgNames(t)?.has(jpgName(f.filename)) ? previewUrl(props.base, f) : '')
const previewCount = (t) => t.frames.reduce((n, f) => n + (frameImg(t, f) ? 1 : 0), 0)
const frameFailed = (t, f) => (failedOf(srcOf(t)).has(jpgName(f.filename)) ? failReason(srcOf(t), jpgName(f.filename)) : '')
const stemOf = (t) => (t.frames[0]?.filename || '').replace(/\.\d+\.dpx$/i, '')
function loadFrames(t) { startJob({ podId: props.podId, items: [{ src_dir: srcOf(t), frames: t.frames.length, stem: stemOf(t) }], skipExisting: true }) }
const isSeq = (t) => t.kind === 'dpx' && t.frames.length > 1
const tiles = computed(() => { const ts = groupTiles(galleryTiles(realFiles.value).filter((t) => !(t.kind === 'dpx' && incompleteKeys.value.has(t.key)))); const tg = groupView.showTemp ? tempGroup(tempFiles.value) : null; return tg ? [...ts, tg] : ts })
// Every sequence row (collapsed or not) shows the frames that have a preview beside its first frame: the pod's JPEGs are listed in ONE batched call for all the sequences of this list (and for
// every gallery asking at the same moment, utils/framejob.js queueListing), the cache is read locally; nothing is fetched or generated here.
watchEffect(() => {
  const seqs = tiles.value.filter(isSeq)
  for (const t of seqs) ensurePrev(t)
  if (canJob.value) queueListing(props.podId, seqs.map(srcOf))
})
/** The frames of a sequence that have a preview (the first frame is the tile beside the strip), for the strip to sample; reads fpState.listing and framePrev so it follows both. */
const stripItems = (t) => previewed(t.frames, (f) => frameImg(t, f)).map((p) => ({ index: p.index, no: frameNo(p.frame), name: p.frame.filename, src: p.src }))
const viewable = computed(() => displayFiles.value.filter((f) => !isDpx(f.filename)))
const isGroup = (t) => t.kind === 'fgroup' || t.kind === 'tempgroup'
const groupCount = computed(() => tiles.value.filter(isGroup).length)
const groupOpenCount = computed(() => tiles.value.filter((t) => isGroup(t) && groupExpanded(t)).length)
const groupOpen = groupExpanded
/** A group whose rows carry a preview (one lazy thumbnail or player each, under the player cap): Videos and Images. */
const hasPreview = (t) => t.kind === 'fgroup' && (t.cat === 'video' || t.cat === 'image')
const groupIcon = (t) => (t.kind === 'tempgroup' ? 'fa-hourglass-half' : { video: 'fa-film', image: 'fa-image', audio: 'fa-music', data: 'fa-file-lines' }[t.cat] || 'fa-file')
const groupLabel = (g) => `${t(`outputs.group.label.${g.kind === 'tempgroup' ? 'temp' : g.cat}.${g.count === 1 ? 'one' : 'other'}`, { n: g.count })}${g.bytes ? ` · ${sizeText(g.bytes)}` : ''}`
const openFile = (f) => { if (!props.offline) current.value = viewable.value.indexOf(f) }
const current = ref(null), dpx = ref(null), dpxReview = ref(false), dpxStart = ref(0)
/** The sequences in this list (a single DPX file is not a sequence to collapse), and how many are open now. */
const seqCount = computed(() => tiles.value.filter((t) => t.kind === 'dpx' && t.frames.length > 1).length)
const openCount = computed(() => tiles.value.filter((t) => t.kind === 'dpx' && t.frames.length > 1 && isExpanded(t)).length)
const frameNo = (f) => /(\d+)\.dpx$/i.exec(f.filename)?.[1] ?? f.filename
/** A frame of an expanded sequence opens the quick-look viewer on that frame. */
const openAt = (t, i) => { if (props.offline) return; dpxReview.value = false; dpxStart.value = i; dpx.value = t }
const reviewOf = (t) => { const it = sequenceItem(t); const d = it && renders.reviewFor(it); return d && (d.exists_local || d.exists_remote) ? d : null }
// "Play" on a finished review job (the Previews window) asks the store; the gallery that lists the sequence opens its viewer on the review video.
watch(() => renders.play, (p) => {
  if (!p) return
  const tile = tiles.value.find((t) => { const it = sequenceItem(t); return it && it.dir === p.dir && it.name === p.name })
  if (tile && !props.offline) { dpxReview.value = !!p.review; dpx.value = tile; renders.play = null }
})
const thumbHeader = ref({})   // DPX tile key -> the first frame's header colour fields, once its preview has decoded it (the chips show them)
const thumbState = ref({})   // DPX tile key -> its preview's state (ready and empty replace the film icon)
const problemCounts = ref({})   // DPX tile key -> how many of its frames were found empty (once the viewer has loaded or cached them)
const open = (t) => { if (props.offline) return; if (t.kind === 'dpx') { dpxReview.value = false; dpxStart.value = 0; dpx.value = t } else current.value = viewable.value.indexOf(t.file) }
watch(() => props.files, () => { current.value = null; dpx.value = null; problemCounts.value = {} })
</script>

<style scoped>
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.5rem; }
.cell { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.cell.wide { grid-column: 1 / -1; }
.cell .tile { width: 100%; }
.cell.wide .tile { max-width: 9.5rem; }
/* a sequence row: header across, the first-frame tile at the left, the filmstrip filling the rest of the row, the expanded frame list across below */
.cell.seq { display: grid; grid-template-columns: 9.5rem minmax(0, 1fr); column-gap: 0.5rem; row-gap: 0.25rem; align-items: start; }
.cell.seq > .head, .cell.seq > .frames { grid-column: 1 / -1; }
.head { display: flex; align-items: center; gap: 0.4rem; min-width: 0; padding: 0.15rem 0.1rem; font-size: 0.78rem; }
.headname { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
.headcount { font-weight: 400; }
.headbtn { flex: 0 0 auto; margin-left: auto; }
.cap { overflow-wrap: anywhere; }
.group { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.grouptile { width: 100%; }
.cell.wide .grouptile { max-width: 14rem; }
.grouprows { padding: 0.4rem; background: #1a1d23; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 0.375rem; }
.rowlist { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 0.25rem; }
.rowlist.media { grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); }
.grow { display: flex; flex-direction: column; gap: 0.15rem; padding: 0.25rem 0.4rem; font-size: 0.72rem; text-align: left; background: #20232a; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 0.25rem; color: inherit; cursor: pointer; min-width: 0; }
.grow:hover:not(:disabled) { border-color: #508cff; }
.gname { min-width: 0; }
.frames { padding: 0.4rem; background: #1a1d23; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 0.375rem; }
.framelist { display: grid; grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr)); gap: 0.25rem; }
.frame { display: flex; justify-content: space-between; gap: 0.4rem; padding: 0.15rem 0.4rem; font-size: 0.72rem; background: #20232a; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 0.25rem; color: inherit; cursor: pointer; }
.fthumb { width: 2.8rem; height: 1.6rem; object-fit: cover; border-radius: 0.15rem; flex: 0 0 auto; }
.frame.hasprev { flex-direction: column; align-items: stretch; }
.frame.hasprev .fthumb { width: 100%; height: auto; aspect-ratio: 16 / 9; }
.frameline { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; }
.head .headbtn + .headbtn { margin-left: 0; }
.frame:hover:not(:disabled) { border-color: #508cff; }
.tile { position: relative; display: flex; flex-direction: column; gap: 0.25rem; padding: 0.25rem; background: #20232a; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 0.375rem; color: inherit; text-align: left; cursor: pointer; }
.tile:disabled { cursor: default; opacity: 0.8; }
.tile:hover:not(:disabled) { border-color: #508cff; }
.thumb { width: 100%; height: 6.5rem; object-fit: cover; border-radius: 0.25rem; background: #14161b; }
.cap { font-size: 0.72rem; color: var(--bs-secondary-color); }
.dpxbadge { position: relative; z-index: 1; }
.dpxbadge.over { position: absolute; left: 0.3rem; bottom: 0.3rem; margin: 0 !important; padding: 0 0.3rem; background: rgba(0, 0, 0, 0.65); color: #fff; border-radius: 0.2rem; }
.rbadges { position: absolute; right: 0.3rem; bottom: 0.3rem; z-index: 1; display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem; }
.rbadges .badge { font-weight: 400; }
.tag { position: absolute; top: 0.4rem; left: 0.4rem; font-weight: 400; }
</style>
