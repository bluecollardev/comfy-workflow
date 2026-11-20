<template>
  <div v-if="!store.old && store.loaded" class="mb-4" data-testid="queue-publishing">
    <div class="d-flex align-items-center gap-2 mb-2"><h6 class="mb-0">{{ $t('queue.pub.title') }}</h6>
      <span class="ms-auto d-inline-flex gap-2">
        <BButton v-if="failedJobs.length" size="sm" variant="outline-light" data-testid="publishing-dismiss-failed" @click="failedJobs.forEach((j) => store.dismiss(j.job_id))">{{ $t('queue.dismissFailed', { n: failedJobs.length }) }}</BButton>
        <BButton v-if="finishedJobs.length" size="sm" variant="outline-light" data-testid="publishing-dismiss-all" @click="finishedJobs.forEach((j) => store.dismiss(j.job_id))">{{ $t('queue.dismissAll', { n: finishedJobs.length }) }}</BButton></span></div>
    <div v-if="!store.queueJobs.length" class="text-body-secondary small" data-testid="publishing-none">{{ $t('queue.pub.none') }}</div>
    <div v-for="j in pagedJobs" :key="j.job_id" class="border rounded p-2 mb-2 small" data-testid="publishing-job" :data-job="j.job_id" :data-state="j.state" :data-kind="isBackfill(j) ? 'backfill' : 'manual'">
      <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
        <strong data-testid="publishing-job-title">{{ title(j) }}</strong>
        <span v-for="tg in j.targets || []" :key="tg" class="badge text-bg-dark" data-testid="publishing-job-target">{{ tg === 's3' ? 'S3' : tg === 'slack' ? 'Slack' : tg }}</span>
        <span class="badge fw-normal" :class="triggerInfo(j).key === 'mcp' ? 'text-bg-info' : 'text-bg-secondary'" :title="triggerInfo(j).title" data-testid="publishing-job-trigger" :data-trigger="triggerInfo(j).key">{{ triggerInfo(j).label }}</span><span v-if="triggerInfo(j).external" class="badge text-bg-warning fw-normal" :title="EXTERNAL_TIP" data-testid="publishing-job-external">{{ $t('queue.external') }}</span>
        <span v-if="j.approved_by" class="text-body-secondary" data-testid="publishing-job-approver">{{ $t('queue.pub.approvedBy', { name: j.approved_by }) }}</span>
        <BButton size="sm" variant="link" class="p-0 ms-auto" data-testid="publishing-job-open" @click="openWindow(j)">{{ $t('queue.pub.open') }}</BButton>
        <BButton v-if="!active(j)" size="sm" variant="outline-light" data-testid="publishing-job-dismiss" @click="store.dismiss(j.job_id)">{{ $t('queue.gen.dismiss') }}</BButton>
      </div>
      <div class="d-flex gap-1 mb-1" data-testid="publishing-phases">
        <span v-for="c in chips(j)" :key="c.id" class="badge fw-normal" :class="c.active ? 'text-bg-primary' : c.done ? 'text-bg-success' : 'text-bg-secondary'" data-testid="publishing-phase" :data-phase="c.id" :data-active="c.active ? 'true' : 'false'">{{ $t(`queue.pub.phase.${c.id}`) }}</span>
      </div>
      <div v-if="j.skipped" class="text-body-secondary" data-testid="publishing-job-skipped">{{ $t('queue.pub.skipped', { n: j.skipped }) }}</div>
      <PublishJob :job="j" :embedded="true" @retry="openWindow(j)" />
    </div>
    <div v-if="store.queueJobs.length > PAGE_SIZES[0]" class="d-flex align-items-center gap-2 flex-wrap" data-testid="publishing-pager">
      <BButton size="sm" variant="outline-light" :disabled="page === 0" data-testid="publishing-page-prev" @click="page--"><i class="fa-solid fa-chevron-left me-1"></i>{{ $t('queue.pub.prev') }}</BButton>
      <span data-testid="publishing-page-info">{{ pageInfo }}</span>
      <BButton size="sm" variant="outline-light" :disabled="page >= pageCount - 1" data-testid="publishing-page-next" @click="page++">{{ $t('queue.pub.next') }}<i class="fa-solid fa-chevron-right ms-1"></i></BButton>
      <select v-model.number="pageSize" class="form-select form-select-sm ms-auto" style="width: auto" :aria-label="$t('queue.pub.pageSize')" data-testid="publishing-page-size"><option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ $t('queue.pub.perPage', { n }) }}</option></select>
    </div>
  </div>
</template>

<script setup>
/**
 * PublishingPane: the Queue's Publishing section (docs/ADR-051 section 9): the manual publishes and backfill uploads of publish.status() as jobs of the app, running first then the last 20 finished.
 * Each card reuses PublishJob (progress, numbers, Cancel, Slack state with Re-post, warnings, summary, grouped links) under its own header: title, targets, approver, phases, Open Publish window, Dismiss (local only).
 * Auto-publish's uploads are listed too, 10 cards to a page (5, 10 or 25). The store polls every second while this window is open or a job runs. Hidden on a core without Publishing.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePublishStore } from '../stores/publish'
import { usePodsStore } from '../stores/pods'
import { useUiStore } from '../stores/ui'
import { publishActive } from '../utils/publish'
import { triggerInfo, EXTERNAL_TIP } from '../utils/trigger'
import { t } from '../i18n'
import PublishJob from './PublishJob.vue'

const store = usePublishStore(), ui = useUiStore(), pods = usePodsStore()
const active = publishActive
// Paging: running jobs come first in the store's order, so page 1 always shows what is happening now
const PAGE_SIZES = [5, 10, 25], pageSize = ref(10), page = ref(0)
const pageCount = computed(() => Math.max(1, Math.ceil(store.queueJobs.length / pageSize.value)))
const pagedJobs = computed(() => store.queueJobs.slice(page.value * pageSize.value, (page.value + 1) * pageSize.value))
const pageInfo = computed(() => (store.queueJobs.length ? `${page.value * pageSize.value + 1}–${Math.min(store.queueJobs.length, (page.value + 1) * pageSize.value)} of ${store.queueJobs.length}` : '0'))
watch(pageSize, () => { page.value = 0 })
watch(pageCount, (n) => { if (page.value > n - 1) page.value = n - 1 })   // dismissing the last card of a page moves back one page
const finishedJobs = computed(() => store.queueJobs.filter((j) => !publishActive(j)))
const failedJobs = computed(() => finishedJobs.value.filter((j) => j.state === 'failed' || j.state === 'cancelled' || j.error))
const isBackfill = (j) => j.kind === 'backfill' || !!j.phase || /^bf-/.test(String(j.job_id))
const title = (j) => (isBackfill(j) ? t('queue.pub.backfill', { n: j.files_total || 0 }) : t('queue.pub.publish', { n: j.files_total || 0, dest: j.prefix || j.destination || store.settings.s3?.prefix || '' }).replace(/ · $/, ''))
/** Uploading, then Posting to Slack (only when Slack is a target): the active one is blue, the ones before it green. */
function chips(j) {
  const out = [{ id: 'uploading', active: j.state === 'uploading' || j.state === 'queued', done: ['posting', 'done', 'done_with_warning'].includes(j.state) }]
  if ((j.targets || []).includes('slack')) out.push({ id: 'posting', active: j.state === 'posting', done: ['done', 'done_with_warning'].includes(j.state) && j.slack?.state === 'sent' })
  return out
}
function openWindow(j) {
  const list = pods.pods || [], pod = list.find((p) => p.id === j.pod_id) || list.find((p) => p.status === 'RUNNING') || list[0]
  if (!pod) return
  ui.queueOpen = false; ui.outputsFor = { pod_id: pod.id, publish: true }
}
watch(() => ui.queueOpen, (open) => store.setFast(open), { immediate: true })
onMounted(() => store.loadSettings())
onBeforeUnmount(() => store.setFast(false))
</script>
