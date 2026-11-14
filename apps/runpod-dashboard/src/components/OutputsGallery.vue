<template>
  <div data-testid="outputs-gallery">
    <div v-if="!files.length" class="text-body-secondary small" data-testid="outputs-empty">{{ $t('outputs.none') }}</div>
    <div v-else class="gallery">
      <button v-for="(f, i) in files" :key="`${f.type}/${f.subfolder}/${f.filename}`" type="button" class="tile" data-testid="outputs-tile" :data-kind="f.kind" :data-type="f.type" :title="f.filename" @click="current = i">
        <img v-if="f.kind === 'image'" :src="viewUrl(base, f)" :alt="f.filename" loading="lazy" class="thumb" />
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
import OutputViewerModal from './OutputViewerModal.vue'

const props = defineProps({ files: { type: Array, default: () => [] }, base: { type: String, default: '' } })
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
