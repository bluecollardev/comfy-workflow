<template>
  <span ref="root" class="preview" :data-state="state">
    <img v-if="state === 'ready'" :src="url" alt="" class="pimg" data-testid="outputs-dpx-thumb" />
    <img v-else-if="quick && state !== 'empty'" :src="quick" alt="" class="pimg" loading="lazy" decoding="async" data-testid="outputs-dpx-quick" />
    <span v-else-if="state === 'empty'" class="badge text-bg-warning pbadge" data-testid="outputs-dpx-thumb-empty" :title="reason">{{ $t('outputs.dpx.emptyFrame') }}</span>
    <BSpinner v-else-if="state === 'loading'" small class="pspin" data-testid="outputs-dpx-thumb-loading" />
    <span v-else-if="state === 'capped'" role="button" tabindex="0" class="badge text-bg-secondary pbtn" data-testid="outputs-dpx-load-preview" :title="$t('outputs.dpx.loadPreviewTitle')" @click.stop="load(true)" @keydown.enter.stop.prevent="load(true)"><i class="fa-regular fa-image me-1"></i>{{ $t('outputs.dpx.loadPreview') }}</span>
    <span v-else-if="state === 'nobase'" class="badge text-bg-secondary pbtn" data-testid="outputs-dpx-thumb-nobase" :title="$t('outputs.dpx.noBase', { volume: volumeName || scope })"><i class="fa-regular fa-eye-slash"></i></span>
    <span v-else-if="state === 'error'" role="button" tabindex="0" class="badge text-bg-danger pbtn" data-testid="outputs-dpx-thumb-retry" :title="`${$t('outputs.dpx.previewFailed')} ${reason}`" @click.stop="load(true)" @keydown.enter.stop.prevent="load(true)"><i class="fa-solid fa-rotate-right"></i></span>
  </span>
</template>

<script setup>
/**
 * SequenceThumb: the preview of a DPX sequence tile, the FIRST frame at about 320 px (src/utils/thumbs.js). Lazy: it asks only once the tile is on screen, one sequence at a time,
 * the first few per modal automatically and the others on a click; a finished preview comes from IndexedDB with no network. With no base to fetch from it shows nothing (the tile keeps its icon).
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { core } from '../api/bridge'
import { t } from '../i18n'
import { viewUrl } from '../utils/outputs'
import { appReader, sharedThumbs, thumbKey } from '../utils/thumbs'
import { previewBus } from '../utils/thumbsBus'
import { usePreviewsStore } from '../stores/previews'

const props = defineProps({ tile: { type: Object, required: true }, /** the first frame's 320 px JPEG made on the pod (Frame Previews): shown at once, replaced by the decoded preview when that is loaded */ quick: { type: String, default: '' }, base: { type: String, default: '' }, scope: { type: String, default: '' }, volumeName: { type: String, default: '' }, offline: { type: Boolean, default: false }, /** load as soon as it is on screen: no cap, no click (the Generate rows) */ auto: { type: Boolean, default: false } })
const emit = defineEmits(['state', 'header'])
const root = ref(null)
const previews = usePreviewsStore()
const state = ref('idle'), url = ref(''), reason = ref('')
const first = computed(() => props.tile.frames?.[0] || props.tile.file)
const key = computed(() => thumbKey(props.scope || props.base, first.value))
const usable = computed(() => !!props.base && !props.offline)
let visible = false, io = null, myKey = '', wanted = false   // wanted: the person asked for this preview (Load preview, Load all previews); scrolling away never cancels it
const setState = (s) => {
  if (state.value === 'capped' && s !== 'capped') previewBus.capped--
  if (s === 'capped' && state.value !== 'capped') previewBus.capped++
  if (previewBus.counts[state.value] > 0) previewBus.counts[state.value]--
  previewBus.counts[s]++
  state.value = s; emit('state', s)
}
async function load(manual = false) {
  if (!usable.value) { setState('nobase'); return }
  if (manual) wanted = true
  const thumbs = sharedThumbs(), k = myKey = key.value
  setState('loading')
  const r = await thumbs.request(k, { url: viewUrl(props.base, first.value), fallback: appReader(core), bytes: first.value.bytes ?? null, modified: first.value.modified ?? null }, { manual })
  if (k !== myKey) return
  if (r.status === 'ready') { url.value = r.url; setState('ready'); previewBus.cacheVer++; if (r.header) emit('header', r.header) }   // the first frame's colour fields, for the tile's chips
  else if (r.status === 'empty') { reason.value = r.reason; setState('empty') }
  else if (r.status === 'capped') setState('capped')
  else if (r.status === 'error') { reason.value = r.code ? t(`outputs.dpx.reason.${r.code}`) : r.reason; setState('error') }
  else setState('idle')   // aborted: it asks again when it is on screen again
}
function seen(v) {
  visible = v
  if (v) { if (state.value === 'idle' || state.value === 'nobase') load(wanted || previewBus.loadAll || props.auto) }
  else if (state.value === 'loading' && !wanted && !previewBus.loadAll) { sharedThumbs().abort(key.value); setState('idle') }   // only an automatic one is dropped when it scrolls away
}
onMounted(() => {
  previewBus.counts[state.value]++   // this tile counts toward "Generate all previews"
  fromBatch()
  if (typeof IntersectionObserver === 'undefined') { seen(true); return }
  io = new IntersectionObserver((es) => { for (const e of es) seen(e.isIntersecting) }, { rootMargin: '200px' })
  io.observe(root.value.parentElement || root.value)
})
onBeforeUnmount(() => { io?.disconnect(); if (state.value === 'loading') sharedThumbs().abort(key.value); if (state.value === 'capped') previewBus.capped--; if (previewBus.counts[state.value] > 0) previewBus.counts[state.value]-- })
watch(usable, (u) => { if (u && visible && ['idle', 'nobase'].includes(state.value)) load(props.auto) })
watch(() => previewBus.tick, () => { if (state.value === 'capped') load(true) })
// The preview batch is the app's (stores/previews.js), not the window's: what it found for this sequence is picked up here, now or when the tile appears later (a finished preview is in the cache: no download).
function fromBatch() {
  const r = previews.results[key.value]
  if (!r || !usable.value || !['idle', 'capped', 'error', 'nobase'].includes(state.value)) return
  if (r.status === 'error') { reason.value = r.code ? t(`outputs.dpx.reason.${r.code}`) : r.reason; setState('error') } else if (['ready', 'empty'].includes(r.status)) load(true)
}
watch(() => previews.version, fromBatch)
watch(() => previewBus.resetTick, () => { if (['ready', 'empty'].includes(state.value)) { url.value = ''; setState('idle') } })   // the preview cache was cleared: this tile has no preview any more
watch(() => previewBus.stopTick, () => { wanted = false })   // Stop: nothing asked for any more
</script>

<style scoped>
.preview { position: absolute; inset: 0; display: flex; align-items: flex-start; justify-content: flex-end; padding: 0.2rem; pointer-events: none; }
.preview > * { pointer-events: auto; }
.pimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 0.25rem; pointer-events: none; }
.pbadge { align-self: center; margin: auto; }
.pspin { z-index: 1; }
.pbtn { cursor: pointer; z-index: 1; }
</style>
