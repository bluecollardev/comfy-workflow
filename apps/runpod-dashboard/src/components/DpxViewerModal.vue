<template>
  <Teleport to="body">
    <div v-if="frames.length" class="viewer-overlay" data-testid="dpx-viewer" @click.self="$emit('close')">
      <div class="viewer-card" role="dialog" aria-modal="true" :aria-label="file.filename">
        <div class="d-flex align-items-center gap-2 mb-2">
          <strong class="text-truncate" data-testid="dpx-viewer-title">{{ file.filename }}</strong>
          <span class="badge text-bg-secondary">DPX</span>
          <button type="button" class="btn-close btn-close-white ms-auto" :aria-label="$t('pod.close')" data-testid="dpx-viewer-close" @click="$emit('close')"></button>
        </div>
        <div class="viewer-stage text-center position-relative" data-testid="dpx-viewer-stage">
          <canvas v-show="shown" ref="canvas" class="viewer-media" data-testid="dpx-viewer-canvas" :data-drawn="drawn"></canvas>
          <div v-if="loading" class="loading text-body-secondary small" data-testid="dpx-viewer-loading">
            <BSpinner small class="me-2" />{{ progress.total ? $t('outputs.dpx.loadingPct', { pct: Math.round((100 * progress.got) / progress.total) }) : progress.got ? $t('outputs.dpx.loadingMb', { mb: (progress.got / 1048576).toFixed(0) }) : $t('outputs.dpx.loading') }}
          </div>
        </div>
        <div v-if="curProblem" class="alert alert-warning py-1 px-2 small mt-2 mb-0" role="alert" data-testid="dpx-viewer-banner" :data-kind="curProblem.kind"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ problemText(curProblem) }}</div>
        <div v-if="curStats && !curProblem" class="small text-body-secondary mt-1 font-monospace" data-testid="dpx-viewer-stats">{{ statsText }}</div>
        <TransportBar v-if="frames.length > 1" tid="dpx-viewer" :playing="playing" :pos="index" :max="frames.length - 1" :buffered="cachedRanges" :label="$t('outputs.dpx.frameOf', { n: index + 1, total: frames.length })"
          :status="buffering !== null ? $t('outputs.dpx.buffering', { n: buffering + 1 }) : ''" :fps="fps" :loop="loop" :at-start="index <= 0" :at-end="index >= frames.length - 1"
          @toggle="togglePlay" @scrub="(v) => goTo(v)" @step="(d) => goTo(index + d)" @update:fps="(v) => (fps = v)" @update:loop="(v) => (loop = v)" />
        <span v-else class="small text-body-secondary d-block mt-2" data-testid="dpx-viewer-frame">{{ $t('outputs.dpx.frameOf', { n: 1, total: 1 }) }}</span>
        <div v-if="frames.length > 1" class="d-flex align-items-center gap-2 mt-2 small flex-wrap" data-testid="dpx-viewer-cache-row">
          <BButton variant="outline-light" size="sm" data-testid="dpx-viewer-cache" :disabled="!running && fullyCached" @click="running ? stopCache() : startCache()">
            <BSpinner v-if="running" small class="me-1" /><i v-else class="fa-solid fa-memory me-1"></i>{{ running ? $t('outputs.dpx.cacheStop') : $t('outputs.dpx.cache') }}
          </BButton>
          <span class="text-body-secondary" data-testid="dpx-viewer-cache-status">{{ $t('outputs.dpx.cached', { n: cachedCount, total: frames.length }) }}<template v-if="problemList.length"> · <span class="text-warning" data-testid="dpx-viewer-problems">{{ $t(running ? 'outputs.dpx.problemsSoFar' : 'outputs.dpx.problemsOf', { n: problemList.length, total: frames.length }) }}</span></template></span>
          <template v-if="problemList.length">
            <BButton variant="outline-warning" size="sm" data-testid="dpx-viewer-prev-problem" :disabled="!problemBefore" :title="$t('outputs.dpx.prevProblem')" @click="goTo(problemBefore.i)"><i class="fa-solid fa-angles-left"></i></BButton>
            <BButton variant="outline-warning" size="sm" data-testid="dpx-viewer-next-problem" :disabled="!problemAfter" :title="$t('outputs.dpx.nextProblem')" @click="goTo(problemAfter.i)"><i class="fa-solid fa-angles-right"></i></BButton>
          </template>
          <span v-if="tooLong" class="text-warning" data-testid="dpx-viewer-cache-limit">{{ $t('outputs.dpx.tooLong', { n: cachedCount, total: frames.length, mb: CACHE_BYTES / 1048576 }) }}</span>
          <span v-else class="text-body-secondary">{{ $t('outputs.dpx.cacheHint') }}</span>
        </div>
        <div class="d-flex align-items-center gap-2 mt-2 small flex-wrap">
          <span class="badge" :class="file.type === 'output' ? 'text-bg-success' : 'text-bg-secondary'">{{ $t(`outputs.type.${file.type}`) }}</span>
          <span class="font-monospace text-body-secondary text-truncate" :title="path">{{ path }}</span>
          <span class="ms-auto d-flex gap-2">
            <BButton v-if="!/^s3file:/.test(webUrl)" variant="outline-light" size="sm" data-testid="dpx-viewer-open" :href="webUrl" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square me-1"></i>{{ $t('outputs.open') }}</BButton>
            <BButton variant="primary" size="sm" data-testid="dpx-viewer-download" @click="download"><i class="fa-solid fa-download me-1"></i>{{ $t('outputs.download') }}</BButton>
          </span>
        </div>
        <div class="text-body-secondary small mt-2" data-testid="dpx-viewer-note">{{ $t('outputs.dpx.note') }}</div>
        <div v-if="error" class="text-danger small mt-2" data-testid="dpx-viewer-error">{{ error }}</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
/**
 * DpxViewerModal: a quick look at a DPX sequence (or one DPX file) from a pod's ComfyUI /view. The bytes are fetched, decoded in the page by utils/dpx.js and drawn on a canvas, with the shared transport bar
 * (scrubber, frame step, Play/Pause on Space at 12/24/25/30 fps, Loop) and the arrow keys. A preview only: display-referred values, not colour-managed; DJV is for real review. Open and Download act on the current frame's file.
 * Frames are ~50 MB each over RunPod's proxy, so playback is not real time from the pod: "Cache sequence" downloads and decodes the frames in order (two requests at most, abortable) into memory (1920 wide RGBA, ~8 MB each, 600 MB at most),
 * and Play starts that by itself. The clock (utils/playback.js) never skips a frame: it holds on the shown one ("Buffering frame n") until the next arrives. Without Play, the next frame is fetched in the background.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { core } from '../api/bridge'
import { viewUrl } from '../utils/outputs'
import { createFrameLoader, frameCache, drawToCanvas, problemOfError } from '../utils/dpx'
import { createPlayback } from '../utils/playback'
import { appReader } from '../utils/thumbs'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import TransportBar from './TransportBar.vue'

const props = defineProps({ frames: { type: Array, default: () => [] }, base: { type: String, default: '' } })
const emit = defineEmits(['close', 'problems'])
const CACHE_BYTES = 600 * 1048576
const index = ref(0), canvas = ref(null)
const loading = ref(false), shown = ref(false), drawn = ref(-1), error = ref(''), progress = ref({ got: 0, total: 0 })
const playing = ref(false), fps = ref(24), loop = ref(true), buffering = ref(null)
const running = ref(false), cachedCount = ref(0), cachedVer = ref(0), tooLong = ref(false)
const file = computed(() => props.frames[index.value] || props.frames[0] || {})
const urlOf = (f) => viewUrl(props.base, f)
const webUrl = computed(() => (file.value.filename ? viewUrl(props.base, file.value, { web: true }) : ''))
const path = computed(() => [file.value.subfolder, file.value.filename].filter(Boolean).join('/'))
const fullyCached = computed(() => cachedCount.value >= props.frames.length)

// If the page's own fetch() of a podfile:// address fails (the scheme lacks its privilege), the frame is read once through the main process instead (core.files.read).
const readViaApp = appReader(core)
let loader = createFrameLoader({ concurrency: 2, maxWidth: 1920, fallback: readViaApp })   // never more than two requests to the pod at once
let lru = frameCache(6), seq = new Map(), seqBytes = 0, cacheCtl = null, fgUrl = '', waitLoad = -1
const bg = new Set()
const player = createPlayback({ count: 0, fps: 24, loop: true, isCached: (i) => !!getFrame(i) })
let token = 0, raf = 0
// Empty frames (all black, one flat value, 0 bytes, truncated, missing), found as frames are loaded or cached: index -> problem.
let problems = new Map()
const problemsVer = ref(0), curProblem = ref(null), curStats = ref(null)
const problemList = computed(() => { problemsVer.value; return [...problems.keys()].sort((a, b) => a - b).map((i) => ({ i, p: problems.get(i) })) })
const problemBefore = computed(() => [...problemList.value].reverse().find((x) => x.i < index.value))
const problemAfter = computed(() => problemList.value.find((x) => x.i > index.value))
const pct = (v) => `${(v * 100).toFixed(1)}%`
const statsText = computed(() => { const s = curStats.value; return s ? `min ${s.min.map(pct).join(' ')} · max ${s.max.map(pct).join(' ')} · mean ${s.mean.map(pct).join(' ')} · ${t('outputs.dpx.zeroPixels', { pct: pct(s.zeroFraction) })}` : '' })
const problemText = (p) => t(`outputs.dpx.problem.${p.kind}`, { have: p.have, need: p.need })
function noteProblem(i, fr) { if (fr.problem && !problems.has(i)) { problems.set(i, fr.problem); problemsVer.value++ } }
function notePixels(i, fr) { curProblem.value = fr.problem || null; curStats.value = fr.stats || null; noteProblem(i, fr) }
watch(() => problemList.value.length, (n) => emit('problems', n))

const getFrame = (i) => seq.get(i) || (props.frames[i] ? lru.get(urlOf(props.frames[i])) : undefined)
function seqStore(i, fr) {
  if (seq.has(i)) return
  const size = fr.data?.byteLength || 0
  if (seqBytes + size > CACHE_BYTES) { tooLong.value = true; return }
  seq.set(i, fr); seqBytes += size; cachedCount.value = seq.size; cachedVer.value++
}
/** The decoded frame i: cached, or fetched (priority 1 for a frame someone waits for, 0 for the background). Stored in the small LRU, and in the sequence cache while it is on. */
async function fetchIndex(i, priority, onProgress) {
  const hit = getFrame(i)
  if (hit) { if (cacheCtl) seqStore(i, hit); return hit }
  let fr
  try { fr = await loader.load(urlOf(props.frames[i]), { priority, onProgress }) } catch (e) {
    const pr = problemOfError(e); if (!pr) throw e
    fr = { width: 0, height: 0, data: null, stats: null, problem: pr }   // a file that is missing, 0 bytes or truncated is a result, not a failure: playback goes on over it
  }
  lru.set(urlOf(props.frames[i]), fr)
  noteProblem(i, fr)   // found as soon as it is loaded, shown or not
  if (cacheCtl) seqStore(i, fr)
  return fr
}
const cachedRanges = computed(() => {
  cachedVer.value
  const n = props.frames.length; if (n < 2) return []
  const out = []; let a = -1
  for (let i = 0; i <= n; i++) {
    if (i < n && seq.has(i)) { if (a < 0) a = i } else if (a >= 0) { out.push([Math.max(0, (a - 0.5) / (n - 1)), Math.min(1, (i - 1 + 0.5) / (n - 1))]); a = -1 }
  }
  return out
})

function drawNow(fr, i) {
  if (fr.data) drawToCanvas(canvas.value, fr)
  else { const c = canvas.value; c.width = Math.max(c.width, 16); c.height = Math.max(c.height, 9); c.getContext('2d').clearRect(0, 0, c.width, c.height) }   // nothing to draw: no stale picture under the banner
  notePixels(i, fr); shown.value = true; loading.value = false; drawn.value = i
}
async function show() {
  const my = ++token, i = index.value, f = props.frames[i]
  if (!f) return
  const url = urlOf(f)
  error.value = ''
  const hit = getFrame(i)
  if (fgUrl && fgUrl !== url && !bg.has(fgUrl)) loader.abort(fgUrl)   // the frame we left is no longer wanted (unless the cache is fetching it)
  fgUrl = url
  if (hit && canvas.value) { drawNow(hit, i); if (!playing.value && !cacheCtl) prefetch(i + 1); return }
  progress.value = { got: 0, total: 0 }
  loading.value = !hit
  try {
    const fr = hit || await fetchIndex(i, 1, (got, total) => { if (urlOf(file.value) === url) progress.value = { got, total } })
    if (my !== token) return
    await nextTick()
    if (my !== token || !canvas.value) return
    drawNow(fr, i)
    if (!playing.value && !cacheCtl) prefetch(i + 1)
  } catch (e) {
    if (my !== token) return
    loading.value = false
    if (e?.name !== 'AbortError') error.value = errorText(e)
  }
}
function prefetch(i) { if (props.frames[i] && !getFrame(i)) fetchIndex(i, 0).catch(() => {}) }

/** Cache the sequence: from the playhead on, wrapping, two workers; stops at the memory cap, on an error, or when told. */
async function startCache() {
  if (cacheCtl || !props.frames.length) return
  const ctl = (cacheCtl = { stop: false }); running.value = true; tooLong.value = false
  const n = props.frames.length, order = Array.from({ length: n }, (_, k) => (index.value + k) % n)
  props.frames.forEach((_, i) => { const h = getFrame(i); if (h) seqStore(i, h) })
  let cursor = 0
  const worker = async () => {
    while (!ctl.stop && !tooLong.value && cursor < order.length) {
      const i = order[cursor++]
      if (seq.has(i)) continue
      const url = urlOf(props.frames[i]); bg.add(url)
      try { await fetchIndex(i, 0) } catch (e) { if (e?.name !== 'AbortError' && !ctl.stop) { error.value = errorText(e); ctl.stop = true } } finally { bg.delete(url) }
    }
  }
  await Promise.all([worker(), worker()])
  if (cacheCtl === ctl) { running.value = false; cacheCtl = null }
}
function stopCache() {
  if (cacheCtl) cacheCtl.stop = true
  for (const u of bg) if (u !== fgUrl) loader.abort(u)
  bg.clear(); cacheCtl = null; running.value = false
}

/** Play: starts caching by itself when the sequence is not cached; the clock holds on a missing frame. */
function play() {
  if (props.frames.length < 2) return
  if (!fullyCached.value && !cacheCtl && !tooLong.value) startCache()
  if (!player.play(performance.now())) return
  index.value = player.index; playing.value = true; waitLoad = -1
  if (!raf) raf = requestAnimationFrame(loopFn)
}
function pause() { player.pause(); playing.value = false; buffering.value = null; if (raf) { cancelAnimationFrame(raf); raf = 0 } }
const togglePlay = () => (playing.value ? pause() : play())
function loopFn(now) {
  raf = 0
  if (!playing.value) return
  const s = player.tick(now)
  if (s.changed) index.value = s.index
  buffering.value = s.waitingFor
  if (s.waitingFor !== null && waitLoad !== s.waitingFor) {   // the frame the playhead waits for goes first in the queue
    const w = (waitLoad = s.waitingFor)
    fetchIndex(w, 1).catch((e) => { if (e?.name !== 'AbortError' && playing.value) { error.value = errorText(e); pause() } })
  }
  if (!s.playing) { playing.value = false; buffering.value = null; return }
  raf = requestAnimationFrame(loopFn)
}
/** Any manual move pauses. */
function goTo(i) { pause(); const k = Math.min(props.frames.length - 1, Math.max(0, Math.round(i))); player.seek(k); index.value = k }

watch(index, () => { if (props.frames.length) show() })
watch(fps, (v) => player.setFps(v)); watch(loop, (v) => player.setLoop(v))
watch(() => props.frames, (fr) => {
  pause(); stopCache(); loader.abortAll(); lru = frameCache(6); seq = new Map(); seqBytes = 0; problems = new Map(); problemsVer.value++; curProblem.value = null; curStats.value = null; cachedCount.value = 0; cachedVer.value++; tooLong.value = false; fgUrl = ''; waitLoad = -1
  player.setCount(fr.length); player.seek(0); token++; shown.value = false; drawn.value = -1; error.value = ''; loading.value = false
  if (index.value !== 0) index.value = 0; else if (fr.length) show()
}, { immediate: true })

/** Esc closes the viewer (not the window under it); Space plays and pauses; the arrow keys step (and pause). */
const onKey = (e) => {
  if (!props.frames.length) return
  if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); pause(); emit('close') }
  else if (e.key === ' ') { e.preventDefault(); if (e.repeat) return; if (props.frames.length > 1) togglePlay() }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index.value - (e.shiftKey ? 10 : 1)) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index.value + (e.shiftKey ? 10 : 1)) }
}
const onKeyUp = (e) => { if (props.frames.length && e.key === ' ') e.preventDefault() }   // a focused button would click on Space's key-up
const onHide = () => { if (document.hidden) pause() }
window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKeyUp, true); document.addEventListener('visibilitychange', onHide)
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); document.removeEventListener('visibilitychange', onHide); pause(); token++; stopCache(); loader.abortAll() })

/** In the app: a Save As dialog and the bytes from the pod; in a browser: the address with a download attribute. */
async function download() {
  error.value = ''
  if (core?.files?.download) { try { await core.files.download(webUrl.value, file.value.filename) } catch (e) { error.value = errorText(e) } return }
  const a = document.createElement('a'); a.href = webUrl.value; a.download = file.value.filename; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove()
}
</script>

<style scoped>
.viewer-overlay { position: fixed; inset: 0; z-index: 2500; background: rgba(0, 0, 0, 0.8); display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
.viewer-card { background: #20232a; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 0.5rem; padding: 1rem; max-width: min(96vw, 1400px); max-height: 94vh; overflow: auto; width: 100%; }
.viewer-stage { background: #14161b; border-radius: 0.375rem; padding: 0.5rem; min-height: 8rem; }
.viewer-media { max-width: 100%; max-height: 58vh; }
.loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(20, 22, 27, 0.55); }
</style>
