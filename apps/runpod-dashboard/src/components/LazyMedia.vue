<template>
  <span ref="root" class="lm" data-testid="outputs-media">
    <!-- a video is a still (its poster JPEG, else its first frame captured in the page) in a box of the VIDEO'S OWN ASPECT RATIO (16:9 until known); a click on it is the PARENT's click (the tile or row opens the
         modal viewer): no player lives in the tile. Order of what it shows: poster, captured frame, shimmer while it is on its way, and the film icon ONLY after a definite failure. No corner button: with a
         real picture a play glyph shows in the CENTRE on hover or focus only. -->
    <span v-if="kind === 'video'" class="thumb vposter" role="img" :style="boxStyle" :data-ratio="ratio.toFixed(3)" :title="vTitle" :aria-label="$t('outputs.video.play')" data-testid="outputs-video-poster" :data-poster="poster && !posterBad ? 'yes' : shot ? 'frame' : failed ? 'no' : 'pending'">
      <CachedImg v-if="poster && near && !posterBad" :src="poster" alt="" class="vimg" loading="lazy" decoding="async" data-testid="outputs-video-poster-img" @load="onImg" @error="onPosterError" />
      <img v-else-if="shot" :src="shot" alt="" class="vimg" decoding="async" data-testid="outputs-video-frame-img" />
      <span v-else-if="failed" class="vfallback" data-testid="outputs-video-fallback">
        <i class="fa-solid fa-film fs-3 text-body-secondary"></i>
        <span v-if="reason === 'timeout' && !retried" class="vretry" role="button" tabindex="0" :title="$t('outputs.video.timedOut')" :aria-label="$t('outputs.video.retry')" data-testid="outputs-video-retry" @click.stop.prevent="retry" @keydown.enter.stop.prevent="retry"><i class="fa-solid fa-rotate-right"></i></span>
      </span>
      <span v-else class="shimmer" data-testid="outputs-video-loading"></span>
      <i v-if="poster && !posterBad || shot" class="fa-solid fa-play vhover"></i>
    </span>
    <!-- an image: its own thumbnail (the file loaded lazily and scaled by CSS) with the shimmer until it has loaded; the image icon ONLY when it cannot load or is too big to be worth loading -->
    <span v-else-if="kind === 'image'" class="thumb imgbox" :title="iTitle" data-testid="outputs-image-box" :data-state="tooBig ? 'toobig' : imgFailed ? 'failed' : imgReady ? 'ready' : 'pending'">
      <CachedImg v-if="near && !tooBig" :src="src" :alt="alt" class="iimg" :class="{ ready: imgReady }" loading="lazy" decoding="async" data-testid="outputs-image-thumb" @load="imgReady = true" @error="imgFailed = true" />
      <span v-if="tooBig || imgFailed" class="vfallback" data-testid="outputs-image-fallback"><i class="fa-solid fa-image fs-3 text-body-secondary"></i></span>
      <span v-else-if="!imgReady" class="shimmer" data-testid="outputs-media-idle"></span>
    </span>
    <span v-else class="thumb d-flex align-items-center justify-content-center text-body-secondary" data-testid="outputs-media-idle"><i class="fa-solid fs-3 fa-file"></i></span>
  </span>
</template>

<script setup>
/**
 * LazyMedia: the thumbnail of an image or a video file in the gallery, made only while its tile is near the viewport (Lucas, 2026-11-21: "main video should have a preview instead of a black box", "the icon should be a
 * fallback", "do same for images"). VIDEO: its first-frame POSTER (a small JPEG the pod made, `poster`), else its first frame captured here in the page (utils/videothumb.js: two at a time, nothing left playing, kept by
 * address and shared by every tile of the same file, 60 s limit), else a shimmer while it is on its way, else the film icon after a definite failure (a codec the page cannot decode, an error, or a time-out with one
 * retry glyph). The picture box takes the video's own aspect ratio (from the capture, or the poster JPEG's natural size; 16:9 until known) at the tile's fixed height. It never holds a <video>: clicking the video is the
 * parent's click and opens the modal viewer. IMAGE: the file itself loaded lazily and scaled by CSS (a shimmer until it loads, the image icon when it fails or when the file is over 25 MB). Nothing here ever decodes
 * a DPX, EXR or TIFF: those are not `image` kind.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { t } from '../i18n'
import CachedImg from './CachedImg.vue'
import { firstFrame, retryFirstFrame } from '../utils/videothumb'

/** An image bigger than this shows its icon with a tooltip instead of loading (a 40 MB PNG is not a thumbnail). */
const IMAGE_MAX_BYTES = 25 * 1024 * 1024

const props = defineProps({ kind: { type: String, required: true }, src: { type: String, required: true }, alt: { type: String, default: '' }, /** the first frame's JPEG for a video (utils/framejob.js posterUrl), when the pod has made it */ poster: { type: String, default: '' }, /** the file's size when the listing knows it (an image over IMAGE_MAX_BYTES is not loaded) */ bytes: { type: Number, default: null },
  /** a video's picture box: 'width' = the cell's width and the height follows the ratio (a grid tile); 'height' = the row's picture height (`--picH`, the sequence tile's) and the width follows the ratio (the Main Video tile) */ fit: { type: String, default: 'width' } })
const root = ref(null), near = ref(false), shot = ref(''), failed = ref(false), reason = ref(''), retried = ref(false), posterBad = ref(false), ratio = ref(16 / 9)
const imgReady = ref(false), imgFailed = ref(false)
/** A video's picture box is the video's OWN aspect ratio, exactly (Lucas, 2026-11-21: "main video should match aspect video for preview, you made it skinnier"). It used to be `width: auto` inside a block, which
 *  stretched to whatever the caption made the tile (142 px for a 16:9 video: a near-square box with the picture letterboxed), so the width is explicit now: height x ratio (the Main Video tile), or the cell's width with the height
 *  from the ratio (a grid tile, never taller than GRID_MAX_H: then it is narrower and centred, the ratio kept). 16:9 only until the poster's or the capture's natural size is known. */
const GRID_MAX_H = '12rem'
const boxStyle = computed(() => {
  const r = ratio.value.toFixed(5)
  return props.fit === 'height'
    ? { aspectRatio: r, height: 'var(--picH, 6.5rem)', width: `calc(var(--picH, 6.5rem) * ${r})`, maxWidth: 'none', flex: '0 0 auto' }
    : { aspectRatio: r, height: 'auto', width: `min(100%, calc(${GRID_MAX_H} * ${r}))`, marginInline: 'auto' }
})
const tooBig = computed(() => props.kind === 'image' && props.bytes != null && props.bytes > IMAGE_MAX_BYTES)
const vTitle = computed(() => (failed.value ? (reason.value === 'timeout' ? t('outputs.video.timedOut') : t('outputs.video.noPreview')) : t('outputs.video.play')))
const iTitle = computed(() => (tooBig.value ? t('outputs.image.tooLarge') : imgFailed.value ? t('outputs.image.noPreview') : ''))
let io = null, gone = false
const onImg = (e) => { const { naturalWidth: w, naturalHeight: h } = e.target; if (w > 0 && h > 0) ratio.value = w / h }
function onPosterError() { posterBad.value = true; capture() }   // a poster that cannot be read: fall back to the capture, never an icon first
async function capture(again = false) {
  if (props.kind !== 'video' || shot.value || !props.src) return
  if (!again && (failed.value || (props.poster && !posterBad.value))) return   // the pod's poster JPEG is the picture (and gives the ratio on load): no capture
  failed.value = false; reason.value = ''
  const r = await (again ? retryFirstFrame(props.src) : firstFrame(props.src))
  if (gone) return
  if (r.url) { shot.value = r.url; if (r.w > 0 && r.h > 0) ratio.value = r.w / r.h } else { failed.value = true; reason.value = r.reason || 'error' }
}
function retry() { if (retried.value) return; retried.value = true; capture(true) }   // one retry after a time-out, never on the tile's own click
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
/* a video: the box takes the video's own ratio (explicit width and height from `boxStyle`), the picture contained (no crop, no stretch) */
.vposter { position: relative; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; overflow: hidden; cursor: pointer; }
.vimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.vfallback { position: relative; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
/* the only mark on a tile with a real picture: a play glyph in the CENTRE, on hover or keyboard focus of the tile (the tile itself is the parent button) */
.vhover { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); font-size: 1.6rem; color: rgba(255, 255, 255, 0.9); text-shadow: 0 0 6px #000; opacity: 0; transition: opacity 0.12s; pointer-events: none; }
:global(button:hover) .vhover, :global(button:focus-visible) .vhover, .vposter:hover .vhover { opacity: 1; }
.vretry { position: absolute; right: 0.3rem; bottom: 0.25rem; display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; border-radius: 50%; background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 0.75rem; cursor: pointer; }
.vretry:focus-visible { outline: 2px solid #6ea8fe; }
.imgbox { position: relative; display: block; overflow: hidden; }
.iimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.15s; }
.iimg.ready { opacity: 1; }
/* the neutral loading state: a slow moving band, never an icon and never a black box that looks like a failure */
.shimmer { position: absolute; inset: 0; background: linear-gradient(100deg, #14161b 30%, #232832 50%, #14161b 70%); background-size: 200% 100%; animation: lm-shimmer 1.4s linear infinite; }
@keyframes lm-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
</style>
