<template>
  <div data-testid="outputs-gallery">
    <div v-if="!files.length" class="text-body-secondary small" data-testid="outputs-empty">{{ $t('outputs.none') }}</div>
    <div v-if="files.length && !hideZip" class="d-flex align-items-center gap-2 mb-2 small">
      <span class="text-body-secondary">{{ $t('outputs.filesCount', { n: files.length }) }}</span>
      <BButton variant="outline-light" size="sm" class="ms-auto" :disabled="!canZip || zipping" :title="canZip ? '' : $t('outputs.zipApp')" data-testid="outputs-zip" @click="zip"><BSpinner v-if="zipping" small class="me-1" /><i v-else class="fa-solid fa-file-zipper me-1"></i>{{ $t('outputs.zip') }}</BButton>
      <span v-if="zipNote" class="text-body-secondary" data-testid="outputs-zip-note">{{ zipNote }}</span>
    </div>
    <div v-if="files.length" class="gallery">
      <button v-for="(f, i) in files" :key="`${f.type}/${f.subfolder}/${f.filename}`" type="button" class="tile" data-testid="outputs-tile" :data-kind="f.kind" :data-type="f.type" :title="f.filename" @click="current = i">
        <img v-if="f.kind === 'image'" :src="viewUrl(base, f, { thumb: true })" :alt="f.filename" loading="lazy" class="thumb" />
        <video v-else-if="f.kind === 'video'" :src="viewUrl(base, f)" preload="metadata" muted class="thumb"></video>
        <span v-else class="thumb d-flex align-items-center justify-content-center text-body-secondary"><i class="fa-solid fs-3" :class="f.kind === 'audio' ? 'fa-music' : 'fa-file'"></i></span>
        <span class="cap text-truncate">{{ f.filename }}</span>
        <span v-if="f.type === 'temp'" class="badge text-bg-secondary tag">{{ $t('outputs.type.temp') }}</span>
      </button>
    </div>
    <OutputViewerModal :file="files[current] || null" :base="base" :index="current ?? 0" :count="files.length" @close="current = null" @step="(d) => (current = Math.min(files.length - 1, Math.max(0, current + d)))" />
  </div>
</template>

<script setup>
/**
 * OutputsGallery: the files a run produced (OutputFile: filename, subfolder, type output|temp, kind image|video|audio|other) as a grid of thumbnails read from the pod's ComfyUI /view.
 * Reusable: it only needs the pod's web address (`base`) and the list; a click opens the viewer (large, Previous/Next, Open, Download).
 */
import { ref, watch } from 'vue'
import { viewUrl } from '../utils/outputs'
import { core } from '../api/bridge'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import OutputViewerModal from './OutputViewerModal.vue'

const props = defineProps({ files: { type: Array, default: () => [] }, base: { type: String, default: '' }, zipName: { type: String, default: 'outputs.zip' }, hideZip: { type: Boolean, default: false } })
const canZip = !!core?.files?.downloadZip
const zipping = ref(false), zipNote = ref('')
/** All of this list in one zip: a Save As dialog, then the main process streams the files from the pod into it (the app only). */
async function zip() {
  zipping.value = true; zipNote.value = ''
  try {
    const r = await core.files.downloadZip(props.files.map((f) => ({ url: viewUrl(props.base, f, { web: true }), name: [f.subfolder, f.filename].filter(Boolean).join('/') })), props.zipName)
    if (!r.canceled) zipNote.value = t('outputs.zipDone', { n: r.files })
  } catch (e) { zipNote.value = errorText(e) } finally { zipping.value = false }
}
const current = ref(null)
watch(() => props.files, () => { current.value = null })
</script>

<style scoped>
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); gap: 0.5rem; }
.tile { position: relative; display: flex; flex-direction: column; gap: 0.25rem; padding: 0.25rem; background: #20232a; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 0.375rem; color: inherit; text-align: left; cursor: pointer; }
.tile:hover { border-color: #508cff; }
.thumb { width: 100%; height: 6.5rem; object-fit: cover; border-radius: 0.25rem; background: #14161b; }
.cap { font-size: 0.72rem; color: var(--bs-secondary-color); }
.tag { position: absolute; top: 0.4rem; left: 0.4rem; font-weight: 400; }
</style>
