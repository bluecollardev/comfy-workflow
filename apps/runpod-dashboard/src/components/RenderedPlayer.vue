<template>
  <div data-testid="dpx-viewer-rendered">
    <div class="viewer-stage text-center position-relative" data-testid="dpx-viewer-rendered-stage">
      <video ref="video" :src="src" playsinline preload="auto" class="viewer-media" data-testid="dpx-viewer-video" :data-time="time.toFixed(3)" :data-fps="fps" :loop="loop"
        @play="playing = true" @pause="playing = false" @loadedmetadata="onMeta" @durationchange="duration = video.duration || 0" @timeupdate="time = video.currentTime" @progress="onProgress" @error="failed = true" @click="togglePlay"></video>
      <div v-if="failed" class="failed" data-testid="dpx-viewer-rendered-error"><div><i class="fa-solid fa-triangle-exclamation fs-3 d-block mb-2 text-warning"></i>{{ $t('outputs.render.videoError') }}</div></div>
    </div>
    <TransportBar tid="dpx-viewer-rendered" :playing="playing" :can-play="!failed" :pos="time" :max="duration" :step="0.01" :buffered="buffered" :label="`${timecode(time, fps)} / ${timecode(duration, fps)}`"
      :fps="fps" :loop="loop" :speed="speed" @toggle="togglePlay" @scrub="(v) => seekTo(v)" @step="(d) => stepFrames(d)" @update:fps="(v) => $emit('update:fps', v)" @update:loop="(v) => (loop = v)" @update:speed="(v) => (speed = v)" />
  </div>
</template>

<script setup>
/**
 * RenderedPlayer: the rendered movie (H.264 proxy, docs/ADR-048) of a DPX sequence in the DPX viewer: an HTML video with the shared transport bar (Play/Pause on Space, frame step with the arrows, Shift = 10, speed, Loop, timecode at the sequence's rate: 23.976 counts frames at the true rate).
 * The fps is the viewer's (from the file name); it only drives the timecode and the step, the movie plays at its own rate.
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { timecode, stepTime, bufferedFractions } from '../utils/timecode'
import TransportBar from './TransportBar.vue'

const props = defineProps({ src: { type: String, required: true }, fps: { type: Number, default: 24 } })
defineEmits(['update:fps'])
const video = ref(null)
const playing = ref(false), time = ref(0), duration = ref(0), buffered = ref([]), speed = ref(1), loop = ref(true), failed = ref(false)
watch(() => props.src, () => { failed.value = false; playing.value = false; time.value = 0; duration.value = 0; buffered.value = [] })
watch(speed, (v) => { if (video.value) video.value.playbackRate = v })
function onMeta() { const v = video.value; if (!v) return; duration.value = v.duration || 0; v.playbackRate = speed.value; if (!v.videoWidth) failed.value = true }
const onProgress = () => { buffered.value = bufferedFractions(video.value?.buffered, duration.value) }
function togglePlay() { const v = video.value; if (!v || failed.value) return; if (v.paused) v.play().catch(() => {}); else v.pause() }
const seekTo = (t) => { if (video.value) { video.value.currentTime = t; time.value = t } }
function stepFrames(n) { const v = video.value; if (!v) return; v.pause(); seekTo(stepTime(v.currentTime, n, props.fps, v.duration)) }
let raf = 0   // while it plays the clock follows the picture each frame (timeupdate fires only ~4 times a second)
const follow = () => { raf = 0; if (video.value && playing.value) { time.value = video.value.currentTime; raf = requestAnimationFrame(follow) } }
watch(playing, (p) => { if (p && !raf) raf = requestAnimationFrame(follow) })
/** Space plays and pauses, the arrows step (Shift: ten). Escape is the viewer's. */
const onKey = (e) => {
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat) togglePlay() }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); stepFrames((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)) }
}
const onKeyUp = (e) => { if (e.key === ' ') e.preventDefault() }
const onHide = () => { if (document.hidden) video.value?.pause() }
window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKeyUp, true); document.addEventListener('visibilitychange', onHide)
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); document.removeEventListener('visibilitychange', onHide); if (raf) cancelAnimationFrame(raf) })
</script>

<style scoped>
.viewer-stage { background: #14161b; border-radius: 0.375rem; padding: 0.5rem; min-height: 8rem; }
.viewer-media { max-width: 100%; max-height: 58vh; }
.failed { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 1rem; background: #14161b; }
</style>
