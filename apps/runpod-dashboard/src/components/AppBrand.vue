<template>
  <span class="app-brand d-inline-flex align-items-center fw-semibold" data-testid="app-brand">
    <i class="fa-solid fa-microchip text-primary me-2"></i><span class="app-brand-name">{{ $t('app.title') }}</span>
    <BBadge v-if="pods.dryRun" variant="warning" text-indicator class="ms-2 fw-normal" data-testid="no-spend-badge" :title="$t('app.noSpendTitle')">{{ $t('app.noSpend') }}</BBadge>
  </span>
</template>

<script setup>
/** AppBrand — the app's mark and name, and the no-spend badge: in the navbar, and first in the header of every full-screen modal (docs/ADR-010). */
import { usePodsStore } from '../stores/pods'
const pods = usePodsStore()
</script>

<style scoped>
@media (max-width: 575px) { .app-brand-name { display: none; } }
</style>
