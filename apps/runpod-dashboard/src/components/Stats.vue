<template>
  <BRow class="g-3">
    <BCol v-for="stat in cards" :key="stat.label" md="4">
      <BCard class="stat-card" :style="{ '--stat-color': `var(--bs-${stat.variant})` }" body-class="py-3">
        <div class="text-body-secondary text-uppercase small fw-semibold mb-1">{{ stat.label }}</div>
        <div class="fs-1 fw-bold lh-1">{{ stat.value }}</div>
      </BCard>
    </BCol>
  </BRow>
</template>

<script setup>
/**
 * Stats — three summary cards: total / running / stopped.
 *
 * Props:
 *   stats  { total_pods, running_pods, stopped_pods }  — any missing count renders as 0
 */
import { computed } from 'vue'

const props = defineProps({
  stats: { type: Object, required: true },
})

const cards = computed(() => [
  { label: 'Total pods', value: props.stats.total_pods ?? 0, variant: 'primary' },
  { label: 'Running', value: props.stats.running_pods ?? 0, variant: 'success' },
  { label: 'Stopped', value: props.stats.stopped_pods ?? 0, variant: 'danger' },
])
</script>

<style scoped>
.stat-card {
  border-left: 4px solid var(--stat-color);
}
</style>
