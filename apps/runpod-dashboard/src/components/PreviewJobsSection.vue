<template>
  <div v-if="!pjobs.old && rows.length" class="mb-4" data-testid="queue-previewjobs">
    <div class="d-flex align-items-center gap-2 mb-2">
      <h6 class="mb-0" data-testid="queue-previewjobs-title">{{ $t('queue.pjob.title', { n: pjobs.activeCount }) }}</h6>
      <BButton v-if="pjobs.finished.length" size="sm" variant="outline-light" class="ms-auto" data-testid="queue-previewjobs-remove-all" @click="pjobs.dismissFinished()">{{ $t('queue.pjob.removeAll', { n: pjobs.finished.length }) }}</BButton>
    </div>
    <div v-for="j in rows" :key="j.job_id" class="border rounded p-2 mb-2 small" data-testid="queue-previewjob" :data-job="j.job_id" :data-state="j.state" :data-kind="rowKind(j)" :data-external="j.external ? 'true' : 'false'">
      <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
        <strong data-testid="queue-previewjob-label">{{ $t(`queue.pjob.kind.${rowKind(j)}`) }}</strong>
        <span v-if="podLabel(j)" class="text-body-secondary" data-testid="queue-previewjob-pod" :title="j.pod_id">{{ podLabel(j) }}</span>
        <span v-if="j.external" class="badge text-bg-info fw-normal" :title="$t('queue.run.externalTip')" data-testid="queue-previewjob-external">{{ j.client || $t('queue.run.external') }}</span>
        <span v-if="j.relaunch_of" class="badge text-bg-secondary fw-normal" data-testid="queue-previewjob-relaunch-of">{{ $t('queue.pjob.relaunchOf') }}</span>
        <span class="badge" :class="chip(j.state)" data-testid="queue-previewjob-state">{{ $t(`queue.pjob.state.${j.state}`, j.state) }}</span>
        <span v-if="j.failed" class="badge text-bg-danger fw-normal" data-testid="queue-previewjob-failed">{{ $t('queue.gen.failedN', { n: j.failed }) }}</span>
        <span class="ms-auto d-inline-flex gap-2">
          <BButton v-if="canRelaunch(j)" size="sm" variant="outline-warning" :title="$t('queue.pjob.relaunchTitle')" data-testid="queue-previewjob-relaunch" @click="pjobs.relaunch(j)"><i class="fa-solid fa-rotate-right me-1"></i>{{ $t('queue.pjob.relaunch') }}</BButton>
          <BButton v-if="j.state === 'running'" size="sm" variant="outline-warning" data-testid="queue-previewjob-cancel" @click="pjobs.cancel(j)"><i class="fa-solid fa-stop me-1"></i>{{ $t('queue.cancel') }}</BButton>
          <BButton v-else-if="canRemove(j)" size="sm" variant="outline-light" :title="$t('queue.pjob.removeTitle')" data-testid="queue-previewjob-remove" @click="pjobs.dismiss(j.job_id)">{{ $t('queue.pjob.remove') }}</BButton>
        </span>
      </div>
      <div class="text-body-secondary" data-testid="queue-previewjob-when" :title="j.started_at"><span data-testid="queue-previewjob-started">{{ $t('queue.gen.jobStarted', { when: when(j.started_at) }) }}</span><template v-if="j.finished_at"> · <span data-testid="queue-previewjob-finished">{{ $t('queue.pjob.finished', { when: when(j.finished_at) }) }}</span></template><template v-if="elapsed(j)"> · <span data-testid="queue-previewjob-elapsed">{{ elapsed(j) }}</span></template></div>
      <BProgress :value="percentOf(j) ?? 0" :max="100" height="8px" :animated="j.state === 'running'" :striped="j.state === 'running'" class="mb-2 mt-1" data-testid="queue-previewjob-bar" :data-percent="percentOf(j) ?? 0" />
      <div class="text-body-secondary" data-testid="queue-previewjob-counters">{{ counterLine(j, word) || $t('queue.pjob.noCounters') }}<span v-if="percentOf(j) != null"> · {{ percentOf(j) }}%</span></div>
      <div v-if="j.current && j.state === 'running'" class="font-monospace text-truncate text-body-secondary" data-testid="queue-previewjob-current" :title="j.current">{{ j.current }}</div>
      <div v-if="j.error" class="text-danger" data-testid="queue-previewjob-error">{{ j.error }}</div>
      <div v-if="pjobs.note[j.job_id] === 'nothing'" class="text-body-secondary" data-testid="queue-previewjob-nothing">{{ $t('queue.pjob.nothingToDo') }}</div>
      <div v-else-if="pjobs.note[j.job_id]" class="text-danger" data-testid="queue-previewjob-note">{{ pjobs.note[j.job_id] }}</div>
      <div v-if="pjobs.needsPod[j.job_id]" class="text-warning mt-1" data-testid="queue-previewjob-needs-pod">
        <div class="fw-semibold">{{ $t('outputs.frames.needsPod') }}</div>
        <div v-if="!pjobs.needsPod[j.job_id].stopped.length">{{ $t('outputs.frames.needsPodNone') }}</div>
        <div v-for="p in pjobs.needsPod[j.job_id].stopped" :key="p.id" class="d-flex align-items-center gap-2 mt-1" data-testid="queue-previewjob-needs-pod-row"><span>{{ p.name }}</span><BButton size="sm" variant="outline-warning" data-testid="queue-previewjob-resume-pod" @click="resume(j, p)">{{ $t('outputs.frames.resumePod') }}</BButton></div>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * PreviewJobsSection: the frame-previews jobs in the Queue's Generations (Lucas, 2026-11-21: "i should see previews jobs in queue no? generations tab?", "and thumbnails generation, frames generation etc").
 * One row per job: what it is (Frame Previews, Thumbnails, Posters, or Auto Previews), the pod, its state, a bar and the counters per kind (`Frames 412 of 650 · Thumbnails 380 of 650 · Posters 3 of 12`), the folder it is on,
 * the error. Cancel while it runs (also a job another process runs: its owner is asked), Relaunch for a stopped one (the unfinished folders, finished frames skipped; with no pod running it says so and offers Resume Pod,
 * never a new pod), Remove for a finished one (hides the row; the previews on the pod stay). Render runs and review videos have their own rows in this tab.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { usePreviewJobsStore } from '../stores/previewjobs'
import { usePodsStore } from '../stores/pods'
import { useConfirmStore } from '../stores/confirm'
import { rowKind, counterLine, percentOf, podName, canRelaunch, canRemove } from '../utils/previewjobs'
import { whenText } from '../utils/when'
import { t } from '../i18n'

const pjobs = usePreviewJobsStore(), podsStore = usePodsStore(), confirm = useConfirmStore()
const now = ref(Date.now())
const tick = setInterval(() => { now.value = Date.now() }, 1000)
onBeforeUnmount(() => clearInterval(tick))
const rows = computed(() => pjobs.rows)
const when = (at) => whenText(at, new Date(now.value))
const podLabel = (j) => podName(j, podsStore.pods)
const word = (id) => t(`queue.pjob.count.${id}`)
const chip = (s) => (s === 'running' ? 'text-bg-primary' : s === 'done' ? 'text-bg-success' : s === 'cancelled' ? 'text-bg-dark' : 'text-bg-danger')
/** `3 min 12 s` from the start to the end (or to now while it runs). */
function elapsed(j) {
  const a = Date.parse(j.started_at), b = j.finished_at ? Date.parse(j.finished_at) : now.value
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return ''
  const s = Math.round((b - a) / 1000)
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`
}
/** Resume one of the stopped pods the core named (it bills while it runs, so it asks first), then the person relaunches. */
async function resume(j, p) {
  if (!(await confirm.ask(t('outputs.frames.resumeConfirm', { name: p.name }), { okLabel: t('outputs.frames.resumePod'), danger: false }))) return
  const r = await podsStore.resume(p.id)
  if (r?.ok) pjobs.clearNeedsPod(j.job_id)
}
</script>
