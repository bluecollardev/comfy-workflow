<template>
    <div class="border rounded p-2 mt-3" data-testid="publish-job" :data-state="job.state" :data-job="job.job_id">
      <div class="fw-semibold small" data-testid="publish-job-state">{{ $t(`publish.modal.state.${job.state}`) }}</div>
      <BProgress :value="percent" :max="100" :animated="active" :striped="active" height="0.6rem" :data-percent="percent" data-testid="publish-progress" />
      <div class="small mt-1" data-testid="publish-job-numbers">{{ $t('publish.modal.progress', { done: job.files_done || 0, total: job.files_total || 0, bytes: formatBytes(job.bytes_done || 0), totalBytes: formatBytes(job.bytes_total || 0) }) }}<template v-if="job.rate_bps"> · {{ $t('publish.modal.rate', { rate: formatBytes(job.rate_bps) }) }}</template></div>
      <div v-if="via" class="small text-body-secondary" data-testid="publish-job-via" :data-adapter="job.adapter">{{ via }}</div>
      <div v-if="job.phase"class="small text-info" data-testid="publish-job-phase" :data-phase="job.phase">{{ $t(`publish.backfill.phase.${job.phase}`) }}</div>
      <div v-if="job.uploaded != null || failed.length" class="small" data-testid="publish-job-result">{{ $t('publish.backfill.result', { uploaded: job.uploaded ?? job.files_done ?? 0, there: job.skipped ?? 0, failed: failed.length }) }}</div>
      <div v-for="f in failed" :key="f.path" class="small text-danger" data-testid="publish-job-failed" :data-path="f.path"><span class="font-monospace">{{ f.path }}</span>: {{ f.error }}</div>
      <BButton v-if="failed.length && !active" size="sm" variant="outline-warning" class="mt-1" data-testid="publish-retry-failed" @click="emit('retry', failed)"><i class="fa-solid fa-rotate me-1"></i>{{ $t('publish.backfill.retry') }}</BButton>
      <div v-if="job.current && active" class="small font-monospace text-body-secondary" data-testid="publish-job-current">{{ job.current }}</div>
      <BButton v-if="active" size="sm" variant="outline-warning" class="mt-1" data-testid="publish-cancel" @click="store.cancel(job.job_id)"><i class="fa-solid fa-stop me-1"></i>{{ $t('publish.modal.cancel') }}</BButton>
      <div v-if="job.summary" class="small" data-testid="publish-job-summary">{{ job.summary }}</div>
      <div v-if="job.error" class="small text-danger" data-testid="publish-job-error">{{ job.error }}</div>
      <div v-if="job.links?.length" class="mt-2" data-testid="publish-links"><div class="small fw-semibold">{{ $t('publish.modal.links') }}</div>
        <div v-for="l in job.links" :key="l.path" class="d-flex align-items-center gap-2 small" data-testid="publish-link" :data-path="l.path"><span class="font-monospace text-truncate" :title="l.url">{{ l.path }}</span>
          <BButton size="sm" variant="outline-light" data-testid="publish-link-copy" :data-path="l.path" @click="copy(l)">{{ copiedPath === l.path ? $t('publish.modal.copied') : $t('publish.modal.copy') }}</BButton>
          <span v-if="l.expires_at" class="text-body-secondary" data-testid="publish-link-expiry">{{ $t('publish.modal.expires', { when: expiryText(l.expires_at) }) }}</span></div></div>
      <div v-if="job.slack && job.slack.state !== 'skipped' || job.slack?.state === 'failed'" class="small mt-1 d-flex align-items-center gap-2" data-testid="publish-slack-state" :data-state="job.slack.state"><span :class="job.slack.state === 'failed' ? 'text-danger' : 'text-success'">{{ $t(`publish.modal.slackState.${job.slack.state}`, { error: job.slack.error || '' }) }}</span>
        <BButton v-if="job.slack.state === 'failed'" size="sm" variant="outline-light" data-testid="publish-slack-repost" @click="store.repost(job.job_id)">{{ $t('publish.modal.repost') }}</BButton></div>
    </div>
</template>

<script setup>
/** PublishJob: one publish job (files, bytes, rate, the file under way, Cancel), its result (uploaded, already there, failed with reasons, Retry failed), the links with Copy and expiry, and the Slack state with Re-post. Shared by the Publish and Backfill tabs. */
import { computed, ref } from 'vue'
import { t } from '../i18n'
import { usePublishStore } from '../stores/publish'
import { formatBytes } from '../sync-progress'
import { expiryText, publishActive } from '../utils/publish'

const props = defineProps({ job: { type: Object, required: true } })
const emit = defineEmits(['retry'])
const store = usePublishStore()
const copiedPath = ref('')
const active = computed(() => publishActive(props.job))
/** How the volume files travel: "via pod <name>" or "via this PC" (a job from an older core says nothing). */
const via = computed(() => { const j = props.job; return j.adapter === 'pod' ? t('publish.modal.viaPod', { pod: j.pod || '' }) : j.adapter === 'pc' ? t('publish.modal.viaPc') : '' })
const failed = computed(() => (Array.isArray(props.job.failed) ? props.job.failed : []))
const percent = computed(() => { const j = props.job; return j.state === 'done' || j.state === 'done_with_warning' ? 100 : j.bytes_total ? Math.round((100 * (j.bytes_done || 0)) / j.bytes_total) : j.files_total ? Math.round((100 * (j.files_done || 0)) / j.files_total) : 0 })
async function copy(l) { try { await navigator.clipboard.writeText(l.url); copiedPath.value = l.path; setTimeout(() => { if (copiedPath.value === l.path) copiedPath.value = '' }, 2000) } catch { copiedPath.value = '' } }
</script>
