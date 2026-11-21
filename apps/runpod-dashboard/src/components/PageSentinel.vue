<template>
  <span v-if="more && HAS_IO" ref="root" class="sentinel" data-testid="outputs-page-sentinel" aria-hidden="true"></span>
</template>

<script setup>
/**
 * PageSentinel: the end of a paged list. When it scrolls near the viewport it asks for the next page (`more`), so nobody clicks Show More again and again (Lucas, 2026-11-21). It is re-armed after each page,
 * so a page that still leaves the end in view loads the next one too. Without IntersectionObserver it renders nothing and the plain Show More button of the list is the way on.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { HAS_IO } from '../utils/dpxcollapse'

const props = defineProps({ more: { type: Boolean, default: false }, shown: { type: Number, default: 0 } })
const emit = defineEmits(['more'])
const root = ref(null)
let io = null
function arm() {
  if (!HAS_IO) return
  io?.disconnect()
  if (!root.value) return
  io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) emit('more') }, { rootMargin: '300px' })
  io.observe(root.value)
}
onMounted(arm)
watch(() => [props.more, props.shown], arm, { flush: 'post' })   // a new page moved the end: look again, after the DOM is updated
onBeforeUnmount(() => io?.disconnect())
</script>

<style scoped>
.sentinel { display: block; height: 1px; }
</style>
