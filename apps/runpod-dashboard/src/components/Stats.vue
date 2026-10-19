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
 * Stats — three summary cards: total / running / stopped, from the pods store; a missing count renders as 0.
 */
import { computed } from 'vue'
import { usePodsStore } from '../stores/pods'

const pods = usePodsStore()

const cards = computed(() => [
  { label: 'Total pods', value: pods.stats.total_pods ?? 0, variant: 'primary' },
  { label: 'Running', value: pods.stats.running_pods ?? 0, variant: 'success' },
  { label: 'Stopped', value: pods.stats.stopped_pods ?? 0, variant: 'danger' },
])
</script>

<style scoped>
.stat-card {
  border-left: 4px solid var(--stat-color);
}
</style>
