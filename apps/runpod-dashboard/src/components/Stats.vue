<template>
  <BRow class="g-3">
    <BCol v-for="stat in cards" :key="stat.label" :md="12 / cards.length" :data-testid="stat.id">
      <BCard class="stat-card" :style="{ '--stat-color': `var(--bs-${stat.variant})` }" body-class="py-3">
        <div class="text-body-secondary text-uppercase small fw-semibold mb-1">{{ stat.label }}</div>
        <div class="fs-1 fw-bold lh-1" data-testid="stat-value">{{ stat.value }}</div>
      </BCard>
    </BCol>
  </BRow>
</template>

<script setup>
/**
 * Stats — summary cards: total / running / stopped from the pods store (a missing count renders as 0), plus the
 * configured network volume's monthly storage cost when RunPod knows the volume.
 */
import { computed, ref, watch } from 'vue'
import { usePodsStore } from '../stores/pods'
import { useMountsStore } from '../stores/mounts'
import { podsAPI } from '../api/pods'
import { t } from '../i18n'

const pods = usePodsStore()

const mounts = useMountsStore()
/** The configured network volume's monthly cost: asked once per volume id; the card is left out while unknown. */
const volume = ref(null)
watch(() => mounts.config?.network_volume_id, async (id) => {
  volume.value = null
  if (!id) return
  try { volume.value = await podsAPI.volume(id) } catch { volume.value = null }
}, { immediate: true })

const cards = computed(() => [
  { id: 'stat-total', label: t('stats.total'), value: pods.stats.total_pods ?? 0, variant: 'primary' },
  { id: 'stat-running', label: t('stats.running'), value: pods.stats.running_pods ?? 0, variant: 'success' },
  { id: 'stat-stopped', label: t('stats.stopped'), value: pods.stats.stopped_pods ?? 0, variant: 'danger' },
  ...(volume.value ? [{ id: 'stat-storage', label: t('stats.storage', { size: volume.value.size_gb }), value: '$' + volume.value.cost_per_month.toFixed(2), variant: 'info' }] : []),
])
</script>

<style scoped>
.stat-card {
  border-left: 4px solid var(--stat-color);
}
</style>
