<template>
  <div>
    <!-- Auto-publish busy populating: one line, the most important state first, the others as a count -->
    <BAlert v-if="working" :model-value="true" variant="info" class="mb-0 rounded-0 border-start-0 border-end-0 py-2 px-3 small d-flex align-items-center flex-wrap gap-2" data-testid="autopublish-working-banner" :data-state="working.state">
      <BSpinner v-if="working.spin" small class="me-2 flex-shrink-0" data-testid="autopublish-working-spinner" /><i v-else class="fa-solid fa-cloud-arrow-up me-2"></i>
      <span data-testid="autopublish-working-text">{{ working.text }}</span><span v-if="working.more" class="text-body-secondary" data-testid="autopublish-working-more">{{ $t('queue.banner.more', { n: working.more }) }}</span>
      <BButton variant="link" size="sm" class="p-0 ps-4 ms-auto" data-testid="autopublish-working-open" @click="openQueue">{{ $t('queue.banner.open') }}</BButton>
    </BAlert>
  </div>
</template>

<script setup>
/**
 * QueueBanners: the two banners under the nav bar for the Queue. (1) 'Loading the queue…' while the Queue window's data is on its way (after 5 s it says the volume is slow; a failure says why with Retry).
 * (2) 'Auto-publish: …' on every screen while Auto-publish is busy (uploading, generating, waiting out its window, waiting for frames to settle, scanning); nothing when it is idle or off.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useUiStore } from '../stores/ui'
import { useAutopublishStore } from '../stores/autopublish'
import { usePublishStore } from '../stores/publish'
import { publishActive } from '../utils/publish'
import { countdownText, secondsUntil } from '../utils/autopublish'
import { t } from '../i18n'

const ui = useUiStore(), ap = useAutopublishStore(), pub = usePublishStore()
const now = ref(Date.now())
const tick = setInterval(() => { now.value = Date.now() }, 1000)
onBeforeUnmount(() => { clearInterval(tick) })

// (2) Auto-publish is working
const working = computed(() => {
  const s = ap.status
  if (ap.old || !s?.enabled) return null
  const g = s.generate?.enabled ? s.generate : null, states = []
  const jobs = pub.jobs.filter((j) => j.trigger === 'auto-publish' && publishActive(j))
  const up = jobs[0] || (ap.pending || []).find((e) => e.state === 'uploading')
  if (up) {
    const j = jobs[0], pct = j?.bytes_total ? Math.round((100 * (j.bytes_done || 0)) / j.bytes_total) : null
    states.push({ state: 'uploading', spin: true, text: j?.state === 'posting' ? t('queue.banner.posting') : t('queue.banner.uploading', { shot: j?.shot || up.shot || '', pct: pct == null ? '' : ` · ${pct}%` }) })
  }
  const n = typeof g?.generating === 'number' ? g.generating : Array.isArray(g?.generating) ? g.generating.length : 0
  if (n > 0) states.push({ state: 'generating', spin: true, text: t('queue.banner.generating', { n, where: g.pod?.name || (g.where === 'pod' ? t('autopublish.gen.pod') : t('autopublish.gen.local')), current: g.current ? ` · ${g.current}` : '' }) })
  const waiting = (ap.pending || []).filter((e) => e.state === 'waiting')
  if (waiting.length) { const secs = Math.min(...waiting.map((e) => secondsUntil(e.due_at, now.value))); states.push({ state: 'window', spin: false, text: t('queue.banner.window', { n: waiting.length, t: countdownText(secs) }) }) }
  const settling = Array.isArray(g?.waiting_to_settle) ? g.waiting_to_settle.length : 0
  if (settling) states.push({ state: 'settling', spin: false, text: t('queue.banner.settling', { n: settling }) })
  if (s.watching?.volume?.scanning || s.watching?.local?.scanning) states.push({ state: 'scanning', spin: true, text: t('queue.banner.scanning') })
  return states.length ? { ...states[0], more: states.length - 1 } : null
})
function openQueue() { ui.queueFocus = 'autopublish'; ui.queueTab = 'publishing'; ui.queueOpen = true }
</script>

