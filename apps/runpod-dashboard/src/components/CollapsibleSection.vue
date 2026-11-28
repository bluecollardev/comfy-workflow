<template>
  <div class="border rounded mb-3 collapsible" :data-testid="testid" :data-open="open ? 'true' : 'false'">
    <button type="button" class="collapsible-head btn w-100 d-flex align-items-center gap-2 text-start px-3 py-2" :aria-expanded="open ? 'true' : 'false'" :aria-controls="bodyId" data-testid="collapsible-toggle" @click="toggle">
      <i class="fa-solid fa-chevron-right collapsible-chev" :class="{ 'is-open': open }" aria-hidden="true"></i>
      <i v-if="icon" :class="icon" class="text-body-secondary" aria-hidden="true" data-testid="collapsible-icon"></i>
      <span class="fw-semibold" data-testid="collapsible-title">{{ title }}</span>
      <slot name="badge"></slot>
    </button>
    <div v-show="open" :id="bodyId" class="px-3 pb-3 pt-1" data-testid="collapsible-body"><slot /></div>
  </div>
</template>

<script setup>
/**
 * CollapsibleSection: one heading you can fold, for the long Publishing section of the Default Configuration. Several can be open at once. Every section starts open and remembers
 * what you chose on this PC (localStorage; where storage is blocked it just lasts this window). The body stays in the DOM when folded, so what is typed in it is kept and saved.
 */
import { ref, watch } from 'vue'
const props = defineProps({ id: { type: String, required: true }, title: { type: String, required: true }, testid: { type: String, default: undefined }, /** a Font Awesome class string shown before the title, e.g. 'fa-solid fa-gear' */ icon: { type: String, default: undefined }, defaultOpen: { type: Boolean, default: true } })
const KEY = 'runpod-manager.sections'
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
const open = ref(read()[props.id] ?? props.defaultOpen)
const bodyId = `collapsible-${props.id}`
const toggle = () => { open.value = !open.value }
defineExpose({ show: () => { open.value = true } })
watch(open, (v) => { try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [props.id]: v })) } catch { /* storage blocked: it lasts this window */ } })
</script>

<style scoped>
.collapsible-head { border: 0; background: transparent; color: inherit; }
.collapsible-chev { font-size: 0.75rem; transition: transform 0.15s ease; }
.collapsible-chev.is-open { transform: rotate(90deg); }
</style>
