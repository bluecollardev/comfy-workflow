<template>
  <div data-testid="outputs-gallery">
    <div v-if="!files.length" class="text-body-secondary small" data-testid="outputs-empty">{{ $t('outputs.none') }}</div>
    <div v-if="files.length && !hideZip" class="d-flex align-items-center gap-2 mb-2 small">
      <span class="text-body-secondary" data-testid="outputs-files-count">{{ totalFiles > files.length ? $t('outputs.filesOf', { n: files.length, total: totalFiles }) : $t('outputs.filesCount', { n: files.length }) }}</span>
      <BButton variant="outline-light" size="sm" class="ms-auto" :disabled="!canZip || zipping || offline" :title="canZip ? '' : $t('outputs.zipApp')" data-testid="outputs-zip" @click="zip"><BSpinner v-if="zipping" small class="me-1" /><i v-else class="fa-solid fa-file-zipper me-1"></i>{{ $t('outputs.zip') }}</BButton>
      <span v-if="zipNote" class="text-body-secondary" data-testid="outputs-zip-note">{{ zipNote }}</span>
    </div>
    <div v-if="files.length" class="gallery">
      <button v-for="t in tiles" :key="t.key" type="button" class="tile" data-testid="outputs-tile" :disabled="offline" :data-offline="offline ? 'true' : undefined" :data-kind="t.kind" :data-type="t.file.type" :data-frames="t.frames ? t.frames.length : undefined" :title="t.name || t.file.filename" @click="open(t)">
        <span v-if="offline && t.kind !== 'dpx'" class="thumb d-flex align-items-center justify-content-center text-body-secondary" data-testid="outputs-offline-thumb"><i class="fa-solid fs-3" :class="{ image: 'fa-image', video: 'fa-film', audio: 'fa-music' }[t.kind] || 'fa-file'"></i></span>
        <img v-else-if="t.kind === 'image'" :src="viewUrl(base, t.file, { thumb: true })" :alt="t.file.filename" loading="lazy" class="thumb" />
        <video v-else-if="t.kind === 'video'" :src="viewUrl(base, t.file)" preload="metadata" muted class="thumb"></video>
        <span v-else-if="t.kind === 'dpx'" class="thumb d-flex flex-column align-items-center justify-content-center text-body-secondary position-relative" data-testid="outputs-dpx-placeholder"><SequenceThumb :tile="t" :base="base" :scope="scope" :volume-name="volumeName" :offline="offline" @state="(s) => (thumbState[t.key] = s)" /><i v-if="!['ready', 'empty'].includes(thumbState[t.key])" class="fa-solid fa-film fs-3"></i><span class="small mt-1 dpxbadge" :class="{ over: thumbState[t.key] === 'ready' }" data-testid="outputs-dpx-badge">{{ t.frames.length > 1 ? $t('outputs.dpx.badge', { n: t.frames.length }) : 'DPX' }}</span><span v-if="problemCounts[t.key]" class="small text-warning" data-testid="outputs-dpx-problems">{{ $t('outputs.dpx.problemsOf', { n: problemCounts[t.key], total: t.frames.length }) }}</span><span v-if="proxyOf(t) || reviewOf(t)" class="rbadges"><span v-if="reviewOf(t)" class="badge text-bg-success" data-testid="outputs-dpx-review" :data-version="reviewOf(t).version">{{ $t('outputs.render.badgeReview', { v: String(reviewOf(t).version).padStart(3, '0') }) }}</span><ApproveControl v-if="reviewOf(t)" :shot="reviewOf(t).shot" :version="reviewOf(t).version" /><span v-if="proxyOf(t)" class="badge" :class="proxyOf(t).exists_local ? 'text-bg-success' : 'text-bg-info'" data-testid="outputs-dpx-rendered" :data-where="proxyOf(t).exists_local ? 'local' : 'remote'" :title="proxyOf(t).exists_local ? $t('outputs.render.badgeLocalTitle') : $t('outputs.render.badgeRemoteTitle')">{{ proxyOf(t).exists_local ? $t('outputs.render.badgeLocal') : $t('outputs.render.badgeRemote') }}</span><span v-if="proxyOf(t)?.partial" class="badge text-bg-warning" data-testid="outputs-dpx-partial">{{ $t('outputs.render.badgePartial') }}</span></span></span>
        <span v-else class="thumb d-flex align-items-center justify-content-center text-body-secondary"><i class="fa-solid fs-3" :class="t.kind === 'audio' ? 'fa-music' : 'fa-file'"></i></span>
        <span class="cap text-truncate">{{ t.name || t.file.filename }}</span>
        <span v-if="t.file.type === 'temp'" class="badge text-bg-secondary tag">{{ $t('outputs.type.temp') }}</span>
      </button>
    </div>
    <OutputViewerModal :file="viewable[current] || null" :base="base" :index="current ?? 0" :count="viewable.length" @close="current = null" @step="(d) => (current = Math.min(viewable.length - 1, Math.max(0, current + d)))" />
    <DpxViewerModal :frames="dpx ? dpx.frames : []" :base="base" :proxy="dpx ? proxyOf(dpx) : null" :review="dpx ? reviewOf(dpx) : null" :start-review="dpxReview" :sequence="dpx ? sequenceItem(dpx) : null" :pod-id="podId" @close="dpx = null" @problems="(n) => n && dpx && (problemCounts[dpx.key] = n)" />
  </div>
</template>

<script setup>
/**
 * OutputsGallery: the files a run produced (OutputFile: filename, subfolder, type output|temp, kind image|video|audio|other) as a grid of thumbnails read from the pod's ComfyUI /view.
 * Reusable: it only needs the pod's web address (`base`) and the list; a click opens the viewer (large, Previous/Next, Open, Download). A DPX sequence is one tile (frame count) opening the DPX quick-look viewer.
 */
import { computed, ref, watch } from 'vue'
import { viewUrl, galleryTiles } from '../utils/outputs'
import { core } from '../api/bridge'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import OutputViewerModal from './OutputViewerModal.vue'
import DpxViewerModal from './DpxViewerModal.vue'
import SequenceThumb from './SequenceThumb.vue'
import ApproveControl from './ApproveControl.vue'
import { useRendersStore } from '../stores/renders'
import { sequenceItem } from '../utils/renders'

const props = defineProps({ files: { type: Array, default: () => [] }, totalFiles: { type: Number, default: 0 }, base: { type: String, default: '' }, zipName: { type: String, default: 'outputs.zip' }, hideZip: { type: Boolean, default: false }, scope: { type: String, default: '' }, volumeName: { type: String, default: '' }, offline: { type: Boolean, default: false }, podId: { type: String, default: '' } })   // offline: no pod serves the files (a saved run): tiles list the names, nothing opens
const canZip = !!core?.files?.downloadZip
const renders = useRendersStore()
/** The rendered movie of a DPX sequence tile (docs/ADR-048), from the store's one batched list: on this PC, else ready on the volume, else none. */
const proxyOf = (t) => { const it = sequenceItem(t); const p = it && renders.proxyFor(it); return p && (p.exists_local || (p.exists_remote && p.remote_ready !== false)) ? p : null }
const zipping = ref(false), zipNote = ref('')
/** All of this list in one zip: a Save As dialog, then the main process streams the files from the pod into it (the app only). */
async function zip() {
  zipping.value = true; zipNote.value = ''
  try {
    const r = await core.files.downloadZip(props.files.map((f) => ({ url: viewUrl(props.base, f, { web: true }), name: [f.subfolder, f.filename].filter(Boolean).join('/') })), props.zipName)
    if (!r.canceled) zipNote.value = t('outputs.zipDone', { n: r.files })
  } catch (e) { zipNote.value = errorText(e) } finally { zipping.value = false }
}
/** The tiles: a DPX sequence is one tile (the browser cannot decode DPX; DpxViewerModal does, frame by frame). The other viewer steps through the files that are not DPX. */
const tiles = computed(() => galleryTiles(props.files))
const viewable = computed(() => tiles.value.filter((t) => t.kind !== 'dpx').map((t) => t.file))
const current = ref(null), dpx = ref(null), dpxReview = ref(false)
const reviewOf = (t) => { const it = sequenceItem(t); const d = it && renders.reviewFor(it); return d && (d.exists_local || d.exists_remote) ? d : null }
// "Play" on a finished review job (the Previews window) asks the store; the gallery that lists the sequence opens its viewer on the review video.
watch(() => renders.play, (p) => {
  if (!p) return
  const tile = tiles.value.find((t) => { const it = sequenceItem(t); return it && it.dir === p.dir && it.name === p.name })
  if (tile && !props.offline) { dpxReview.value = !!p.review; dpx.value = tile; renders.play = null }
})
const thumbState = ref({})   // DPX tile key -> its preview's state (ready and empty replace the film icon)
const problemCounts = ref({})   // DPX tile key -> how many of its frames were found empty (once the viewer has loaded or cached them)
const open = (t) => { if (props.offline) return; if (t.kind === 'dpx') { dpxReview.value = false; dpx.value = t } else current.value = viewable.value.indexOf(t.file) }
watch(() => props.files, () => { current.value = null; dpx.value = null; problemCounts.value = {} })
</script>

<style scoped>
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.5rem; }
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
