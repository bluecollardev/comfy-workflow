<template>
  <div v-if="g" class="small" data-testid="autopublish-generate-state">
    <div class="d-flex align-items-center gap-2 flex-wrap"><span class="badge text-bg-info fw-normal" data-testid="autopublish-generate-chip">{{ $t('autopublish.gen.chip', { where: $t(g.where === 'pod' ? 'autopublish.gen.pod' : 'autopublish.gen.local') }) }}</span>
      <span data-testid="autopublish-generate-line">{{ line }}</span></div>
    <div v-if="podLine" class="mt-1" data-testid="autopublish-generate-pod-line" :class="g.blocked ? 'text-warning' : ''">{{ podLine }}</div>
    <div v-if="g.pod && g.pod.est_cost_today_usd != null" class="text-body-secondary" data-testid="autopublish-generate-spend">{{ $t('autopublish.gen.spendToday', { usd: Number(g.pod.est_cost_today_usd).toFixed(2) }) }}</div>
    <div v-if="status.nothing_selected" class="text-warning mt-1" data-testid="autopublish-nothing-selected">{{ $t('autopublish.pipe.nothingSelected') }}</div>
    <div v-if="g.pending_existing > 0" class="text-body-secondary mt-1" data-testid="autopublish-existing-pending">{{ $t('autopublish.existing.pending', { n: g.pending_existing }) }}</div>
    <div v-if="waiting.length" class="mt-2" data-testid="autopublish-generate-waiting" :data-open="waitOpen ? 'true' : 'false'">
      <div class="d-flex align-items-center gap-2"><span class="fw-semibold" data-testid="autopublish-generate-waiting-title">{{ $t('autopublish.gen.waitingTitle', { n: waiting.length }) }}</span>
        <BButton variant="link" size="sm" class="p-0 ms-auto" data-testid="autopublish-generate-waiting-toggle" :aria-expanded="waitOpen" @click="waitOpen = !waitOpen">{{ waitOpen ? $t('autopublish.list.collapse') : $t('autopublish.list.expand') }}</BButton></div>
      <div v-if="waitOpen" class="border rounded" data-testid="autopublish-generate-waiting-list">
        <div v-for="w in waitShown" :key="`${w.source || ''}|${w.stem}`" class="d-flex align-items-center gap-2 px-2 py-1 border-bottom flex-nowrap" data-testid="autopublish-generate-waiting-row" :data-stem="w.stem">
          <span class="badge text-bg-secondary fw-normal flex-shrink-0" data-testid="autopublish-generate-waiting-chip">{{ $t('autopublish.list.settling') }}</span>
          <span class="font-monospace text-truncate" style="min-width: 0; max-width: 18rem" :title="w.stem" data-testid="autopublish-generate-waiting-name">{{ w.stem }}</span>
          <span v-if="w.source" class="badge fw-normal flex-shrink-0" :class="w.source === 'volume' ? 'text-bg-info' : 'text-bg-secondary'" data-testid="autopublish-generate-waiting-place">{{ $t(w.source === 'volume' ? 'autopublish.sources.badgeVolume' : 'autopublish.sources.badgeLocal') }}</span>
          <span v-if="w.frames" class="text-body-secondary flex-shrink-0" data-testid="autopublish-generate-waiting-frames">{{ $t('autopublish.existing.frames', { n: w.frames }) }}</span>
          <span v-if="w.since" class="text-body-secondary ms-auto flex-shrink-0" data-testid="autopublish-generate-waiting-since">{{ $t('autopublish.list.seenSince', { when: ago(w.since) }) }}</span></div>
        <BButton v-if="waiting.length > 5" variant="link" size="sm" class="px-2" data-testid="autopublish-generate-waiting-more" @click="waitAll = !waitAll">{{ waitAll ? $t('autopublish.list.fewer') : $t('autopublish.list.more', { n: waiting.length - 5 }) }}</BButton>
      </div></div>
    <div v-for="(c, i) in colourSkipped" :key="`c${i}`" class="text-warning" data-testid="autopublish-generate-colour-skipped"><span class="font-monospace">{{ c.stem }}</span>: {{ $t('autopublish.gen.colourSkipped') }}</div>
    <details v-if="failed.length" class="mt-1 text-danger" data-testid="autopublish-generate-failed"><summary>{{ $t('autopublish.gen.failed', { n: failed.length }) }}</summary>
      <div v-for="f in failed" :key="`${f.source || ''}|${f.stem}`" class="d-flex align-items-center gap-2 py-1 border-bottom" data-testid="autopublish-generate-failed-row"><span class="badge text-bg-danger fw-normal flex-shrink-0">{{ $t('autopublish.list.failedChip') }}</span><span class="font-monospace text-truncate" style="max-width: 18rem" :title="f.stem">{{ f.stem }}</span><span v-if="f.source" class="badge fw-normal flex-shrink-0" :class="f.source === 'volume' ? 'text-bg-info' : 'text-bg-secondary'">{{ $t(f.source === 'volume' ? 'autopublish.sources.badgeVolume' : 'autopublish.sources.badgeLocal') }}</span><span class="text-truncate" :title="f.reason">: {{ f.reason }}</span></div></details>
  </div>
</template>

<script setup>
/** AutoPublishGenerate: the state of rendering the outputs automatically (the core's status `generate`): what is rendering, what waits for its frames to settle, how many today of the cap, and what failed and why. */
import { computed, onBeforeUnmount, ref } from 'vue'
import { t } from '../i18n'
import { agoText } from '../utils/autopublish'

const props = defineProps({ status: { type: Object, default: null } })
const g = computed(() => (props.status?.generate?.enabled ? props.status.generate : null))
const count = (v) => (Array.isArray(v) ? v.length : Number(v) || 0)
const waitOpen = ref(true), waitAll = ref(false)
const now = ref(Date.now())
const tick = setInterval(() => { now.value = Date.now() }, 15000)
onBeforeUnmount(() => clearInterval(tick))
/** One row per (place, stem): the core is being fixed to dedupe, the list does it too. */
const waiting = computed(() => { const seen = new Set(); return (Array.isArray(g.value?.waiting_to_settle) ? g.value.waiting_to_settle : []).filter((w) => { const k = `${w.source || ''}|${w.stem}`; if (seen.has(k)) return false; seen.add(k); return true }) })
const waitShown = computed(() => (waitAll.value ? waiting.value : waiting.value.slice(0, 5)))
const colourRe = /colou?r/i
const colourSkipped = computed(() => [...(Array.isArray(g.value?.skipped) ? g.value.skipped : []), ...(Array.isArray(g.value?.failed) ? g.value.failed : [])].filter((x) => colourRe.test(x.reason || '')))
const failed = computed(() => { const seen = new Set(); return (Array.isArray(g.value?.failed) ? g.value.failed : []).filter((x) => !colourRe.test(x.reason || '')).filter((x) => { const k = `${x.source || ''}|${x.stem}`; if (seen.has(k)) return false; seen.add(k); return true }) })   // one row per (place, stem)
const line = computed(() => {
  const x = g.value
  return t(x.max_per_day == null ? 'autopublish.gen.lineNoMax' : 'autopublish.gen.line', { running: count(x.generating), waiting: waiting.value.length, today: x.generated_today ?? 0, max: x.max_per_day })
})
const podLine = computed(() => {
  const x = g.value
  if (x?.blocked) return t('autopublish.gen.blocked')
  const pod = x?.pod
  if (!pod) return ''
  if (pod.state === 'stopped' && pod.started_by_feature) return t('autopublish.gen.stoppedDone')
  if (pod.case === 'create') return t('autopublish.gen.creating', { card: pod.card || pod.gpu || '', price: pod.price_per_hour ?? '' })
  if (pod.case === 'resume' && pod.state !== 'running') return t('autopublish.gen.resuming', { name: pod.name })
  return t('autopublish.gen.using', { name: pod.name, state: pod.state || 'running' })
})
const ago = (iso) => agoText(iso, t, now.value)
</script>
