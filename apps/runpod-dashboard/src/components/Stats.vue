<template>
  <BRow class="g-3">
    <BCol v-for="stat in cards" :key="stat.label" md="4" :data-testid="stat.id">
      <BCard class="stat-card" :style="{ '--stat-color': `var(--bs-${stat.variant})` }" body-class="py-3">
        <div class="text-body-secondary text-uppercase small fw-semibold mb-1">{{ stat.label }}</div>
        <div class="fs-1 fw-bold lh-1" data-testid="stat-value">{{ stat.value }}</div>
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
import { t } from '../i18n'

const pods = usePodsStore()

const cards = computed(() => [
  { id: 'stat-total', label: t('stats.total'), value: pods.stats.total_pods ?? 0, variant: 'primary' },
  { id: 'stat-running', label: t('stats.running'), value: pods.stats.running_pods ?? 0, variant: 'success' },
  { id: 'stat-stopped', label: t('stats.stopped'), value: pods.stats.stopped_pods ?? 0, variant: 'danger' },
])
</script>

<style scoped>
.stat-card {
  border-left: 4px solid var(--stat-color);
}
</style>
