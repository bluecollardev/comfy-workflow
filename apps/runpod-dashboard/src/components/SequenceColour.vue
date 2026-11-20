<template>
  <span ref="root" class="chips" data-testid="outputs-dpx-colour" :data-state="state">
    <span v-if="chips.record" class="badge text-bg-secondary chip" data-testid="outputs-dpx-colour-record" :title="$t('outputs.dpx.colour.chipRecordTitle')">{{ chips.record.label }}</span>
    <span v-if="chips.header" class="badge chip" :class="chips.header.disagrees ? 'text-bg-warning' : 'text-bg-secondary'" data-testid="outputs-dpx-colour-header" :data-disagrees="chips.header.disagrees ? 'true' : 'false'" :title="$t(chips.header.disagrees ? 'outputs.dpx.colour.chipHeaderTitle' : 'outputs.dpx.colour.chipHeaderOnlyTitle')">{{ $t(chips.header.disagrees ? 'outputs.dpx.colour.headerSays' : 'outputs.dpx.colour.headerIs', { name: chips.header.name }) }}</span>
  </span>
</template>

<script setup>
/**
 * SequenceColour: the colour chips of a DPX sequence tile in the Outputs window: the OCIO record's colour space (muted), and the DPX header's transfer (known once the sequence's preview has decoded its first frame; a frame is never downloaded just for the chip) in amber ("Header says linear") when the header contradicts the
 * record, or in grey ("Header: linear") when there is no record. Lazy (it reads only once the tile is on screen), cached per sequence (utils/ocio.js), through the same file mechanism as the viewer; a failed read shows nothing.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { core } from '../api/bridge'
import { appReader } from '../utils/thumbs'
import { chipsOf, loadRecord, onColourCleared, recordUrl } from '../utils/ocio'

const props = defineProps({ tile: { type: Object, required: true }, base: { type: String, default: '' }, offline: { type: Boolean, default: false }, /** the first frame's { transfer, colorimetric }, known once its preview has decoded it: a frame is never downloaded just for this */ header: { type: Object, default: null } })
const root = ref(null)
const rec = ref(null), state = ref('idle')
const chips = computed(() => chipsOf(rec.value, props.header))
const first = computed(() => props.tile.frames?.[0] || props.tile.file)
let io = null, asked = '', stop = null, seen = false
async function ask() {
  if (props.offline || !props.base || !first.value) return
  const key = `${props.base}|${first.value.subfolder}|${first.value.filename}`
  if (asked === key) return
  asked = key; state.value = 'loading'
  const r = await loadRecord(recordUrl(props.base, first.value), { fallback: appReader(core) })
  if (asked !== key) return
  rec.value = r; state.value = 'done'
}
onMounted(() => {
  stop = onColourCleared(() => { if (seen) { asked = ''; ask() } })   // a refresh: a tile that has been shown reads again
  if (typeof IntersectionObserver === 'undefined') { seen = true; ask(); return }
  io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { seen = true; ask(); io?.disconnect(); io = null } }, { rootMargin: '200px' })
  io.observe(root.value.parentElement || root.value)
})
onBeforeUnmount(() => { io?.disconnect(); stop?.() })
watch(() => [props.base, props.offline], () => { asked = ''; rec.value = null; state.value = 'idle'; if (seen) ask() })
</script>

<style scoped>
.chips { display: flex; flex-wrap: wrap; gap: 0.2rem; }
.chips:empty { display: none; }
.chip { font-weight: 400; font-size: 0.65rem; }
</style>
