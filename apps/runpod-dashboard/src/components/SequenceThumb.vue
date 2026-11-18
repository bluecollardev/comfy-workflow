<template>
  <span ref="root" class="preview" :data-state="state">
    <img v-if="state === 'ready'" :src="url" alt="" class="pimg" data-testid="outputs-dpx-thumb" />
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

const props = defineProps({ tile: { type: Object, required: true }, base: { type: String, default: '' }, scope: { type: String, default: '' }, volumeName: { type: String, default: '' }, offline: { type: Boolean, default: false } })
const emit = defineEmits(['state'])
const root = ref(null)
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
  if (r.status === 'ready') { url.value = r.url; setState('ready'); previewBus.cacheVer++ }
  else if (r.status === 'empty') { reason.value = r.reason; setState('empty') }
  else if (r.status === 'capped') setState('capped')
  else if (r.status === 'error') { reason.value = r.code ? t(`outputs.dpx.reason.${r.code}`) : r.reason; setState('error') }
  else setState('idle')   // aborted: it asks again when it is on screen again
}
function seen(v) {
  visible = v
  if (v) { if (state.value === 'idle' || state.value === 'nobase') load(wanted || previewBus.loadAll) }
  else if (state.value === 'loading' && !wanted && !previewBus.loadAll) { sharedThumbs().abort(key.value); setState('idle') }   // only an automatic one is dropped when it scrolls away
}
onMounted(() => {
  previewBus.counts[state.value]++   // this tile counts toward "Generate all previews"
  if (typeof IntersectionObserver === 'undefined') { seen(true); return }
  io = new IntersectionObserver((es) => { for (const e of es) seen(e.isIntersecting) }, { rootMargin: '200px' })
  io.observe(root.value.parentElement || root.value)
})
onBeforeUnmount(() => { io?.disconnect(); if (state.value === 'loading') sharedThumbs().abort(key.value); if (state.value === 'capped') previewBus.capped--; if (previewBus.counts[state.value] > 0) previewBus.counts[state.value]-- })
watch(usable, (u) => { if (u && visible && ['idle', 'nobase'].includes(state.value)) load(false) })
watch(() => previewBus.tick, () => {
  if (state.value === 'capped') load(true)
  else if (previewBus.batch && usable.value && ['idle', 'error'].includes(state.value)) load(true)   // Generate all: tiles not scrolled to yet and failed ones too (a cached one is a hit with no download)
})
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
