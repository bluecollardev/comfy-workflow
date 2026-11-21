<template>
    <div :class="embedded ? 'mt-1' : 'border rounded p-2 mt-3'" data-testid="publish-job" :data-state="job.state" :data-job="job.job_id">
      <div v-if="when.started" class="small text-body-secondary" data-testid="publish-job-when" :title="when.ago"><span data-testid="publish-job-started">{{ when.started }}</span><template v-if="when.finished"> · <span data-testid="publish-job-finished">{{ when.finished }}</span></template></div>
      <div class="fw-semibold small" data-testid="publish-job-state">{{ $t(`publish.modal.state.${job.state}`) }}</div>
      <BProgress :value="percent" :max="100" :animated="active" :striped="active" height="0.6rem" class="mb-2" :data-percent="percent" data-testid="publish-progress" />
      <!-- the progress text on the left, Cancel (All) on the right of it, on the same row -->
      <div class="d-flex align-items-start gap-3" data-testid="publish-job-progress-row">
        <div class="flex-grow-1" style="min-width: 0">
          <div class="small mt-1" data-testid="publish-job-numbers">{{ $t('publish.modal.progress', { done: job.files_done || 0, total: job.files_total || 0, bytes: formatBytes(job.bytes_done || 0), totalBytes: formatBytes(job.bytes_total || 0) }) }}<template v-if="job.rate_bps"> · {{ $t('publish.modal.rate', { rate: formatBytes(job.rate_bps) }) }}</template></div>
          <div v-if="via" class="small text-body-secondary" data-testid="publish-job-via" :data-adapter="job.adapter">{{ via }}</div>
          <div v-if="job.current && active" class="small font-monospace text-body-secondary" data-testid="publish-job-current">{{ job.current }}</div>
        </div>
        <BButton v-if="active" size="sm" variant="outline-warning" class="flex-shrink-0 ms-auto" data-testid="publish-cancel" @click="store.cancel(job.job_id)"><i class="fa-solid fa-stop me-1"></i>{{ $t(children.length ? 'publish.ret.cancelAll' : 'publish.modal.cancel') }}</BButton>
      </div>
      <div v-if="failedKids.length && !active && !failed.length" class="mt-1" data-testid="publish-retry-shots"><BButton size="sm" variant="outline-warning"  data-testid="publish-retry-all" :disabled="retryingShots || !canRetry" :title="canRetry ? '' : $t('publish.ret.cannotRetry')" @click="retryShots"><BSpinner v-if="retryingShots" small class="me-1" /><i v-else class="fa-solid fa-rotate me-1"></i>{{ $t('publish.ret.retryShots', { n: failedKids.length }) }}</BButton><span v-if="retryErr" class="text-danger small ms-2" data-testid="publish-retry-error"><ErrorText :text="retryErr" /></span></div>
      <div v-if="job.phase"class="small text-info" data-testid="publish-job-phase" :data-phase="job.phase">{{ $t(`publish.backfill.phase.${job.phase}`) }}</div>
      <div v-if="job.uploaded != null || failed.length" class="small" data-testid="publish-job-result">{{ $t('publish.backfill.result', { uploaded: job.uploaded ?? job.files_done ?? 0, there: job.skipped ?? 0, failed: failed.length }) }}</div>
      <div v-for="f in failed" :key="f.path" class="small text-danger" data-testid="publish-job-failed" :data-path="f.path"><span class="font-monospace">{{ f.path }}</span>: <ErrorText :text="String(f.error || '')" /></div>
      <BButton v-if="failed.length && !active" size="sm" variant="outline-warning" class="mt-1" data-testid="publish-retry-failed" :disabled="retryingShots || !canRetry" :title="canRetry ? '' : $t('publish.ret.cannotRetry')" @click="retryFailed"><BSpinner v-if="retryingShots" small class="me-1" /><i v-else class="fa-solid fa-rotate me-1"></i>{{ $t('publish.backfill.retry') }}</BButton>
      <div v-if="retryErr && failed.length" class="small text-danger" data-testid="publish-retry-error-files"><ErrorText :text="retryErr" /></div>
      <!-- a publish of several shots is a parent job: one row per shot, each with its own state, Retry (failed only) and Cancel -->
      <div v-if="children.length" class="mt-2" data-testid="publish-children" :data-open="childrenOpen ? 'true' : 'false'">
        <BButton variant="link" size="sm" class="p-0" data-testid="publish-children-toggle" :aria-expanded="childrenOpen" @click="childrenOpen = !childrenOpen">{{ childrenOpen ? '▾' : '▸' }} {{ $t('publish.ret.children', { n: children.length }) }}</BButton>
        <div v-if="childrenOpen">
          <div v-for="c in children" :key="c.id" class="d-flex align-items-center gap-2 flex-wrap small border-top py-1" data-testid="publish-child" :data-id="c.id" :data-state="c.state">
            <span class="fw-semibold" data-testid="publish-child-shot">{{ c.shot }}</span><span class="font-monospace text-truncate" style="max-width: 16rem" data-testid="publish-child-clip">{{ c.clip }}</span>
            <span class="badge" :class="childClass(c.state)" data-testid="publish-child-state">{{ $t(`publish.modal.state.${c.state}`, c.state) }}</span>
            <span data-testid="publish-child-files">{{ $t('publish.ret.childFiles', { n: c.files ?? 0 }) }}</span><span data-testid="publish-child-bytes">{{ formatBytes(c.bytes || 0) }}</span><span v-if="c.rate" class="text-body-secondary" data-testid="publish-child-rate">{{ $t('publish.modal.rate', { rate: formatBytes(c.rate) }) }}</span>
            <span v-if="c.error" class="text-danger" data-testid="publish-child-error"><ErrorText :text="String(c.error)" /></span>
            <BButton v-if="c.state === 'failed'" size="sm" variant="outline-warning" class="ms-auto" data-testid="publish-child-retry" :disabled="retryingIds.includes(c.id) || !canRetry" :title="canRetry ? '' : $t('publish.ret.cannotRetry')" @click="retryOne(c)"><BSpinner v-if="retryingIds.includes(c.id)" small class="me-1" /><i v-else class="fa-solid fa-rotate me-1"></i>{{ $t('publish.backfill.retry') }}</BButton>
            <BButton v-if="['queued', 'uploading'].includes(c.state)" size="sm" variant="outline-warning" class="ms-auto" data-testid="publish-child-cancel" @click="store.cancel(c.id)">{{ $t('publish.modal.cancel') }}</BButton>
          </div>
        </div>
      </div>
      <div v-if="job.manifest" class="small mt-1 d-flex align-items-center gap-2 flex-wrap" data-testid="publish-manifest-state" :data-state="job.manifest.state"><span :class="job.manifest.state === 'failed' ? 'text-danger' : 'text-body-secondary'">{{ manifestLine }}</span>
        <BButton v-if="manifestUrl" size="sm" variant="outline-light" data-testid="publish-manifest-copy" @click="copy({ path: 'RETURN-MANIFEST.json', url: manifestUrl })">{{ copiedPath === 'RETURN-MANIFEST.json' ? $t('publish.modal.copied') : $t('publish.ret.copyManifest') }}</BButton></div>
      <div v-for="s in overridden" :key="s" class="small text-body-secondary" data-testid="publish-edl-override">{{ $t('edl.overrideRecorded', { stem: s }) }}</div>
      <div v-if="verified != null" class="small text-body-secondary" data-testid="publish-verified">{{ $t('publish.ret.verified', { n: verified }) }}</div>
      <div v-for="(w, i) in job.warnings || []" :key="i" class="small text-warning" data-testid="publish-job-warning">{{ w }}</div>
      <div v-if="job.summary" class="small" data-testid="publish-job-summary">{{ job.summary }}</div>
      <div v-if="job.error" class="small text-danger" data-testid="publish-job-error"><ErrorText :text="String(job.error)" /></div>
      <div v-if="(job.links || []).length" class="mt-2" data-testid="publish-links"><div v-if="!grouped" class="small fw-semibold">{{ $t('publish.modal.links') }}</div>
        <template v-for="g in groups" :key="g.kind">
          <div v-if="grouped" class="small fw-semibold mt-3 mb-1" :data-testid="`publish-links-${g.kind}`"><BButton variant="link" size="sm" class="p-0 fw-semibold text-decoration-none" :aria-expanded="linksOpen(g)" :data-testid="`publish-links-${g.kind}-toggle`" @click="toggleLinks(g)">{{ linksOpen(g) ? '▾' : '▸' }} {{ $t(`publish.links.group.${g.kind}`) }} ({{ g.items.length }})</BButton></div>
          <div v-for="l in (linksOpen(g) ? g.items : [])" :key="l.path + l.url" class="small py-1" data-testid="publish-link" :data-path="l.path" :data-kind="g.kind"><div class="d-flex align-items-center gap-2"><a v-if="g.kind === 'folder' && folderUrl(l)" :href="folderUrl(l)" target="_blank" rel="noopener noreferrer" class="font-monospace text-truncate" :title="$t('publish.links.openFolder')" data-testid="publish-link-folder">{{ s3Of(l) }}</a><span v-else-if="g.kind === 'folder'" class="font-monospace text-truncate" data-testid="publish-link-folder">{{ s3Of(l) }}</span><a v-else-if="l.url" :href="l.url" target="_blank" rel="noopener noreferrer" download class="font-monospace text-truncate" :title="$t('publish.links.download')" data-testid="publish-link-file">{{ l.path }}</a><span v-else class="font-monospace text-truncate" :title="$t('publish.links.notKept')" data-testid="publish-link-file">{{ l.path }}</span>
            <BButton size="sm" variant="link" class="p-0 px-1 flex-shrink-0 text-body-secondary copy-icon" :title="copiedPath === l.path ? $t('publish.modal.copied') : $t('publish.modal.copy')" :aria-label="copiedPath === l.path ? $t('publish.modal.copied') : $t('publish.modal.copy')" :disabled="g.kind !== 'folder' && !l.url" data-testid="publish-link-copy" :data-path="l.path" :data-copied="copiedPath === l.path ? 'true' : 'false'" @click="copy(g.kind === 'folder' ? { ...l, url: s3Of(l) } : l)"><i class="fa-regular" :class="copiedPath === l.path ? 'fa-circle-check text-success' : 'fa-copy'"></i></BButton></div>
            <div v-if="g.kind !== 'folder' && !l.url" class="text-body-secondary" data-testid="publish-link-notkept">{{ $t('publish.links.notKept') }}</div>
            <span v-if="l.expires_at" class="text-body-secondary" data-testid="publish-link-expiry">{{ $t('publish.modal.expires', { when: expiryText(l.expires_at) }) }}</span></div>
        </template></div>
      <div v-if="job.slack && job.slack.state !== 'skipped' || job.slack?.state === 'failed'" class="small mt-1 d-flex align-items-center gap-2" data-testid="publish-slack-state" :data-state="job.slack.state"><span :class="job.slack.state === 'failed' ? 'text-danger' : 'text-success'">{{ $t(`publish.modal.slackState.${job.slack.state}`, { error: job.slack.error || '' }) }}</span>
        <BButton v-if="job.slack.state === 'failed'" size="sm" variant="outline-light" data-testid="publish-slack-repost" @click="store.repost(job.job_id)">{{ $t('publish.modal.repost') }}</BButton></div>
    </div>
</template>

<script setup>
import ErrorText from './ErrorText.vue'
import { useToastStore, errorText } from '../stores/toast'
/** PublishJob: one publish job (files, bytes, rate, the file under way, Cancel), its result (uploaded, already there, failed with reasons, Retry failed), the links with Copy and expiry, and the Slack state with Re-post. Shared by the Publish and Backfill tabs. */
import { computed, ref } from 'vue'
import { t } from '../i18n'
import { usePublishStore } from '../stores/publish'
import { attempt } from '../utils/when'
import { formatBytes } from '../sync-progress'
import { expiryText, publishActive } from '../utils/publish'

const props = defineProps({ job: { type: Object, required: true }, embedded: { type: Boolean, default: false } })
const emit = defineEmits(['retry'])
const store = usePublishStore()
const copiedPath = ref('')
/** A folder link is shown, and copied, as the full address `s3://bucket/key/` (the bucket is the job's destination); clicking it opens that folder in the AWS console. */
const bucketOf = computed(() => /^s3:\/\/([^/]+)\//.exec(props.job.dest || '')?.[1] || '')
/** The AWS console address of a folder: built from the bucket and region (no secret in it), so it works after a restart too, when the stored job keeps no addresses. */
const folderUrl = (l) => l.url || (bucketOf.value ? `https://s3.console.aws.amazon.com/s3/buckets/${bucketOf.value}?prefix=${encodeURIComponent(l.path).replace(/%2F/g, '/')}&region=${store.settings?.s3?.region || 'us-west-2'}` : '')
const s3Of = (l) => (bucketOf.value ? `s3://${bucketOf.value}/${l.path}` : l.path)
const active = computed(() => publishActive(props.job))
/** How the volume files travel: "via pod <name>" or "via this PC" (a job from an older core says nothing). */
const via = computed(() => { const j = props.job; return j.adapter === 'pod' ? t('publish.modal.viaPod', { pod: j.pod || '' }) : j.adapter === 'pc' ? t('publish.modal.viaPc') : '' })
// Links: a core with the link settings groups them (Folder links, File links, Preview image); kind may be missing: a console.aws.amazon.com address is a folder, a *_preview.jpg a preview. A core without the settings shows one plain list as before.
/** Each group of links opens and closes; a long list of File links starts closed, the folder links and a short list open. */
const linksShut = ref({})
const linksOpen = (g) => (g.kind in linksShut.value ? !linksShut.value[g.kind] : !(g.kind === 'file' && g.items.length > 5))
const toggleLinks = (g) => { linksShut.value = { ...linksShut.value, [g.kind]: linksOpen(g) } }
const grouped = computed(() => typeof store.settings.slack?.file_links === 'boolean')
const kindOf = (l) => l.kind === 'folder' || l.kind === 'preview' || l.kind === 'file' ? l.kind : /console\.aws\.amazon\.com/.test(l.url || '') ? 'folder' : /_preview\.jpg$/i.test(l.path || '') ? 'preview' : 'file'
const groups = computed(() => (grouped.value ? ['folder', 'file', 'preview'] : ['file']).map((k) => ({ kind: k, items: (props.job.links || []).filter((l) => (grouped.value ? kindOf(l) === k : true)) })).filter((g) => g.items.length))
const when = computed(() => attempt(props.job))
const children = computed(() => (Array.isArray(props.job.children) ? props.job.children : []))
const childrenOpen = ref(children.value.length <= 5)   // many shots start collapsed
const childClass = (s) => (s === 'done' ? 'text-bg-success' : s === 'failed' ? 'text-bg-danger' : s === 'uploading' ? 'text-bg-primary' : 'text-bg-secondary')
const manifestUrl = computed(() => props.job.manifest?.url || (props.job.links || []).find((l) => /RETURN-MANIFEST\.json$/.test(l.path || ''))?.url || '')
const manifestLine = computed(() => { const m = props.job.manifest || {}; return m.state === 'failed' ? t('publish.ret.manifestFailed', { error: m.error || '' }) : m.state === 'updated' ? t('publish.ret.manifestUpdated', { n: m.shots ?? 0 }) : t('publish.ret.manifestPending') })
/** How many files carry a SHA-256 in the result: `sha256_count`, or the sha256 map, or the files that have one. */
const verified = computed(() => { const j = props.job; if (typeof j.sha256_count === 'number') return j.sha256_count; if (j.sha256 && typeof j.sha256 === 'object') return Array.isArray(j.sha256) ? j.sha256.length : Object.keys(j.sha256).length; if (Array.isArray(j.files) && j.files.some((f) => f && f.sha256)) return j.files.filter((f) => f.sha256).length; return null })
const overridden = computed(() => (Array.isArray(props.job.edl_overrides) ? props.job.edl_overrides : []).map((x) => (typeof x === 'string' ? x : x.stem || x.name)).filter(Boolean))
const failedKids = computed(() => children.value.filter((c) => c.state === 'failed')), retryingShots = ref(false), retryErr = ref('')
/** Every failed shot of the job tried again, one after the other (the shots that are done are not sent again). */
const toast = useToastStore()
const retryingIds = ref([])
/** A job from before the app kept each run's request cannot be sent again: its Retry buttons show but are off, with the reason. */
const canRetry = computed(() => props.job.retryable !== false)
/** One shot's own Retry: a spinner while it is asked, a toast saying what started or why it could not. */
async function retryOne(c) {
  retryingIds.value = [...retryingIds.value, c.id]
  try { await store.retry(c.id); toast.success(t('publish.ret.retrying', { shots: c.shot })) } catch (e) { toast.error(errorText(e), t('publish.ret.retryFailed')) } finally { retryingIds.value = retryingIds.value.filter((x) => x !== c.id) }
}
async function retryShots() {
  retryingShots.value = true; retryErr.value = ''
  const shots = failedKids.value.map((c) => c.shot)
  try { for (const c of failedKids.value) await store.retry(c.id); toast.success(t('publish.ret.retrying', { shots: shots.join(', ') })) } catch (e) { retryErr.value = errorText(e); toast.error(retryErr.value, t('publish.ret.retryFailed')) } finally { retryingShots.value = false }
}
/** Retry failed on a card of several shots tries those shots again (the Queue); on a plain job the Publish window's own handler gets the failed files. */
async function retryFailed() { if (failedKids.value.length) await retryShots(); else emit('retry', failed.value) }
const failed = computed(() => (Array.isArray(props.job.failed) ? props.job.failed : []))
const percent = computed(() => { const j = props.job; return j.state === 'done' || j.state === 'done_with_warning' ? 100 : j.bytes_total ? Math.round((100 * (j.bytes_done || 0)) / j.bytes_total) : j.files_total ? Math.round((100 * (j.files_done || 0)) / j.files_total) : 0 })
async function copy(l) { try { await navigator.clipboard.writeText(l.url); copiedPath.value = l.path; setTimeout(() => { if (copiedPath.value === l.path) copiedPath.value = '' }, 2000) } catch { copiedPath.value = '' } }
</script>
