<template>
  <Teleport to="body">
    <div v-if="file" class="viewer-overlay" data-testid="output-viewer" @click.self="$emit('close')">
      <div ref="card" class="viewer-card" role="dialog" aria-modal="true" :aria-label="file.filename">
        <div class="d-flex align-items-center gap-2 mb-2">
          <strong class="text-truncate" data-testid="output-viewer-title">{{ file.filename }}</strong>
          <button type="button" class="btn-close btn-close-white ms-auto" :aria-label="$t('pod.close')" data-testid="output-viewer-close" @click="$emit('close')"></button>
        </div>
        <div class="viewer-stage text-center position-relative" data-testid="output-viewer-stage" :data-kind="file.kind">
          <img v-if="file.kind === 'image'" :src="url" :alt="file.filename" class="viewer-media" data-testid="output-viewer-image" />
          <video v-else-if="file.kind === 'video'" ref="video" :src="url" autoplay :loop="loop" playsinline class="viewer-media" data-testid="output-viewer-video" :data-time="time.toFixed(3)"
            @play="playing = true" @pause="playing = false" @loadedmetadata="onMeta" @durationchange="duration = video.duration || 0" @timeupdate="time = video.currentTime" @progress="onProgress" @error="loading = false; onVideoError()" @click="togglePlay" @loadstart="loading = true" @waiting="loading = true" @canplay="loading = false" @loadeddata="loading = false" @playing="loading = false"></video>
          <div v-if="loading && !codecFail" class="loading-video" role="status" data-testid="output-viewer-loading"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>{{ $t('outputs.player.loadingVideo') }}</div>
          <audio v-else-if="file.kind === 'audio'" :src="url" controls autoplay class="w-100" data-testid="output-viewer-audio"></audio>
          <div v-else class="text-body-secondary py-5" data-testid="output-viewer-other"><i class="fa-regular fa-file fs-1 d-block mb-2"></i>{{ $t('outputs.noPreview') }}</div>
          <div v-if="file.kind === 'video' && codecFail" class="codec" data-testid="output-viewer-codec">
            <div>
              <i class="fa-solid fa-triangle-exclamation fs-3 d-block mb-2 text-warning"></i>
              <div class="fw-semibold">{{ $t('outputs.player.codecTitle') }}</div>
              <div class="small text-body-secondary mt-1">{{ $t('outputs.player.codecNote') }}</div>
            </div>
          </div>
        </div>
        <TransportBar v-if="file.kind === 'video'" tid="output-viewer-tp" :playing="playing" :can-play="!codecFail" :pos="time" :max="duration" :step="0.01" :buffered="buffered" :label="`${timecode(time, fps)} / ${timecode(duration, fps)}`"
          :fps="fps" :loop="loop" :speed="speed" :volume="volume" :muted="muted" fullscreen @toggle="togglePlay" @scrub="(v) => seekTo(v)" @step="(d) => stepFrames(d)" @update:fps="(v) => (fps = v)" @update:loop="(v) => (loop = v)"
          @update:speed="(v) => (speed = v)" @update:volume="(v) => { volume = v; muted = false }" @update:muted="(v) => (muted = v)" @fullscreen="fullscreen" />
        <div class="d-flex align-items-center gap-2 mt-3 small flex-wrap">
          <span class="badge" :class="file.type === 'output' ? 'text-bg-success' : 'text-bg-secondary'">{{ $t(`outputs.type.${file.type}`) }}</span>
          <span class="font-monospace text-body-secondary text-truncate" :title="path">{{ path }}</span>
          <span class="ms-auto d-flex gap-2">
            <BButton v-if="hasPrev" variant="outline-light" size="sm" data-testid="output-viewer-prev" :title="$t('outputs.prev')" @click="$emit('step', -1)"><i class="fa-solid fa-chevron-left"></i></BButton>
            <span v-if="count > 1" class="align-self-center text-body-secondary">{{ index + 1 }} / {{ count }}</span>
            <BButton v-if="hasNext" variant="outline-light" size="sm" data-testid="output-viewer-next" :title="$t('outputs.next')" @click="$emit('step', 1)"><i class="fa-solid fa-chevron-right"></i></BButton>
            <BButton v-if="!/^s3file:/.test(webUrl)" variant="outline-light" size="sm" data-testid="output-viewer-open" :href="webUrl" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square me-1"></i>{{ $t('outputs.open') }}</BButton>
            <BButton variant="primary" size="sm" data-testid="output-viewer-download" @click="download"><i class="fa-solid fa-download me-1"></i>{{ $t('outputs.download') }}</BButton>
          </span>
        </div>
        <div v-if="error" class="text-danger small mt-2" data-testid="output-viewer-error">{{ error }}</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
/**
 * OutputViewerModal: one output file of a run, large (image, video or audio of the pod's ComfyUI /view), with Previous/Next among the gallery's files, Open in a new tab and Download.
 * A video has the shared transport bar (TransportBar, as the DPX viewer): Play/Pause on Space, a scrubber with the buffered range, a timecode mm:ss:ff at the fps selector (the file's own rate is not exposed), frame step (arrows while paused, Shift = 10 frames),
 * speed 0.25x-2x, Loop, volume and fullscreen. Seeking needs the pod proxy's Range support (electron/main.cjs forwards it). A codec the engine cannot play (ProRes, some HEVC) shows a message with Download and DJV instead of a black frame.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { core } from '../api/bridge'
import { viewUrl } from '../utils/outputs'
import { errorText } from '../stores/toast'
import { timecode, stepTime, bufferedFractions, isCodecError } from '../utils/timecode'
import TransportBar from './TransportBar.vue'

const props = defineProps({ file: { type: Object, default: null }, base: { type: String, default: '' }, index: { type: Number, default: 0 }, count: { type: Number, default: 1 } })
const emit = defineEmits(['close', 'step'])
const error = ref('')
const card = ref(null), video = ref(null)
const loading = ref(true)   // the video is on its way: say so until it can play
const playing = ref(false), time = ref(0), duration = ref(0), buffered = ref([]), speed = ref(1), loop = ref(true), muted = ref(false), volume = ref(1), fps = ref(24), codecFail = ref(false)
const isVideo = () => props.file?.kind === 'video' && video.value
const url = computed(() => (props.file ? viewUrl(props.base, props.file) : ''))   // what the viewer shows
const webUrl = computed(() => (props.file ? viewUrl(props.base, props.file, { web: true }) : ''))   // what Open and Download use
const path = computed(() => (props.file ? [props.file.subfolder, props.file.filename].filter(Boolean).join('/') : ''))
const hasPrev = computed(() => props.index > 0), hasNext = computed(() => props.index < props.count - 1)
watch(() => props.file, () => { error.value = ''; codecFail.value = false; loading.value = true; playing.value = false; time.value = 0; duration.value = 0; buffered.value = [] })
watch(speed, (v) => { if (video.value) video.value.playbackRate = v })
watch(muted, (v) => { if (video.value) video.value.muted = v })
watch(volume, (v) => { if (video.value) video.value.volume = v })
function onMeta() {
  const v = video.value; if (!v) return
  duration.value = v.duration || 0; v.playbackRate = speed.value; v.muted = muted.value; v.volume = volume.value
  if (!v.videoWidth) codecFail.value = true   // the audio decodes but there is no picture: a codec the engine lacks
}
const onProgress = () => { buffered.value = bufferedFractions(video.value?.buffered, duration.value) }
function onVideoError() { if (isCodecError(video.value?.error)) codecFail.value = true }
function togglePlay() { const v = video.value; if (!v || codecFail.value) return; if (v.paused) v.play().catch(() => {}); else v.pause() }
const seekTo = (t) => { if (video.value) { video.value.currentTime = t; time.value = t } }
function stepFrames(n) { const v = video.value; if (!v) return; v.pause(); seekTo(stepTime(v.currentTime, n, fps.value, v.duration)) }
const fullscreen = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else card.value?.requestFullscreen?.() }
// While a video plays the clock follows the picture each frame (timeupdate fires only ~4 times a second).
let raf = 0
const follow = () => { raf = 0; if (video.value && playing.value) { time.value = video.value.currentTime; raf = requestAnimationFrame(follow) } }
watch(playing, (p) => { if (p && !raf) raf = requestAnimationFrame(follow) })
/** Esc closes the viewer (not the window under it); the arrow keys step through the files. */
const onKey = (e) => {
  if (!props.file) return
  if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); emit('close') }
  else if (e.key === ' ' && isVideo()) { e.preventDefault(); if (!e.repeat) togglePlay() }
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isVideo() && !playing.value && !codecFail.value) { e.preventDefault(); stepFrames((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)) }   // paused: one frame (Shift: ten); playing: the files, as for an image
  else if (e.key === 'ArrowLeft' && hasPrev.value) emit('step', -1)
  else if (e.key === 'ArrowRight' && hasNext.value) emit('step', 1)
}
window.addEventListener('keydown', onKey, true)
const onKeyUp = (e) => { if (props.file && e.key === ' ' && isVideo()) e.preventDefault() }   // a focused button would click on Space's key-up
window.addEventListener('keyup', onKeyUp, true)
const onHide = () => { if (document.hidden) video.value?.pause() }
document.addEventListener('visibilitychange', onHide)
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); document.removeEventListener('visibilitychange', onHide); if (raf) cancelAnimationFrame(raf) })
/** In the app: a Save As dialog and the bytes from the pod; in a browser: the address with a download attribute. */
async function download() {
  error.value = ''
  if (core?.files?.download) { try { await core.files.download(webUrl.value, props.file.filename) } catch (e) { error.value = errorText(e) } return }
  const a = document.createElement('a'); a.href = webUrl.value; a.download = props.file.filename; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove()
}
</script>

<style scoped>
.viewer-overlay { position: fixed; inset: 0; z-index: 2500; background: rgba(0, 0, 0, 0.8); display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
.viewer-card { background: #20232a; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 0.5rem; padding: 1rem; max-width: min(96vw, 1400px); max-height: 94vh; overflow: auto; width: 100%; }
.viewer-stage { background: #14161b; border-radius: 0.375rem; padding: 0.5rem; }
.viewer-media { max-width: 100%; max-height: 62vh; }
.loading-video { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(20, 22, 27, 0.72); color: #dee2e6; pointer-events: none; }
.codec { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 1rem; background: #14161b; }
</style>
