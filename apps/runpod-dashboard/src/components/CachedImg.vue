<template>
  <img v-if="shown" :src="shown" :alt="alt" />
</template>

<script setup>
/**
 * CachedImg: an <img> for a small preview picture (a frame JPEG, a poster, an image thumbnail) that comes from the persistent cache (utils/imgcache.js, docs/ADR-060) when it has it and otherwise
 * fetches it once and keeps it. The object URL is made on demand and revoked when the picture changes or the tile goes. A data:/blob: address is shown as it is; when the picture cannot be fetched the
 * <img> loads the address itself, as it always did. Every attribute (class, loading, data-testid) falls through to the <img>.
 */
import { getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'
import { core } from '../api/bridge'
import { loadImage } from '../utils/imgcache'
import { appReader, elementOrder } from '../utils/thumbs'

const props = defineProps({ src: { type: String, default: '' }, alt: { type: String, default: '' }, /** the file's size and time, when known: a changed one is a miss */ stamp: { type: String, default: '' } })
const shown = ref('')
const me = getCurrentInstance()
const where = () => { try { return elementOrder(me?.vnode?.el?.parentElement) } catch { return null } }   // the tile's page position: nearer the top loads first
let made = '', token = 0
const drop = () => { if (made) { try { URL.revokeObjectURL(made) } catch { /* gone */ } made = '' } }
watch(() => [props.src, props.stamp], async ([src, stamp]) => {
  const mine = ++token
  drop()
  if (!src || /^(data|blob):/.test(src)) { shown.value = src; return }
  shown.value = ''
  let blob = null
  try { blob = await loadImage(src, { stamp, fallback: appReader(core), order: where() }) } catch { blob = null }
  if (mine !== token) return
  if (blob) { made = URL.createObjectURL(blob); shown.value = made } else shown.value = src
}, { immediate: true })
onBeforeUnmount(() => { token++; drop() })
</script>
