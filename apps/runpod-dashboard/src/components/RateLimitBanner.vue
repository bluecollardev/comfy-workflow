<template>
  <!-- RunPod is limiting requests: one calm line under the nav bar, not an error per list (ADR-042 section 18) -->
  <BAlert v-if="rate.limited" :model-value="true" variant="warning" class="mb-0 rounded-0 border-start-0 border-end-0 py-2 small" data-testid="rate-limit-banner">
    <i class="fa-solid fa-gauge-high me-1"></i>{{ rate.ageMin == null ? $t('rate.banner', { window: windowLabel, at: rate.retryAt }) : $t('rate.bannerStale', { window: windowLabel, min: rate.ageMin, at: rate.retryAt }) }}
  </BAlert>
</template>

<script setup>
/** One banner under the nav bar while RunPod limits the app's requests: which window (minute or hour), how old what is shown is, and when the app tries again. */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRateLimitStore } from '../stores/ratelimit'
import { t } from '../i18n'

const rate = useRateLimitStore()
const windowLabel = computed(() => t(`rate.window_${rate.status.window || 'unknown'}`))
onMounted(() => rate.watch())
onBeforeUnmount(() => rate.stop())
</script>
