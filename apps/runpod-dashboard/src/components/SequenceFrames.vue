<template>
  <span v-if="chk && !chk.ok" class="badge text-bg-danger chip" data-testid="outputs-dpx-frames" data-ok="false" :title="$t('outputs.dpx.colour.framesTitle', { frames: chk.frames, expected: chk.expected })">{{ $t('outputs.dpx.colour.framesBadge', { frames: chk.frames, expected: chk.expected }) }}</span>
</template>

<script setup>
/** SequenceFrames: a red badge on a DPX sequence tile whose frame count differs from the V11 EDL's cut for that element ("Frames 96 / 97"). Silent when the count is right, or when the sequence is not an EDL element (nothing to compare). */
import { computed, ref, watch } from 'vue'
import { edlAPI } from '../api/edl'
import { frameCheck } from '../utils/framecount'
const props = defineProps({ tile: { type: Object, required: true } })
const match = ref(null)
const cache = new Map()
const name = computed(() => String(props.tile.name || props.tile.file?.filename || '').replace(/\.(\d+|#+)\.dpx$/i, ''))
const chk = computed(() => frameCheck(match.value, props.tile.frames?.length || 0))
watch(name, async (n) => {
  if (!n) { match.value = null; return }
  if (!cache.has(n)) cache.set(n, edlAPI.lookup({ clip: n }).catch(() => null))
  match.value = await cache.get(n)
}, { immediate: true })
</script>

<style scoped>
.chip { font-weight: 400; font-size: 0.65rem; }
</style>
