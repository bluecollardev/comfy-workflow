<template>
  <div data-testid="volume-job" :data-state="job.state" :data-kind="job.kind">
    <div class="d-flex align-items-center flex-wrap gap-2">
      <BSpinner v-if="live" small />
      <i v-else-if="job.state === 'done'" class="fa-solid fa-check text-success"></i>
      <i v-else class="fa-solid fa-triangle-exclamation text-danger"></i>
      <strong data-testid="volume-job-state">{{ stateText }}</strong>
      <span v-if="job.pod_name" class="text-body-secondary font-monospace" data-testid="volume-job-pod">{{ job.pod_name }}</span>
      <span class="ms-auto"><slot name="actions"></slot></span>   <!-- the action (Cancel) floats to the right of the row -->
    </div>
    <div v-if="showBar" class="mt-1" data-testid="volume-job-progress">
      <BProgress :value="pct" :max="100" height="8px" variant="info" :striped="live" :animated="live" class="mb-1" data-testid="volume-job-bar" :data-percent="Math.round(pct)" />
      <div class="text-body-secondary" data-testid="volume-job-detail">{{ detail }}</div>
    </div>
    <div v-if="job.error && !live" class="text-danger mt-1" data-testid="volume-job-error">{{ job.error }}</div>
  </div>
</template>

<script setup>
/** One volume job's live state (ADR-042 section 16): the current stage in title case, and for a download the bar with file i of n, bytes, rate and ETA. Shown in the Models window and in the Queue. */
import { computed } from 'vue'
import { t } from '../i18n'
import { fmtBytes as fmt } from '../utils/studioTree'
import { ucwords } from '../utils/ucwords'

const props = defineProps({ job: { type: Object, required: true } })
const TERMINAL = ['done', 'failed', 'cancelled', 'interrupted']
const live = computed(() => !TERMINAL.includes(props.job.state))
const isFetch = computed(() => props.job.kind === 'fetch')
const stateText = computed(() => {
  const j = props.job, f = j.fetch
  if (j.state === 'pulling' && isFetch.value && f) return ucwords(t('vjob.downloading', { i: f.index, n: f.count }))
  const files = (n) => t(n === 1 ? 'models.fileOne' : 'models.fileMany', { n })
  if (j.state === 'done' && isFetch.value) return ucwords(t('vjob.doneFetch', { what: files((j.fetched || []).length) }))
  if (j.state === 'done' && j.kind === 'delete-models') return ucwords(t('vjob.doneDelete', { what: files((j.deleted || []).length), size: fmt(j.freed_bytes || 0) }))
  return ucwords(t(`vjob.state_${j.state}${isFetch.value && j.state === 'verifying' ? '_fetch' : ''}`))
})
const total = computed(() => props.job.bytes_total || 0)
const showBar = computed(() => isFetch.value && total.value > 0 && (live.value || props.job.state === 'done'))
const pct = computed(() => (total.value ? Math.min(100, ((props.job.state === 'done' ? total.value : props.job.bytes_done || 0) / total.value) * 100) : 0))
const eta = (s) => (s == null ? '' : s >= 3600 ? `${Math.floor(s / 3600)} H ${Math.round((s % 3600) / 60)} Min` : s >= 60 ? `${Math.round(s / 60)} Min` : `${s} S`)
const detail = computed(() => {
  const j = props.job, f = j.fetch
  const rate = j.rate ? `${fmt(j.rate)}/s${f?.eta_s != null ? `, ${t('vjob.eta')} ${eta(f.eta_s)}` : ''}` : ''
  const head = f && live.value ? `${ucwords(t('vjob.file', { i: f.index, n: f.count }))}: ${f.file} — ` : ''
  return `${head}${fmt(Math.min(j.bytes_done || 0, total.value))} ${t('vjob.of')} ${fmt(total.value)}${rate ? ` (${rate})` : ''}`
})
</script>
