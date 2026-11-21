<template>
  <span ref="root" class="lm" data-testid="outputs-media">
    <!-- a video is a still (its poster JPEG, else its first frame captured in the page) with a play mark, in a box of the VIDEO'S OWN ASPECT RATIO (16:9 until known); a click on it is the PARENT's click (the tile or
         row opens the modal viewer): no player lives in the tile -->
    <span v-if="kind === 'video'" class="thumb vposter" role="img" :style="{ aspectRatio: String(ratio) }" :data-ratio="ratio.toFixed(3)" :title="failed ? $t('outputs.video.noPreview') : $t('outputs.video.play')" :aria-label="$t('outputs.video.play')" data-testid="outputs-video-poster" :data-poster="poster ? 'yes' : shot ? 'frame' : 'no'">
      <img v-if="poster && near" :src="poster" alt="" class="vimg" loading="lazy" decoding="async" data-testid="outputs-video-poster-img" @load="onImg" />
      <img v-else-if="shot" :src="shot" alt="" class="vimg" decoding="async" data-testid="outputs-video-frame-img" />
      <i v-else class="fa-solid fa-film fs-3 text-body-secondary"></i>
      <i class="fa-solid fa-circle-play vplay"></i>
    </span>
    <img v-else-if="kind === 'image' && near" :src="src" :alt="alt" class="thumb" data-testid="outputs-image-thumb" />
    <span v-else class="thumb d-flex align-items-center justify-content-center text-body-secondary" data-testid="outputs-media-idle"><i class="fa-solid fs-3 fa-image"></i></span>
  </span>
</template>

<script setup>
/**
 * LazyMedia: the thumbnail of an image or a video file in the gallery, made only while its tile is near the viewport. A video shows its first-frame POSTER (a small JPEG the pod made, `poster`), else its
 * first frame captured here in the page (utils/videothumb.js: two at a time, nothing left playing, kept by address and shared by every tile of the same file), else a film icon (a codec the page cannot
 * decode: the tooltip says so). The picture box takes the video's own aspect ratio (from the capture, or the poster JPEG's natural size; 16:9 until known) at the tile's fixed height, so a 4:3 or a portrait
 * video is not letterboxed into a 16:9 box. It never holds a <video>: clicking the video is the parent's click and opens the modal viewer (Lucas, 2026-11-21).
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { firstFrame } from '../utils/videothumb'

const props = defineProps({ kind: { type: String, required: true }, src: { type: String, required: true }, alt: { type: String, default: '' }, /** the first frame's JPEG for a video (utils/framejob.js posterUrl), when the pod has made it */ poster: { type: String, default: '' } })
const root = ref(null), near = ref(false), shot = ref(''), failed = ref(false), ratio = ref(16 / 9)
let io = null, gone = false
const onImg = (e) => { const { naturalWidth: w, naturalHeight: h } = e.target; if (w > 0 && h > 0) ratio.value = w / h }
async function capture() {
  if (props.kind !== 'video' || shot.value || failed.value || !props.src) return
  if (props.poster) return   // the pod's poster JPEG is the picture (and gives the ratio on load): no capture
  const r = await firstFrame(props.src)
  if (gone) return
  if (r.url) { shot.value = r.url; if (r.w > 0 && r.h > 0) ratio.value = r.w / r.h } else failed.value = true
}
let wait = null   // a short wait before a capture: the pod's poster listing may be on its way, and a poster JPEG makes the capture pointless
watch(near, (n) => { clearTimeout(wait); if (n) wait = setTimeout(capture, 400) })
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') { near.value = true; return }
  io = new IntersectionObserver((es) => { for (const e of es) near.value = e.isIntersecting }, { rootMargin: '150px' })
  io.observe(root.value)
})
onBeforeUnmount(() => { gone = true; clearTimeout(wait); io?.disconnect() })
</script>

<style scoped>
.lm { display: block; }
.thumb { width: 100%; height: 6.5rem; object-fit: cover; border-radius: 0.25rem; background: #14161b; }
/* a video: the tile's fixed height, the width follows the video's ratio (never wider than the cell), the picture contained, no letterbox bars of a fixed 16:9 box */
.vposter { position: relative; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; overflow: hidden; cursor: pointer; width: auto; max-width: 100%; }
.vimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.vplay { position: absolute; right: 0.35rem; bottom: 0.3rem; font-size: 1.1rem; color: rgba(255, 255, 255, 0.85); text-shadow: 0 0 4px #000; pointer-events: none; }
</style>
