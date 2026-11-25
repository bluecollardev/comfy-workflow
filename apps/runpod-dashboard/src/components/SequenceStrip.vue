<template>
  <div ref="root" class="strip" :class="{ grid: rows > 1 }" :style="rows > 1 ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined" role="group" :aria-label="$t('outputs.strip.label')" data-testid="outputs-seq-strip" :data-count="shown.length" :data-fit="fit" :data-cols="cols" :data-rows="rows" :data-more="more">
    <button v-for="s in shown" :key="s.index" type="button" class="sf" :disabled="disabled" :title="`${$t('outputs.strip.frame', { n: s.no })} · ${s.name}`" data-testid="outputs-seq-strip-frame" :data-index="s.index" @click="$emit('open', s.index)">
      <CachedImg :src="s.src" alt="" class="sfimg" loading="lazy" decoding="async" @load="onImg" />
      <span class="sfno">{{ s.no }}</span>
    </button>
    <button v-if="more > 0" type="button" class="sf sfmore" :disabled="disabled" :title="$t('outputs.strip.moreTitle')" data-testid="outputs-seq-strip-more" @click="$emit('more')">{{ $t('outputs.strip.more', { n: more }) }}</button>
  </div>
</template>

<script setup>
/**
 * SequenceStrip: the frames of a DPX sequence that have a preview (the pod's small JPEGs or the cache), evenly spaced across the sequence, as many as fit the row (utils/filmstrip.js), with
 * the frame number under each; a click opens the DPX viewer on that frame. With `rows` > 1 (Lucas, 2026-11-21: "you can also show two rows of dpx previews") it is a grid of that many full rows below
 * the main row; when the sequence has more previewed frames than the slots, the last slot is a '+N More' tile (`more` expands the sequence). Each thumbnail keeps its own aspect ratio (16:9 until the
 * image has loaded). It makes no request of its own: the images are tiny and mount lazily, and only the slots' worth of them exist at a time. No previews, no strip: nothing extra is drawn.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import CachedImg from './CachedImg.vue'
import { fitCount, pickSamples } from '../utils/filmstrip'

const props = defineProps({
  items: { type: Array, default: () => [] },   // [{ index, no, name, src }] sorted by index, the first frame left out
  disabled: { type: Boolean, default: false },
  rows: { type: Number, default: 1 },
  /** the sequence's frames in all (the '+N More' count is what the strip does not show) */ total: { type: Number, default: 0 },
})
defineEmits(['open', 'more'])
const root = ref(null), width = ref(0)
const cols = computed(() => fitCount(width.value, { max: props.rows > 1 ? 24 : 12 }))
const fit = computed(() => (props.rows > 1 ? cols.value * props.rows : cols.value))
const overflow = computed(() => props.rows > 1 && props.items.length > fit.value)
const shown = computed(() => pickSamples(props.items, overflow.value ? fit.value - 1 : fit.value))
const more = computed(() => (overflow.value ? Math.max(1, (props.total || props.items.length + 1) - 1 - shown.value.length) : 0))
function onImg(e) { const { naturalWidth: w, naturalHeight: h } = e.target; if (w > 0 && h > 0) e.target.style.aspectRatio = `${w} / ${h}` }
let ro = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  width.value = root.value.clientWidth
  ro = new ResizeObserver((es) => { for (const e of es) width.value = e.contentRect.width })
  ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<style scoped>
.strip { display: flex; gap: 6px; align-items: flex-start; min-width: 0; overflow: hidden; }
.strip.grid { display: grid; overflow: visible; }
.sf { flex: 0 0 auto; width: 112px; display: flex; flex-direction: column; gap: 0.15rem; padding: 0.2rem; font-size: 0.7rem; background: #20232a; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 0.25rem; color: inherit; cursor: pointer; }
.strip.grid .sf { width: 100%; min-width: 0; }
.sf:hover:not(:disabled) { border-color: #508cff; }
.sf:disabled { cursor: default; opacity: 0.8; }
.sfimg { width: 100%; aspect-ratio: 16 / 9; object-fit: contain; border-radius: 0.15rem; background: #14161b; }
.sfno { text-align: center; color: var(--bs-secondary-color); }
.sfmore { align-items: center; justify-content: center; font-weight: 600; color: var(--bs-secondary-color); min-height: 4.5rem; }
</style>
