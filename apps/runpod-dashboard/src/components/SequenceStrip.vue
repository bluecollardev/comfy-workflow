<template>
  <div ref="root" class="strip" role="group" :aria-label="$t('outputs.strip.label')" data-testid="outputs-seq-strip" :data-count="shown.length" :data-fit="fit">
    <button v-for="s in shown" :key="s.index" type="button" class="sf" :disabled="disabled" :title="`${$t('outputs.strip.frame', { n: s.no })} · ${s.name}`" data-testid="outputs-seq-strip-frame" :data-index="s.index" @click="$emit('open', s.index)">
      <img :src="s.src" alt="" class="sfimg" loading="lazy" decoding="async" />
      <span class="sfno">{{ s.no }}</span>
    </button>
  </div>
</template>

<script setup>
/**
 * SequenceStrip: the frames of a DPX sequence that have a preview (the pod's small JPEGs or the cache), evenly spaced across the sequence, as many as fit the row (utils/filmstrip.js), with
 * the frame number under each; a click opens the DPX viewer on that frame. It makes no request of its own: the images are tiny and mount lazily, and only `fit` of them exist at a time.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fitCount, pickSamples } from '../utils/filmstrip'

const props = defineProps({ items: { type: Array, default: () => [] }, disabled: { type: Boolean, default: false } })   // [{ index, no, name, src }] sorted by index, the first frame left out
defineEmits(['open'])
const root = ref(null), width = ref(0)
const fit = computed(() => fitCount(width.value))
const shown = computed(() => pickSamples(props.items, fit.value))
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
.sf { flex: 0 0 auto; width: 112px; display: flex; flex-direction: column; gap: 0.15rem; padding: 0.2rem; font-size: 0.7rem; background: #20232a; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 0.25rem; color: inherit; cursor: pointer; }
.sf:hover:not(:disabled) { border-color: #508cff; }
.sf:disabled { cursor: default; opacity: 0.8; }
.sfimg { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 0.15rem; background: #14161b; }
.sfno { text-align: center; color: var(--bs-secondary-color); }
</style>
