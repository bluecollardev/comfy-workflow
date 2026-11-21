<template>
  <span ref="root" class="lm" data-testid="outputs-media">
    <video v-if="kind === 'video' && playing" :src="src" controls autoplay muted playsinline preload="none" class="thumb" data-testid="outputs-video-player"></video>
    <button v-else-if="kind === 'video'" type="button" class="thumb vposter" :title="$t('outputs.video.play')" :aria-label="$t('outputs.video.play')" data-testid="outputs-video-poster" :data-poster="poster ? 'yes' : 'no'" @click.stop="playing = true">
      <img v-if="poster && near" :src="poster" alt="" class="vimg" loading="lazy" decoding="async" data-testid="outputs-video-poster-img" />
      <i v-else class="fa-solid fa-film fs-3 text-body-secondary"></i>
      <i class="fa-solid fa-circle-play vplay"></i>
    </button>
    <img v-else-if="kind === 'image' && near" :src="src" :alt="alt" class="thumb" data-testid="outputs-image-thumb" />
    <span v-else class="thumb d-flex align-items-center justify-content-center text-body-secondary" data-testid="outputs-media-idle"><i class="fa-solid fs-3 fa-image"></i></span>
  </span>
</template>

<script setup>
/**
 * LazyMedia: the thumbnail of an image or a video file in the gallery, made only while its tile is near the viewport. A video shows its first-frame POSTER (a small JPEG the pod made, `poster`) or a film icon,
 * and NO <video> exists until the person clicks play (preload none): a run with hundreds of videos used to open a player per tile and read each file's header (Lucas, 2026-11-21: the Outputs window loads slowly).
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({ kind: { type: String, required: true }, src: { type: String, required: true }, alt: { type: String, default: '' }, /** the first frame's JPEG for a video (utils/framejob.js posterUrl), when the pod has made it */ poster: { type: String, default: '' } })
const root = ref(null), near = ref(false), playing = ref(false)
let io = null
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') { near.value = true; return }
  io = new IntersectionObserver((es) => { for (const e of es) near.value = e.isIntersecting }, { rootMargin: '150px' })
  io.observe(root.value)
})
onBeforeUnmount(() => io?.disconnect())
</script>

<style scoped>
.lm { display: block; }
.thumb { width: 100%; height: 6.5rem; object-fit: cover; border-radius: 0.25rem; background: #14161b; }
.vposter { position: relative; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; overflow: hidden; cursor: pointer; }
.vimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.vplay { position: absolute; right: 0.35rem; bottom: 0.3rem; font-size: 1.1rem; color: rgba(255, 255, 255, 0.85); text-shadow: 0 0 4px #000; pointer-events: none; }
</style>
