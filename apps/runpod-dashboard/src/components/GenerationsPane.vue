<template>
  <div v-if="!renders.old" class="mb-4" data-testid="queue-generations">
    <div class="d-flex align-items-center gap-2 mb-2"><h6 class="mb-0">{{ $t('queue.gen.title') }}</h6>
      <span class="ms-auto d-inline-flex gap-2">
        <BButton v-if="failedJobs.length" size="sm" variant="outline-light" data-testid="generations-dismiss-failed" @click="failedJobs.forEach((j) => renders.dismiss(j.job_id))">{{ $t('queue.dismissFailed', { n: failedJobs.length }) }}</BButton>
        <BButton v-if="finishedJobs.length" size="sm" variant="outline-light" data-testid="generations-dismiss-all" @click="finishedJobs.forEach((j) => renders.dismiss(j.job_id))">{{ $t('queue.dismissAll', { n: finishedJobs.length }) }}</BButton></span></div>
    <div v-if="!jobs.length && !previews.batch" class="text-body-secondary small" data-testid="generations-none">{{ $t('queue.gen.none') }}</div>
    <!-- the Previews batch -->
    <div v-if="previews.batch" class="border rounded p-2 mb-2 small" data-testid="generations-previews" :data-state="previews.batch.state">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <strong data-testid="generations-previews-line">{{ batchLine(previews.batch, $t) }}</strong>
        <span v-if="previews.batch.label" class="text-body-secondary">{{ previews.batch.label }}</span>
        <BSpinner v-if="previews.running" small />
        <span v-else class="badge text-bg-secondary" data-testid="generations-previews-state">{{ $t(previews.batch.state === 'done' ? 'queue.gen.previewsDone' : 'queue.gen.previewsStopped') }}</span>
        <BButton v-if="previews.running" size="sm" variant="outline-warning" class="ms-auto" data-testid="generations-previews-stop" @click="previews.stop()"><i class="fa-solid fa-stop me-1"></i>{{ $t('queue.gen.stop') }}</BButton>
        <BButton v-else size="sm" variant="outline-light" class="ms-auto" data-testid="generations-previews-dismiss" @click="previews.dismiss()">{{ $t('queue.gen.dismiss') }}</BButton>
      </div>
      <BProgress :value="previews.batch.done" :max="Math.max(1, previews.batch.total)" height="8px" :animated="previews.running" :striped="previews.running" class="mt-1" data-testid="generations-previews-bar" :data-percent="Math.round((100 * previews.batch.done) / Math.max(1, previews.batch.total))" />
    </div>
    <!-- render jobs -->
    <div v-for="j in jobs" :key="j.job_id" class="border rounded p-2 mb-2 small" data-testid="generations-job" :data-job="j.job_id" :data-state="j.state" :data-kind="j.kind || 'proxy'">
      <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
        <!-- Play is always the first, leftmost item, in a slot of its own width (a disabled one of the same size when nothing is playable yet) so the rows line up -->
        <span class="flex-shrink-0 d-inline-flex" style="width: 2rem" data-testid="generations-job-play-slot">
          <BButton v-if="doneOk(j)" size="sm" variant="outline-light" class="px-2" :title="$t('queue.gen.play')" :aria-label="$t('queue.gen.play')" data-testid="generations-job-play" @click="play(j)"><i class="fa-solid fa-play"></i></BButton>
          <BButton v-else size="sm" variant="outline-light" class="px-2" disabled :title="$t('queue.gen.playNone')" :aria-label="$t('queue.gen.play')" data-testid="generations-job-play-disabled"><i class="fa-solid fa-play"></i></BButton>
        </span>
        <strong data-testid="generations-job-title">{{ jobTitle(j, $t) }}{{ renders.scopes[j.job_id] ? ` · ${renders.scopes[j.job_id]}` : '' }}</strong>
        <span class="badge text-bg-secondary" data-testid="generations-job-kind">{{ $t(j.kind === 'review' ? 'queue.gen.review' : 'queue.gen.proxy') }}</span>
        <span v-for="w in adapters(j)" :key="w" class="badge text-bg-dark" data-testid="generations-job-where">{{ $t(`outputs.render.whereBadge.${w}`) }}</span>
        <span v-if="j.trigger === 'auto-publish'" class="badge text-bg-info fw-normal" data-testid="generations-job-auto">{{ $t('autopublish.gen.badge') }}</span>
        <span class="badge fw-normal" :class="triggerInfo(j).key === 'mcp' ? 'text-bg-info' : 'text-bg-secondary'" :title="triggerInfo(j).title" data-testid="generations-job-trigger" :data-trigger="triggerInfo(j).key">{{ triggerInfo(j).label }}</span><span v-if="triggerInfo(j).external" class="badge text-bg-warning fw-normal" :title="EXTERNAL_TIP" data-testid="generations-job-external">{{ $t('queue.external') }}</span>
        <span v-if="j.pod_name" class="text-body-secondary">{{ j.pod_name }}</span>
        <span class="badge" :class="stateClass(j.state)" data-testid="generations-job-state">{{ $t(`outputs.render.state.${j.state}`, j.state) }}</span>
        <BButton v-if="active(j)" size="sm" variant="outline-warning" class="ms-auto" data-testid="generations-job-stop" @click="renders.cancel(j.job_id)"><i class="fa-solid fa-stop me-1"></i>{{ $t('queue.gen.stop') }}</BButton>
        <BButton v-else size="sm" variant="outline-light" class="ms-auto" data-testid="generations-job-dismiss" @click="renders.dismiss(j.job_id)">{{ $t('queue.gen.dismiss') }}</BButton>
      </div>
      <div v-if="attemptOf(j).started" class="text-body-secondary" data-testid="generations-job-when" :title="attemptOf(j).ago"><span data-testid="generations-job-started">{{ attemptOf(j).started }}</span><template v-if="attemptOf(j).finished"> · <span data-testid="generations-job-finished">{{ attemptOf(j).finished }}</span></template></div>
      <div class="d-flex gap-1 mb-1" data-testid="generations-phases">
        <span v-for="c in phaseChips(j)" :key="c.id" class="badge fw-normal" :class="c.active ? 'text-bg-primary' : c.done ? 'text-bg-success' : 'text-bg-secondary'" data-testid="generations-phase" :data-phase="c.id" :data-active="c.active ? 'true' : 'false'">{{ $t(`queue.gen.phase.${c.id}`) }}</span>
      </div>
      <div v-if="autoPublishOf(j)" class="mb-1" data-testid="generations-job-autopub" :data-state="autoPublishOf(j)"><span class="badge fw-normal" :class="autoPubClass(autoPublishOf(j))">{{ $t('queue.gen.autoPub', { state: $t(`queue.gen.autoPubState.${autoPublishOf(j)}`) }) }}</span></div>
      <BProgress :value="percentOf(j)" :max="100" height="8px" :animated="active(j)" :striped="active(j)" data-testid="generations-job-bar" :data-percent="percentOf(j)" />
      <div class="text-body-secondary" data-testid="generations-job-numbers">{{ numbers(j) }}</div>
      <div v-if="j.kind === 'review' && j.state === 'done'" class="d-flex gap-2 flex-wrap" data-testid="generations-job-approve"><span v-for="rv in reviewVersions(j)" :key="`${rv.shot}-${rv.version}`" class="d-inline-flex align-items-center gap-1"><span class="font-monospace">{{ rv.shot }} {{ versionTag(rv.version) }}</span><ApproveControl :shot="rv.shot" :version="rv.version" /></span></div>
      <div v-if="skippedCount(j)" class="text-body-secondary" data-testid="generations-job-skipped">{{ $t('queue.gen.skippedN', { n: skippedCount(j) }) }}</div>
      <div v-if="j.current && active(j)" class="font-monospace text-truncate text-body-secondary" data-testid="generations-job-current">{{ j.current }}</div>
      <div v-if="j.publish" class="text-body-secondary" data-testid="generations-job-publish">{{ $t('queue.gen.publishState', { state: j.publish.state }) }}</div>
      <div v-if="j.error" class="text-danger" data-testid="generations-job-error">{{ j.error }}<BButton v-if="failureOf(j)" variant="link" size="sm" class="p-0 ms-2" data-testid="generations-job-failure-link" @click="ui.failureFocus = failureOf(j).id">{{ $t('queue.fail.see') }}</BButton></div>
      <div v-if="!active(j) && j.summary" class="text-success" data-testid="generations-job-summary">{{ j.summary }}</div>
      <div v-if="!active(j) && files(j).length" class="text-body-secondary" data-testid="generations-job-files"><span class="fw-semibold">{{ $t('queue.gen.files') }}:</span> <span v-for="f in files(j)" :key="f" class="font-monospace me-2">{{ f }}</span></div>
      <div class="mt-1">
        <BButton variant="link" size="sm" class="p-0" data-testid="generations-job-rows-toggle" :aria-expanded="openRows.has(j.job_id)" @click="toggle(j.job_id)">{{ openRows.has(j.job_id) ? '▾' : '▸' }} {{ $t('queue.gen.sequences') }} ({{ (j.sequences || []).length }})</BButton>
        <BButton v-if="!active(j) && j.pod_id" size="sm" variant="link" class="p-0 ms-2" data-testid="generations-job-open-outputs" @click="openOutputs(j)">{{ $t('queue.gen.openOutputs') }}</BButton>
      </div>
      <ul v-if="openRows.has(j.job_id)" class="list-unstyled mb-0 mt-1" data-testid="generations-seqs">
        <li v-for="(s, i) in j.sequences || []" :key="i" class="d-flex align-items-center gap-2 flex-wrap" data-testid="generations-seq" :data-state="s.state" :data-name="s.name">
          <span class="font-monospace text-truncate" style="max-width: 18rem">{{ s.clip_name || s.name }}</span>
          <span v-if="s.where" class="badge text-bg-secondary">{{ $t(`outputs.render.whereBadge.${s.where}`) }}</span>
          <span :class="s.state === 'failed' ? 'text-danger' : 'text-body-secondary'" data-testid="generations-seq-state">{{ $t(`outputs.render.state.${s.state}`, s.state) }}</span>
          <BProgress v-if="s.frames_total" :value="s.frames_done || 0" :max="s.frames_total" height="4px" style="width: 7rem" data-testid="generations-seq-bar" :data-percent="Math.round((100 * (s.frames_done || 0)) / s.frames_total)" />
          <span v-if="s.error" class="text-danger" data-testid="generations-seq-error">{{ s.error }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
/**
 * GenerationsPane: the Queue's Generations section (docs/ADR-051 section 9): the render jobs (Render sequences, proxies and reviews, on a pod or on this PC) and the preview batch, as jobs of the app.
 * Both are stores, so a job started in a window shows here whenever the Queue is opened; Stop ends one; a finished one can be played or dismissed. Hidden quietly on a core without the render calls.
 */
import { attempt } from '../utils/when'
import { useFailuresStore } from '../stores/failures'
import { triggerInfo, EXTERNAL_TIP } from '../utils/trigger'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRendersStore } from '../stores/renders'
import { usePreviewsStore } from '../stores/previews'
import { useUiStore } from '../stores/ui'
import ApproveControl from './ApproveControl.vue'
import { versionTag } from '../utils/autopublish'
import { useAutopublishStore } from '../stores/autopublish'
import { t } from '../i18n'
import { isActive, currentSequence } from '../utils/renders'
import { phaseChips, etaSeconds, etaText, jobTitle, orderJobs, jobFiles, batchLine, percentOf } from '../utils/generations'

const renders = useRendersStore(), previews = usePreviewsStore(), ui = useUiStore()
const jobs = computed(() => orderJobs(renders.jobs, renders.dismissed))
const active = isActive
const finishedJobs = computed(() => jobs.value.filter((j) => !isActive(j)))
const failedJobs = computed(() => finishedJobs.value.filter((j) => j.state === 'failed' || j.state === 'cancelled' || j.error))
const openRows = ref(new Set())
const toggle = (id) => { const n = new Set(openRows.value); n.has(id) ? n.delete(id) : n.add(id); openRows.value = n }
const adapters = (j) => [...new Set((j.sequences || []).map((s) => s.where).filter(Boolean))]
const stateClass = (s) => ({ done: 'text-bg-success', failed: 'text-bg-danger', cancelled: 'text-bg-dark', rendering: 'text-bg-primary', pulling: 'text-bg-info', publishing: 'text-bg-info', queued: 'text-bg-secondary' }[s] || 'text-bg-secondary')
const attemptOf = (j) => attempt(j)
const failuresStore = useFailuresStore()
const failureOf = (j) => (failuresStore.items || []).find((f) => f.job_id && f.job_id === j.job_id) || null
const files = jobFiles
/** The review versions a finished review job wrote (shot and version per sequence), once each: where Mark approved sits. */
const reviewVersions = (j) => { const seen = new Set(), out = []; for (const s of j.sequences || []) { const shot = s.shot || j.shot, version = s.version ?? j.version; if (!shot || !version || seen.has(`${shot}/${version}`)) continue; seen.add(`${shot}/${version}`); out.push({ shot, version }) } return out }
const skippedCount = (j) => (j.sequences || []).filter((s) => s.state === 'skipped').length
/** 'sequence 2 of 3 · frame 140 of 412 · 9 fps · about 4 min left' */
function numbers(j) {
  const parts = [t('outputs.render.progress', { i: currentSequence(j), n: (j.sequences || []).length, done: j.frames_done || 0, total: j.frames_total || 0 })]
  if (j.rate_fps) parts.push(t('outputs.render.progressRate', { fps: Math.round(j.rate_fps) }))
  const eta = etaText(etaSeconds(j)); if (eta) parts.push(eta)
  return parts.join(' · ')
}
/** Play needs a finished job with a sequence that was rendered; it opens that pod's Outputs window and the viewer on the first one. */
const doneOk = (j) => j.state === 'done' && !!j.pod_id && (j.sequences || []).some((s) => ['rendered', 'pulled', 'done'].includes(s.state))
function firstSeq(j) { return (j.sequences || []).find((s) => ['rendered', 'pulled', 'done'].includes(s.state)) || (j.sequences || [])[0] }
function play(j) { const s = firstSeq(j); ui.queueOpen = false; ui.outputsFor = { pod_id: j.pod_id, play: { dir: s.dir, name: s.name, review: j.kind === 'review' } } }
function openOutputs(j) { ui.queueOpen = false; ui.outputsFor = { pod_id: j.pod_id } }
// the review versions' approvals, asked once for the window and again when a job ends
const apStore = useAutopublishStore()
/** What Auto-publish did with the reviews this Auto-generate job made: waiting for its window, uploading, uploaded, cancelled, failed (or not queued): the Publishing to S3 step of an automatic job. */
const AUTO_RANK = ['uploading', 'waiting', 'would_upload', 'capped', 'failed', 'cancelled', 'done', 'none']
function autoPublishOf(j) {
  if (j.trigger !== 'auto-publish' || j.kind !== 'review' || j.state !== 'done') return ''
  const entries = [...(apStore.pending || []), ...(apStore.recent || [])], states = []
  for (const rv of reviewVersions(j)) {
    const e = entries.find((x) => x.shot === rv.shot && versionTag(x.version) === versionTag(rv.version))
    const done = (apStore.status?.watching?.skipped || []).some((x) => x.shot === rv.shot && versionTag(x.version) === versionTag(rv.version) && /already published/i.test(x.reason || ''))
    states.push(e ? e.state : done ? 'done' : 'none')
  }
  return states.length ? AUTO_RANK.find((r) => states.includes(r)) || 'none' : ''
}
const autoPubClass = (st) => (st === 'done' ? 'text-bg-success' : st === 'failed' ? 'text-bg-danger' : st === 'uploading' ? 'text-bg-primary' : st === 'waiting' || st === 'would_upload' ? 'text-bg-warning' : 'text-bg-secondary')
watch(() => [ui.queueOpen, renders.finished], () => { if (ui.queueOpen) apStore.loadReviews() }, { immediate: true })
// While the Queue is open the jobs are followed every second
watch(() => ui.queueOpen, (v) => renders.setFast(v), { immediate: true })
onBeforeUnmount(() => renders.setFast(false))
</script>
