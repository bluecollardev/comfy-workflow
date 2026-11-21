<template>
  <div v-if="!ap.old && ap.status" ref="root" class="mb-4" data-testid="queue-autopublish">
    <h6 class="mb-2 d-flex align-items-center gap-2">{{ $t('autopublish.pane.title') }}
      <span v-if="ap.enabled && ap.status.targets" class="small text-body-secondary fw-normal" data-testid="autopublish-pane-targets">{{ targetsText(ap.status.targets) }}</span>
      <span v-if="ap.enabled" class="badge fw-normal" :class="ap.status.dry_run ? 'text-bg-warning' : 'text-bg-success'" data-testid="autopublish-pane-mode">{{ $t(ap.status.dry_run ? 'autopublish.pane.dry' : 'autopublish.pane.live') }}</span>
      <span v-if="ap.enabled" class="small text-body-secondary fw-normal" data-testid="autopublish-pane-today">{{ todayText(ap.status, t) }}<template v-if="ap.status.daily_cap == null"> · {{ $t('autopublish.block.noLimit') }}</template></span></h6>
    <div v-if="ap.status.generate?.enabled" class="border rounded p-2 mb-2" data-testid="queue-autopublish-generate"><AutoPublishGenerate :status="ap.status" /></div>
    <div v-if="!ap.pending.length && !ap.recent.length && ap.status.watching" class="border rounded p-2" data-testid="queue-autopublish-watching"><AutoPublishWatching :status="ap.status" /></div>
    <div v-else-if="!ap.pending.length && !ap.recent.length" class="text-body-secondary small" data-testid="autopublish-none">{{ $t('autopublish.pane.none') }}</div>
    <AutoPublishLists />
    <AutoPublishDryRun />
    <div v-if="ap.pending.length || dismissed" class="d-flex align-items-center gap-2 small mt-2 mb-1" data-testid="autopublish-pending-head" :data-open="pendingOpen ? 'true' : 'false'" :data-count="ap.pending.length"><span class="fw-semibold" data-testid="autopublish-pending-title">{{ $t('autopublish.lists.pending', { n: ap.pending.length }) }}</span><span class="ms-auto d-flex align-items-center gap-2"><BButton v-if="dryCount" size="sm" variant="outline-warning" :disabled="purging" :title="$t('autopublish.pane.purgeTip')" data-testid="autopublish-purge" @click="purge">{{ $t('autopublish.pane.purge') }}</BButton><BButton v-if="dismissed" size="sm" variant="outline-light" :title="$t('autopublish.pane.restoreTip')" data-testid="autopublish-restore" @click="restore">{{ $t('autopublish.pane.restore', { n: dismissed }) }}</BButton><BButton variant="link" size="sm" class="p-0" :aria-expanded="pendingOpen ? 'true' : 'false'" data-testid="autopublish-pending-toggle" @click="pendingOpen = !pendingOpen">{{ pendingOpen ? $t('autopublish.list.collapse') : $t('autopublish.list.expand') }}</BButton></span></div>
    <div v-if="actionError.purge" class="small text-danger mb-1" data-testid="autopublish-purge-error">{{ actionError.purge }}</div>
    <div v-for="e in ap.pending" :key="e.id" class="border rounded p-2 mb-2 small d-flex align-items-center gap-2 flex-wrap" :class="{ 'text-body-secondary': e.state === 'would_upload', 'd-none': !pendingOpen }" data-testid="autopublish-row" :data-id="e.id" :data-state="e.state">
      <strong data-testid="autopublish-row-line">{{ entryLine(e, formatBytes) }}</strong>
      <span class="badge text-bg-secondary fw-normal" title="auto-publish" data-testid="autopublish-row-trigger">{{ $t('queue.trigger.auto') }}</span>
      <span v-if="e.source" class="badge text-bg-info fw-normal" data-testid="autopublish-source-badge" :data-source="e.source">{{ $t(e.source === 'volume' ? 'autopublish.sources.badgeVolume' : 'autopublish.sources.badgeLocal') }}</span>
      <span v-if="e.targets" class="badge text-bg-secondary fw-normal" data-testid="autopublish-row-targets">{{ targetsText(e.targets) }}</span>
      <span data-testid="autopublish-row-state">
        <template v-if="e.state === 'waiting'">{{ $t('autopublish.pane.uploadsIn', { t: countdown(e) }) }}</template>
        <template v-else-if="e.state === 'uploading'"><BSpinner small class="me-2 flex-shrink-0" />{{ $t('autopublish.pane.uploading') }}</template>
        <template v-else-if="e.state === 'would_upload'"></template>
        <template v-else-if="e.state === 'capped'">{{ $t('autopublish.pane.capped') }}</template>
        <template v-else-if="e.state === 'failed'"><span class="text-danger">{{ $t('autopublish.pane.failed', { reason: e.reason || '' }) }}</span></template>
        <template v-else>{{ e.state }}</template>
      </span>
      <span class="ms-auto d-flex align-items-center gap-2" data-testid="autopublish-row-actions">
        <AutoPublishOutputsLink :row="e" />
        <BButton v-if="e.dry_run_plan" variant="link" size="sm" class="p-0 text-nowrap" :aria-expanded="dryOpen.has(e.id)" data-testid="autopublish-dry-toggle" @click="toggleDry(e.id)">{{ dryOpen.has(e.id) ? '▾' : '▸' }} {{ $t('autopublish.dry.s3') }}</BButton>

        <BButton v-if="e.state === 'would_upload'" size="sm" variant="outline-primary" :disabled="!!realBlocked(e)" :title="realBlocked(e) || $t('autopublish.pane.publishRealTip')" data-testid="autopublish-deliver" @click="deliver(e)">{{ $t('autopublish.pane.publishReal') }}</BButton>
        <BButton v-if="['waiting', 'capped', 'would_upload'].includes(e.state)" size="sm" variant="outline-warning" data-testid="autopublish-cancel" @click="cancel(e)">{{ $t(e.state === 'would_upload' ? 'autopublish.pane.remove' : 'autopublish.pane.cancel') }}</BButton>

 <BButton v-if="ap.hasHolds && ['waiting', 'capped'].includes(e.state)" size="sm" variant="outline-light" data-testid="autopublish-hold" @click="hold(e)">{{ $t('autopublish.pane.hold') }}</BButton>

        <BButton v-if="['uploading', 'posting'].includes(e.state)" size="sm" variant="outline-light" disabled data-testid="autopublish-publishing">{{ $t('autopublish.pane.publishing') }}</BButton>
        <BButton v-else-if="['waiting', 'capped', 'failed'].includes(e.state)" size="sm" variant="outline-light" :disabled="publishing" :title="publishing ? $t('autopublish.pane.publishBusy') : undefined" data-testid="autopublish-publish-now" @click="publishNow(e)">{{ $t('autopublish.pane.publishNow') }}</BButton>
      </span>
      <div v-if="e.dry_run_plan && dryOpen.has(e.id)" class="w-100 ms-3 text-body-secondary" data-testid="autopublish-dry-plan">
        <div class="font-monospace" data-testid="autopublish-dry-dest">s3://{{ e.dry_run_plan.bucket }}/{{ String(e.dry_run_plan.prefix || '').replace(/^\/+/, '').replace(/\/?$/, '/') }}{{ e.dry_run_plan.round ? `${e.dry_run_plan.round}/` : '' }}</div>
        <div v-for="f in e.dry_run_plan.files || []" :key="f.key" class="d-flex align-items-center gap-2" data-testid="autopublish-dry-file" :data-key="f.key"><span class="badge fw-normal" :class="f.action === 'skip' ? 'text-bg-secondary' : 'text-bg-primary'" data-testid="autopublish-dry-action">{{ f.action }}</span><span class="font-monospace text-truncate" :title="f.key">{{ f.key }}</span><span class="ms-auto">{{ formatBytes(f.bytes || 0) }}</span></div>
        <div v-if="e.dry_run_plan.manifest_key" class="font-monospace" data-testid="autopublish-dry-manifest">{{ $t('autopublish.dry.manifest') }}: {{ e.dry_run_plan.manifest_key }}</div>
        <div data-testid="autopublish-dry-totals">{{ $t('autopublish.dry.totals', { files: e.dry_run_plan.total_files ?? (e.dry_run_plan.files || []).length, size: formatBytes(e.dry_run_plan.total_bytes || 0) }) }}</div>
        <div v-if="e.dry_run_plan.access" :class="e.dry_run_plan.access.ok ? 'text-success' : 'text-danger'" data-testid="autopublish-dry-access" :data-ok="e.dry_run_plan.access.ok ? 'true' : 'false'">{{ e.dry_run_plan.access.ok ? $t('autopublish.dry.accessOk', { what: e.dry_run_plan.access.detail || e.dry_run_plan.prefix }) : e.dry_run_plan.access.detail }} <span class="text-body-secondary">· {{ $t('autopublish.dry.noWriteProof') }}</span></div>
      </div>
      <div v-if="actionError[e.id]" class="w-100 text-danger" data-testid="autopublish-row-error">{{ actionError[e.id] }}</div>
    </div>
    <details v-if="ap.holds.length" class="small mt-2" data-testid="autopublish-held"><summary>{{ $t('autopublish.pane.held', { n: ap.holds.length }) }}</summary>
      <div v-for="h in ap.holds" :key="`${h.shot}-${h.version}`" class="d-flex align-items-center gap-2 py-1" data-testid="autopublish-held-row" :data-shot="h.shot" :data-version="h.version"><span>{{ h.shot }} {{ versionTag(h.version) }}</span>
        <AutoPublishOutputsLink :row="h" />
        <BButton size="sm" variant="outline-light" class="py-0" data-testid="autopublish-release" @click="release(h)">{{ $t('autopublish.pane.release') }}</BButton></div></details>
    <template v-if="ap.recent.length">
      <div class="d-flex align-items-center gap-2 small mt-2 mb-1" data-testid="autopublish-recent-head" :data-open="recentOpen ? 'true' : 'false'" :data-count="ap.recent.length"><span class="fw-semibold" data-testid="autopublish-recent-title">{{ $t('autopublish.lists.recent', { n: ap.recent.length }) }}</span><BButton variant="link" size="sm" class="p-0 ms-auto" :aria-expanded="recentOpen ? 'true' : 'false'" data-testid="autopublish-recent-toggle" @click="recentOpen = !recentOpen">{{ recentOpen ? $t('autopublish.list.collapse') : $t('autopublish.list.expand') }}</BButton></div>
      <div v-for="e in ap.recent" :key="e.id" class="small d-flex align-items-center gap-2 flex-wrap mb-1" :class="[e.state === 'failed' ? 'text-danger' : 'text-body-secondary', { 'd-none': !recentOpen }]" data-testid="autopublish-recent" :data-id="e.id" :data-state="e.state">
        <span>{{ entryLine(e, formatBytes) }}</span>
        <AutoPublishOutputsLink :row="e" />
        <span data-testid="autopublish-recent-state">{{ e.state === 'done' ? $t('autopublish.pane.done', { when: when(e) }) : e.state === 'failed' ? $t('autopublish.pane.failed', { reason: e.reason || '' }) : e.state === 'cancelled' ? $t('autopublish.pane.cancelled') : e.state === 'would_upload' ? $t('autopublish.pane.wouldUpload') : e.state }}</span>
      </div>
    </template>
  </div>
</template>

<script setup>
/** AutoPublishPane: the Queue's Auto-publish section: what waits (with its live countdown), what would upload in a dry run, what is capped or failed, and what was sent; Cancel and Publish now (which asks for a name). */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useAutopublishStore } from '../stores/autopublish'
import { useNamePromptStore } from '../stores/nameprompt'
import { useConfirmStore } from '../stores/confirm'
import { useUiStore } from '../stores/ui'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { formatBytes } from '../sync-progress'
import AutoPublishWatching from './AutoPublishWatching.vue'
import AutoPublishGenerate from './AutoPublishGenerate.vue'
import AutoPublishDryRun from './AutoPublishDryRun.vue'
import AutoPublishOutputsLink from './AutoPublishOutputsLink.vue'
import AutoPublishLists from './AutoPublishLists.vue'
import { entryLine, secondsUntil, countdownText, targetsText, todayText, versionTag } from '../utils/autopublish'

const ap = useAutopublishStore(), prompt = useNamePromptStore(), ui = useUiStore(), confirm = useConfirmStore()
// One upload at a time: while any entry is uploading or posting, Publish now is off everywhere and the running row says Publishing…
const publishing = computed(() => ap.pending.some((x) => ['uploading', 'posting'].includes(x.state)))
const now = ref(Date.now()), actionError = ref({}), root = ref(null)
const tick = setInterval(() => { now.value = Date.now() }, 1000)   // the countdown moves each second
onBeforeUnmount(() => { clearInterval(tick); ap.setFast(false) })
watch(() => ui.queueOpen, (v) => ap.setFast(v), { immediate: true })
// the header chip opens the Queue on this section
watch(() => [ui.queueOpen, ui.queueFocus], async ([o, f]) => { if (o && f === 'autopublish') { await nextTick(); setTimeout(() => root.value?.scrollIntoView({ block: 'start' }), 150); ui.queueFocus = '' } }, { immediate: true })
const pendingOpen = ref(true), recentOpen = ref(false)   // Pending Uploads start open and Recent collapsed (what was sent today is in Uploaded Today)
const dryOpen = ref(new Set())
const toggleDry = (id) => { const n = new Set(dryOpen.value); if (n.has(id)) n.delete(id); else n.add(id); dryOpen.value = n }
const countdown = (e) => countdownText(secondsUntil(e.due_at, now.value))
const when = (e) => { const d = new Date(e.done_at || e.finished_at || e.at || e.due_at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString() }
async function hold(e) { actionError.value = { ...actionError.value, [e.id]: '' }; try { await ap.hold(e.shot, e.version) } catch (x) { actionError.value = { ...actionError.value, [e.id]: errorText(x) } } }
async function release(h) { try { await ap.release(h.shot, h.version) } catch (x) { void x } }
async function cancel(e) { actionError.value = { ...actionError.value, [e.id]: '' }; try { await ap.cancel(e.id) } catch (x) { actionError.value = { ...actionError.value, [e.id]: errorText(x) } } }
const dryCount = computed(() => ap.pending.filter((e) => e.state === 'would_upload').length)
const dismissed = computed(() => ap.status?.watching?.dismissed || 0)
const purging = ref(false)
/** Purge Dry Runs: the core's plan says how many go and how many a person approved one by one stay; one confirmation, then the run. Nothing is deleted from disk or the bucket. */
async function purge() {
  purging.value = true
  try {
    const plan = await ap.purgeDryRuns({})
    if (!plan?.would_purge) { actionError.value = { ...actionError.value, purge: t('autopublish.pane.purgeNone') }; return }
    const message = t('autopublish.pane.purgeMessage', { n: plan.would_purge }) + (plan.kept_approved?.length ? t('autopublish.pane.purgeKept', { kept: plan.kept_approved.length }) : '')
    if (!(await confirm.ask(message, { title: t('autopublish.pane.purgeTitle'), okLabel: t('autopublish.pane.purge'), danger: false }))) return
    await ap.purgeDryRuns({ approved_by: ap.status?.standing?.approved_by || 'the window', understood: true })
  } catch (x) { actionError.value = { ...actionError.value, purge: errorText(x) } } finally { purging.value = false }
}
async function restore() { try { await ap.restoreDryRuns() } catch (x) { actionError.value = { ...actionError.value, purge: errorText(x) } } }
const sameVersion = (a, b) => String(a).replace(/\D/g, '') === String(b).replace(/\D/g, '')
/** Why a dry-run row's Deliver is off ('' when it can go): a hold, the daily cap, a destination that is not ready, or the same shot and version already going. */
function realBlocked(e) {
  const st = ap.status || {}
  if (e.reason && /held|not in the EDL|dpx fix/i.test(e.reason)) return e.reason
  if (publishing.value) return t('autopublish.pane.publishBusy')
  if (st.today && st.today.left === 0) return t('autopublish.pane.realCapSpent', { cap: st.daily_cap })
  const s3 = ap.settings?.target_state?.s3
  if (ap.settings && (ap.settings.ready === false || s3?.ready === false)) return t('autopublish.pane.realNotReady', { why: s3?.problem || '' })
  if (ap.pending.some((x) => x.id !== e.id && x.shot === e.shot && sameVersion(x.version, e.version) && ['uploading', 'posting'].includes(x.state))) return t('autopublish.pane.realAlready')
  if ((st.watching?.uploaded || []).some((u) => u.shot === e.shot && sameVersion(u.version, e.version))) return t('autopublish.pane.realAlready')
  return ''
}
async function deliver(e) {
  const st = ap.status || {}, p = e.dry_run_plan || {}
  const message = t('autopublish.pane.publishRealMessage', { shot: e.shot, version: versionTag(e.version), files: e.files ?? 0, size: formatBytes(e.bytes || 0), round: p.round || ap.settings?.round || '', targets: targetsText(e.targets || st.targets || {}), left: st.today?.left ?? t('autopublish.pane.capNone') })
  await prompt.ask({ title: t('autopublish.pane.publishRealTitle'), message, okLabel: t('autopublish.pane.publishReal'), name: st.standing?.approved_by || '', submit: async ({ name }) => { try { await ap.publishNow(e.id, name); return '' } catch (x) { return errorText(x) } } })
}
async function publishNow(e) {
  await prompt.ask({ title: t('autopublish.pane.publishNowTitle'), message: `${t('autopublish.pane.publishNowMessage')} ${entryLine(e, formatBytes)}`, okLabel: t('autopublish.pane.publishNow'), submit: async ({ name }) => { try { await ap.publishNow(e.id, name); return '' } catch (x) { return errorText(x) } } })
}
</script>
