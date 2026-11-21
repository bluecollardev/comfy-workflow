<template>
  <div data-testid="queue-overview">
    <div v-if="!failures.old && failures.count" class="alert alert-danger py-1 px-2 small d-flex align-items-center gap-2" data-testid="queue-overview-failures"><span>{{ $t('queue.fail.overview', { n: failures.count }) }}</span><BButton variant="link" size="sm" class="p-0 ms-auto" data-testid="queue-overview-failures-open" @click="$emit('go', 'generations')">{{ $t('queue.col.open') }}</BButton></div>
    <div v-if="!rows.length" class="text-body-secondary small" data-testid="queue-empty">{{ $t('queue.empty') }}</div>
    <template v-else>
      <h6 class="mb-2" data-testid="queue-working-title">{{ $t('queue.working', { n: top.length }) }}</h6>
      <div class="table-responsive">
        <table class="table table-sm align-middle mb-3" data-testid="queue-working">
          <thead><tr><th style="width: 2.5rem"></th><th>{{ $t('queue.col.started') }}</th><th>{{ $t('queue.col.id') }}</th><th>{{ $t('queue.col.kind') }}</th><th>{{ $t('queue.col.trigger') }}</th><th>{{ $t('queue.col.state') }}</th><th>{{ $t('queue.col.progress') }}</th><th>{{ $t('queue.col.step') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.key" :class="{ 'text-body-secondary': r.sub }" data-testid="queue-working-row" :data-kind="r.kind" :data-tab="r.tab" :data-state="r.state">
              <td><BButton v-if="r.kind === 'render'" size="sm" variant="outline-light" class="px-2" disabled :title="$t('queue.gen.playNone')" :aria-label="$t('queue.gen.play')" data-testid="queue-working-play"><i class="fa-solid fa-play"></i></BButton></td>
              <td class="small text-nowrap" :title="r.ago">{{ r.started }}</td>
              <td class="font-monospace small" :class="{ 'ps-4': r.sub }" :title="r.id">{{ r.id }}</td>
              <td class="small">{{ r.label }}</td>
              <td class="small text-nowrap"><span class="badge fw-normal" :class="r.trigKey === 'mcp' ? 'text-bg-info' : 'text-bg-secondary'" :title="r.trigTitle" data-testid="queue-working-trigger" :data-trigger="r.trigKey">{{ r.trigger }}</span><span v-if="r.external" class="badge text-bg-warning fw-normal ms-1" :title="EXTERNAL_TIP" data-testid="queue-working-external">{{ $t('queue.external') }}</span></td>
              <td><span class="badge" :class="r.chip" data-testid="queue-working-state">{{ r.stateText }}</span></td>
              <td class="small" style="min-width: 11rem">{{ r.progress }}<BProgress v-if="r.percent != null" :value="r.percent" :max="100" height="3px" class="mt-1" :data-percent="r.percent" data-testid="queue-working-bar" /></td>
              <td class="small text-body-secondary text-truncate" style="max-width: 16rem" :title="r.step">{{ r.step }}</td>
              <td class="text-end text-nowrap"><BButton v-if="r.tab" size="sm" variant="link" class="p-0 me-2" data-testid="queue-working-open" @click="$emit('go', r.tab)">{{ $t('queue.col.open') }}</BButton>
                <BButton v-if="r.cancel" size="sm" variant="outline-warning" data-testid="queue-working-cancel" @click="r.cancel()">{{ $t('queue.cancel') }}</BButton></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup>
/**
 * QueueOverview: everything that is working, across every tab, in one table with the Finished tables' columns (started, id, kind, trigger, state, progress, current step, actions): syncs, imports' tasks, renders and previews,
 * publishes (a parent with its children indented), Auto-publish entries and what it is generating. Running first, then by start time. A job that finishes leaves the table and shows in its tab's finished list.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useSyncsStore } from '../stores/syncs'
import { useRendersStore } from '../stores/renders'
import { useRunJobsStore } from '../stores/runjobs'
import { usePreviewJobsStore } from '../stores/previewjobs'
import { rowKind, counterLine, percentOf as pjPercent } from '../utils/previewjobs'
import { useConfirmStore } from '../stores/confirm'
import { podLabel, genLine, framesText, percentOf, rateText, etaText } from '../utils/runjobs'
import { usePreviewsStore } from '../stores/previews'
import { usePublishStore } from '../stores/publish'
import { useAutopublishStore } from '../stores/autopublish'
import { useVolumeJobsStore } from '../stores/volumejobs'
import { useFailuresStore } from '../stores/failures'
import { publishActive } from '../utils/publish'
import { isActive } from '../utils/renders'
import { whenText, agoShort } from '../utils/when'
import { triggerInfo, EXTERNAL_TIP } from '../utils/trigger'
import { countdownText, secondsUntil } from '../utils/autopublish'
import { formatBytes } from '../sync-progress'
import { t } from '../i18n'

defineEmits(['go'])
const failures = useFailuresStore(), syncs = useSyncsStore(), renders = useRendersStore(), runjobs = useRunJobsStore(), pjobs = usePreviewJobsStore(), confirm = useConfirmStore(), previews = usePreviewsStore(), pub = usePublishStore(), ap = useAutopublishStore(), vjobs = useVolumeJobsStore()
const now = ref(Date.now())
const tick = setInterval(() => { now.value = Date.now() }, 1000)
onBeforeUnmount(() => clearInterval(tick))
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((100 * (a || 0)) / b)) : null)
const rate = (r) => (r ? ` · ${formatBytes(r)}/s` : '')
const trig = (x) => { const i = triggerInfo(typeof x === 'object' ? x : { trigger: x }); return i.key === 'auto' ? t('queue.trigger.auto') : i.key === 'manual' ? t('queue.trigger.manual') : i.label }
const tmeta = (j) => { const i = triggerInfo(j); return { trigKey: i.key, trigTitle: i.title, external: i.external } }
const base = (o) => ({ started: whenText(o.at, new Date(now.value)), ago: agoShort(o.at, now.value), sort: new Date(o.at || 0).getTime() || 0, ...o })
const rows = computed(() => {
  const out = []
  for (const s of syncs.active || []) out.push(base({ key: `s-${s.run_id}`, tab: 'syncs', kind: 'sync', id: s.run_id, label: t(s.direction === 'pull' ? 'queue.kind.pull' : 'queue.kind.push'), trigger: trig(s), ...tmeta(s), state: s.state || 'running', stateText: s.state || 'running', chip: 'text-bg-primary', at: s.started_at, progress: s.files_total ? `${s.files_done || 0} of ${s.files_total} files${s.bytes_total ? ` · ${formatBytes(s.bytes_done || 0)} of ${formatBytes(s.bytes_total)}` : ''}${rate(s.rate_bps)}` : '', percent: pct(s.bytes_done ?? s.files_done, s.bytes_total ?? s.files_total), step: s.current_files?.[0]?.path || '', running: true }))
  // the render runs (graph generations) of the app and of other processes: element, pod, chunk and frames, ComfyUI's step
  for (const j of runjobs.jobs || []) if (j.state === 'running') out.push(base({ key: `g-${j.job_id}`, tab: 'generations', kind: 'generation', id: j.job_id, label: `${t('queue.kind.generation')}: ${j.element}`, trigger: j.external ? (j.client || t('queue.run.external')) : trig('manual'), trigKey: j.external ? 'mcp' : 'manual', trigTitle: j.external ? t('queue.run.externalTip') : '', external: !!j.external, state: 'running', stateText: 'running', chip: 'text-bg-primary', running: true, at: j.started_at, progress: [framesText(j), genLine(j)].filter(Boolean).join(' · '), percent: percentOf(j), step: [podLabel(j), rateText(j), etaText(j)].filter(Boolean).join(' · '), cancel: async () => { if (await confirm.ask(t('queue.run.confirmCancel', { element: j.element, pod: podLabel(j) }), { okLabel: t('queue.cancel') })) await runjobs.cancel(j) } }))
  // the frame-previews jobs (frames, thumbnails, posters, automatic previews), the app's and another process's
  for (const j of pjobs.jobs || []) if (j.state === 'running') out.push(base({ key: `pj-${j.job_id}`, tab: 'generations', kind: 'previewjob', id: j.job_id, label: t(`queue.pjob.kind.${rowKind(j)}`), trigger: j.external ? (j.client || t('queue.run.external')) : trig('manual'), trigKey: j.external ? 'mcp' : 'manual', trigTitle: j.external ? t('queue.run.externalTip') : '', external: !!j.external, state: 'running', stateText: 'running', chip: 'text-bg-primary', running: true, at: j.started_at, progress: counterLine(j, (id) => t(`queue.pjob.count.${id}`)), percent: pjPercent(j), step: j.current || '', cancel: () => pjobs.cancel(j) }))
  for (const j of renders.jobs || []) if (isActive(j)) out.push(base({ key: `r-${j.job_id}`, tab: 'generations', kind: 'render', id: j.job_id, label: t(j.kind === 'review' ? 'queue.kind.review' : 'queue.kind.proxy'), trigger: trig(j), ...tmeta(j), state: j.state, stateText: j.state, chip: j.state === 'queued' ? 'text-bg-secondary' : 'text-bg-primary', at: j.started_at, progress: j.frames_total ? t('queue.progress.frames', { done: j.frames_done || 0, total: j.frames_total, pct: pct(j.frames_done, j.frames_total) }) : '', percent: pct(j.frames_done, j.frames_total), step: j.current || j.summary || '', running: j.state !== 'queued', cancel: () => renders.cancel(j.job_id) }))
  if (previews.running && previews.batch) out.push(base({ key: 'pv', tab: 'generations', kind: 'previews', id: previews.batch.id || 'previews', label: t('queue.kind.previews'), trigger: trig('manual'), state: 'running', stateText: 'running', chip: 'text-bg-primary', at: previews.batch.started_at, progress: t('queue.progress.items', { done: previews.batch.done, total: previews.batch.total }), percent: pct(previews.batch.done, previews.batch.total), step: previews.batch.label || '', running: true, cancel: () => previews.stop() }))
  for (const j of pub.jobs || []) {
    if (!publishActive(j) || j.parent_id || j.kind === 'scan') continue
    out.push(base({ key: `p-${j.job_id}`, tab: 'publishing', kind: 'publish', id: j.job_id, label: t(j.kind === 'backfill' || j.phase ? 'queue.kind.backfill' : 'queue.kind.publish'), trigger: trig(j), ...tmeta(j), state: j.state, stateText: j.state, chip: j.state === 'queued' ? 'text-bg-secondary' : 'text-bg-primary', at: j.started_at, progress: j.bytes_total ? `${formatBytes(j.bytes_done || 0)} of ${formatBytes(j.bytes_total)}${rate(j.rate_bps)}` : '', percent: pct(j.bytes_done, j.bytes_total), step: j.current || '', running: true, cancel: () => pub.cancel(j.job_id) }))
    for (const c of j.children || []) if (['queued', 'uploading'].includes(c.state)) out.push(base({ key: `c-${c.id}`, sub: true, tab: '', kind: 'publish-child', id: c.id, label: `${c.shot || ''}`, trigger: '', state: c.state, stateText: c.state, chip: 'text-bg-secondary', at: j.started_at, progress: c.bytes ? `${c.files ?? 0} files · ${formatBytes(c.bytes)}${rate(c.rate)}` : '', percent: null, step: c.clip || '', running: c.state === 'uploading', sortParent: `p-${j.job_id}` }))
  }
  for (const e of ap.pending || []) if (['waiting', 'uploading', 'would_upload', 'capped'].includes(e.state)) out.push(base({ key: `a-${e.id}`, tab: 'publishing', kind: 'autopublish', id: e.id, label: t('queue.kind.autopublish'), trigger: trig('auto-publish'), state: e.state, stateText: e.state === 'waiting' ? `${t('queue.state_waiting')} ${countdownText(secondsUntil(e.due_at, now.value))}` : e.state === 'would_upload' ? t('autopublish.pane.wouldUpload') : e.state, chip: e.state === 'uploading' ? 'text-bg-primary' : 'text-bg-secondary', at: e.created_at || e.started_at || '', progress: `${e.shot || ''} v${String(e.version ?? '').padStart(3, '0')} · ${e.files ?? 0} files`, percent: null, step: e.state === 'waiting' ? t('queue.step.window') : t('queue.step.uploading'), running: e.state === 'uploading', cancel: () => ap.cancel(e.id) }))
  const g = ap.status?.generate
  if (g?.enabled) { const n = Array.isArray(g.generating) ? g.generating.length : Number(g.generating) || 0; const w = Array.isArray(g.waiting_to_settle) ? g.waiting_to_settle.length : 0
    if (n > 0) out.push(base({ key: 'ag-run', tab: 'publishing', kind: 'autogenerate', id: 'auto-generate', label: t('queue.kind.autogenerate'), trigger: trig('auto-publish'), state: 'running', stateText: 'running', chip: 'text-bg-primary', at: g.enabled_at, progress: t('queue.progress.reviews', { n }), percent: null, step: g.current || '', running: true }))
    if (w > 0) out.push(base({ key: 'ag-wait', tab: 'publishing', kind: 'autogenerate', id: 'auto-generate', label: t('queue.kind.autogenerate'), trigger: trig('auto-publish'), state: 'waiting', stateText: t('queue.state_waiting'), chip: 'text-bg-secondary', at: g.enabled_at, progress: t('queue.progress.settling', { n: w }), percent: null, step: '', running: false })) }
  for (const j of vjobs.jobs || []) if (!['done', 'failed', 'cancelled'].includes(j.state)) out.push(base({ key: `v-${j.id}`, tab: 'imports', kind: 'volume-job', id: j.id, label: j.kind, trigger: trig('manual'), state: j.state, stateText: j.state, chip: 'text-bg-primary', at: j.started_at, progress: '', percent: null, step: '', running: true }))
  // running first, then the newest start; a publish's children stay under their parent
  const parents = out.filter((r) => !r.sub).sort((a, b) => (b.running ? 1 : 0) - (a.running ? 1 : 0) || b.sort - a.sort)
  return parents.flatMap((p) => [p, ...out.filter((c) => c.sub && c.sortParent === p.key)])
})
const top = computed(() => rows.value.filter((r) => !r.sub))
</script>
