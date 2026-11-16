<template>
  <!-- Retry Later (ADR-042 section 19): what is waiting for a free card, and what came of the last ones -->
  <BCard v-if="rows.length" no-body class="mb-3 border-warning" data-testid="pod-watches">
    <BCardHeader class="py-2 small fw-semibold"><i class="fa-solid fa-hourglass-half me-1 text-warning"></i>{{ $t('podWatch.title') }}</BCardHeader>
    <ul class="list-group list-group-flush">
      <li v-for="w in rows" :key="w.id" class="list-group-item d-flex align-items-start gap-2 py-2" :data-testid="`pod-watch-${w.state}`" :data-watch="w.id">
        <div class="flex-grow-1 min-w-0">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <BBadge :variant="w.kind === 'create' ? 'info' : 'secondary'" data-testid="pod-watch-kind">{{ w.kind === 'create' ? $t('podWatch.kindCreate') : $t('podWatch.kindResume') }}</BBadge>
            <span class="fw-semibold text-truncate" data-testid="pod-watch-name">{{ w.name }}</span>
            <BSpinner v-if="w.state === 'waiting'" small class="text-warning" />
          </div>
          <div v-if="w.state === 'waiting'" class="small text-warning" data-testid="pod-watch-label">{{ w.label }}</div>
          <div v-if="w.state === 'waiting'" class="small text-body-secondary" data-testid="pod-watch-tries">{{ $t('podWatch.tries', { n: Math.round(w.every_s / 60), tries: w.attempts, at: clock(w.next_at) }) }}</div>
          <div v-if="w.state === 'waiting' && w.last_error" class="small text-body-secondary text-truncate" :title="w.last_error" data-testid="pod-watch-last">{{ $t('podWatch.lastError', { text: w.last_error }) }}</div>
          <div v-if="w.state !== 'waiting'" class="small" :class="w.state === 'done' ? 'text-success' : 'text-body-secondary'" data-testid="pod-watch-outcome">{{ outcome(w) }}</div>
        </div>
        <BButton v-if="w.state === 'waiting'" size="sm" variant="outline-light" :title="$t('podWatch.cancelTitle')" data-testid="pod-watch-cancel" @click="watches.cancel(w.id)">{{ $t('podWatch.cancel') }}</BButton>
      </li>
    </ul>
  </BCard>
</template>

<script setup>
/** The pod watches on screen: the ones waiting for a free card (with Cancel), and the ones that ended in the last 10 minutes (what came of them). */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { usePodWatchStore } from '../stores/podwatch'
import { t } from '../i18n'

const watches = usePodWatchStore()
const rows = computed(() => [...watches.waiting, ...watches.recent])
const clock = (iso) => (iso ? new Date(iso).toTimeString().slice(0, 5) : '')
function outcome(w) {
  if (w.state === 'done') return w.kind === 'create' ? t('podWatch.created', { name: w.name }) : t('podWatch.resumed', { name: w.name })
  if (w.state === 'cancelled') return t('podWatch.cancelled')
  if (w.state === 'expired') return t('podWatch.expired', { why: w.detail || '' })
  return t('podWatch.stopped', { why: (w.detail || w.last_error || '').replace(/^Stopped: /, '') })
}
onMounted(() => watches.watch())
onBeforeUnmount(() => watches.stop())
</script>
