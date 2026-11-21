<template>
  <span v-if="chk && !chk.ok && neutral && chk.diff < 0" class="badge text-bg-secondary chip" data-testid="outputs-dpx-incomplete" :data-frames="chk.frames" :data-expected="chk.expected" :title="$t('outputs.incomplete.chipTitle', { frames: chk.frames, expected: chk.expected })">{{ $t('outputs.dpx.colour.framesBadge', { frames: chk.frames, expected: chk.expected }) }}</span>
  <span v-else-if="chk && !chk.ok" class="badge text-bg-danger chip" data-testid="outputs-dpx-frames" data-ok="false" :title="chk.gaps ? $t('outputs.dpx.colour.framesGapsTitle', { first: chk.first, last: chk.last }) : $t('outputs.dpx.colour.framesTitle', { frames: chk.frames, expected: chk.expected })">{{ chk.gaps ? $t('outputs.dpx.colour.framesGaps', { first: chk.first, last: chk.last }) : $t('outputs.dpx.colour.framesBadge', { frames: chk.frames, expected: chk.expected }) }}</span>
  <span v-else-if="part" class="badge text-bg-secondary chip" data-testid="outputs-dpx-part" :data-range="part.range" :data-total="part.total" :title="$t('outputs.dpx.colour.framesPartTitle', { range: part.range, total: part.total })">{{ $t('outputs.dpx.colour.framesPart', { total: part.total }) }}</span>
</template>

<script setup>
/**
 * SequenceFrames: a red badge on a DPX sequence tile whose frame count differs from the V11 EDL's cut for that element ("Frames 96 / 97"). Silent when the count is right, or when the sequence is not an EDL element (nothing to compare).
 * The count is the UNION of the sequence's frame numbers over every run the window lists (a chunked render writes one sequence as a probe and several chunks, each its own run, ADR-056): a tile that holds only some of them
 * is never red for that; it shows a neutral "part of 70" chip instead. The red badge stays for a union that is long, or has gaps. A union that is SHORT is an incomplete sequence: the window hides those (utils/incomplete.js)
 * and, in its Incomplete group (`neutral`), shows them with a grey `Frames 30 / 160` chip and the reason, not red.
 */
import { computed, inject, watch } from 'vue'
import { frameCheck } from '../utils/framecount'
import { ensureMatch, matchOf } from '../utils/edlexpect'
import { frameNo, seqKey } from '../utils/chunkruns'
const props = defineProps({ tile: { type: Object, required: true }, neutral: { type: Boolean, default: false } })
const unions = inject('frameUnions', null)   // a computed Map from PodOutputsModal; absent where the gallery is used alone
const name = computed(() => String(props.tile.name || props.tile.file?.filename || '').replace(/\.(\d+|#+)\.dpx$/i, ''))
const match = computed(() => matchOf(name.value))
const entry = computed(() => (unions?.value && props.tile.file ? unions.value.get(seqKey(props.tile.file)) || null : null))
const own = computed(() => props.tile.frames?.length || 0)
const total = computed(() => Math.max(own.value, entry.value?.count || 0))
const chk = computed(() => {
  const c = frameCheck(match.value, total.value)
  if (!c) return null
  return c.ok && entry.value && !entry.value.contiguous ? { ...c, ok: false, gaps: true, first: entry.value.min, last: entry.value.max } : c
})
const part = computed(() => {
  if (!entry.value || !own.value || own.value >= entry.value.count) return null
  const nums = (props.tile.frames || []).map(frameNo).filter((n) => n !== null)
  return { total: entry.value.count, range: nums.length ? `${Math.min(...nums)}-${Math.max(...nums)}` : '' }
})
watch(name, (n) => { ensureMatch(n) }, { immediate: true })
</script>

<style scoped>
.chip { font-weight: 400; font-size: 0.65rem; }
</style>
