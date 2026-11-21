<template>
  <span ref="root" class="lm" data-testid="outputs-media">
    <video v-if="kind === 'video' && live" :src="src" preload="metadata" muted class="thumb" data-testid="outputs-video-player"></video>
    <img v-else-if="kind === 'image' && near" :src="src" :alt="alt" class="thumb" data-testid="outputs-image-thumb" />
    <span v-else class="thumb d-flex align-items-center justify-content-center text-body-secondary" data-testid="outputs-media-idle"><i class="fa-solid fs-3" :class="kind === 'video' ? 'fa-film' : 'fa-image'"></i></span>
  </span>
</template>

<script setup>
/**
 * LazyMedia: the thumbnail of an image or a video file in the gallery, made only while its tile is near the viewport. A video also needs one of a few player slots (utils/playerslots.js), so a run with
 * hundreds of files never creates hundreds of media players; scrolled away, the element is dropped and the slot is given back.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { acquire, release, slots } from '../utils/playerslots'

const props = defineProps({ kind: { type: String, required: true }, src: { type: String, required: true }, alt: { type: String, default: '' } })
const root = ref(null), near = ref(false), live = ref(false)
let io = null, held = false
function sync() {
  if (props.kind !== 'video') return
  if (near.value && !held) { held = acquire(); live.value = held } else if (!near.value && held) { held = false; release(); live.value = false }
}
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') { near.value = true; sync(); return }
  io = new IntersectionObserver((es) => { for (const e of es) near.value = e.isIntersecting; sync() }, { rootMargin: '150px' })
  io.observe(root.value)
})
watch(() => slots.used, () => { if (near.value && !held) sync() })   // a slot was given back: a tile that was waiting takes it
onBeforeUnmount(() => { io?.disconnect(); if (held) { held = false; release() } })
</script>

<style scoped>
.lm { display: block; }
.thumb { width: 100%; height: 6.5rem; object-fit: cover; border-radius: 0.25rem; background: #14161b; }
</style>
