<template>
  <BRow class="g-3">
    <BCol v-for="stat in cards" :key="stat.label" class="d-flex" :md="cards.length > 4 ? true : 12 / cards.length" :data-testid="stat.id">
      <!-- Every card is as tall as the tallest of the row (flex), whether it has a line under its value or not. -->
      <BCard class="stat-card flex-fill" :style="{ '--stat-color': `var(--bs-${stat.variant})` }" body-class="py-2 d-flex flex-column justify-content-center h-100">
        <div class="stat-label text-body-secondary text-uppercase fw-semibold mb-1">{{ stat.label }}</div>
        <div class="stat-value fw-bold lh-1" data-testid="stat-value">{{ stat.value }}</div>
        <div v-if="stat.sub" class="stat-sub text-body-secondary mt-1" :title="stat.title" data-testid="stat-sub">{{ stat.sub }}</div>
      </BCard>
    </BCol>
  </BRow>
</template>

<script setup>
/**
 * Stats — summary cards: total / running / stopped from the pods store (a missing count renders as 0), plus the
 * configured network volume's monthly storage cost when RunPod knows the volume.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

/** The credits left on the account (RunPod's own figure): asked on mount, every minute, and when the pods change (a start or a stop moves the spend); the card is left out where RunPod does not say (no-spend mode, no key). */
const credits = ref(null)
const loadCredits = async () => { try { credits.value = await podsAPI.credits() } catch { credits.value = null } }
let timer = null
onMounted(() => { loadCredits(); timer = setInterval(loadCredits, 60_000) })
onBeforeUnmount(() => clearInterval(timer))
watch(() => `${pods.stats.running_pods}/${pods.stats.total_pods}`, loadCredits)
const LEVEL = { ok: 'success', low: 'warning', critical: 'danger' }
const left = (h) => (h == null ? '' : h >= 72 ? t('stats.daysLeft', { n: Math.round(h / 24) }) : t('stats.hoursLeft', { n: Math.round(h) }))
const creditCard = computed(() => {
  const c = credits.value
  if (!c) return []
  const rate = t('stats.atRate', { rate: Number(c.spend_per_hr).toFixed(2) })
  return [{ id: 'stat-credits', label: t('stats.credits'), value: '$' + Number(c.balance).toFixed(2), variant: LEVEL[c.level] || 'success', level: c.level, sub: c.hours_left != null ? `${left(c.hours_left)} · ${rate}` : t('stats.nothingSpending'), title: t('stats.creditsTitle', { limit: c.spend_limit != null ? '$' + Number(c.spend_limit).toFixed(0) : '—' }) }]
})

const cards = computed(() => [
  { id: 'stat-total', label: t('stats.total'), value: pods.stats.total_pods ?? 0, variant: 'primary' },
  { id: 'stat-running', label: t('stats.running'), value: pods.stats.running_pods ?? 0, variant: 'success' },
  { id: 'stat-stopped', label: t('stats.stopped'), value: pods.stats.stopped_pods ?? 0, variant: 'danger' },
  ...creditCard.value,
  ...(volume.value ? [{ id: 'stat-storage', label: t('stats.storage', { size: volume.value.size_gb }), value: '$' + volume.value.cost_per_month.toFixed(2), variant: 'info' }] : []),
])
</script>

<style scoped>
.stat-label { font-size: 0.7rem; letter-spacing: 0.03em; }
.stat-value { font-size: 1.5rem; }
.stat-sub { font-size: 0.72rem; }
.stat-card {
  border-left: 4px solid var(--stat-color);
}
</style>
