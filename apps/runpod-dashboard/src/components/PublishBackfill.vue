<template>
  <div data-testid="publish-backfill">
    <div v-if="restart" class="alert alert-info" data-testid="publish-backfill-restart">{{ $t('publish.backfill.restart') }}</div>
    <BRow v-else class="g-3">
      <BCol lg="8">
        <div class="border rounded p-2 mb-2" data-testid="publish-backfill-sources">
          <div class="fw-semibold small mb-1">{{ $t('publish.backfill.sources') }} <span class="text-body-secondary fw-normal">· {{ $t('publish.backfill.readOnly') }}</span></div>
          <label v-for="s in SOURCES" :key="s.id" class="d-flex align-items-center gap-2 small"><input v-model="sources" type="checkbox" :value="s.id" class="form-check-input mt-0" data-testid="publish-backfill-source" :data-source="s.id" />{{ $t(s.label) }}</label>
          <div class="d-flex align-items-center gap-2 mt-1">
            <BButton size="sm" variant="primary" :disabled="scanning || !sources.length" data-testid="publish-backfill-scan" @click="scan"><BSpinner v-if="scanning" small class="me-1" />{{ $t(scanning ? 'publish.backfill.scanning' : 'publish.backfill.scan') }}</BButton>
            <BButton v-if="scanning" size="sm" variant="outline-warning" data-testid="publish-backfill-cancel-scan" @click="cancelScan">{{ $t('publish.backfill.cancelScan') }}</BButton>
            <span v-if="inv && inv.scanned != null && scanning" class="small text-body-secondary" data-testid="publish-backfill-scanned">{{ inv.scanned }}</span>
          </div>
          <div v-if="scanError" class="text-danger small mt-1" data-testid="publish-backfill-error">{{ scanError }}</div>
          <div v-if="inv?.unreadable?.length" class="text-warning small mt-1" data-testid="publish-backfill-unreadable">{{ $t('publish.backfill.unreadable', { list: inv.unreadable.map((u) => (typeof u === 'string' ? u : `${u.path}${u.reason ? ` (${u.reason})` : ''}`)).join(', ') }) }}</div>
        </div>
        <template v-if="inv">
          <div class="d-flex align-items-center gap-2 mb-1 flex-wrap">
            <BFormInput v-model="nameFilter" size="sm" style="max-width: 16rem" :placeholder="$t('publish.backfill.filter')" data-testid="publish-backfill-filter" autocomplete="off" />
            <label class="small mb-0"><input type="checkbox" class="form-check-input me-1" :checked="allSelected" data-testid="publish-backfill-all" @change="selectAll($event.target.checked)" />{{ $t('publish.backfill.all') }}</label>
            <span class="small ms-auto" data-testid="publish-backfill-totals">{{ $t('publish.backfill.totals', { files: totals.files, size: formatBytes(totals.bytes), there: totals.there }) }}</span>
          </div>
          <div class="border rounded inv" data-testid="publish-backfill-table">
            <template v-for="g in groups" :key="g.shot">
              <div class="d-flex align-items-center gap-2 px-2 py-1 bg-body-tertiary small fw-semibold" data-testid="publish-backfill-shot" :data-shot="g.shot">
                <input type="checkbox" class="form-check-input mt-0" :checked="g.rows.length > 0 && g.rows.every((r) => isOn(r))" :disabled="!g.rows.length" data-testid="publish-backfill-shot-check" :data-shot="g.shot" @change="toggleShot(g, $event.target.checked)" />
                <button type="button" class="btn btn-link btn-sm p-0 text-start" data-testid="publish-backfill-shot-toggle" :data-shot="g.shot" @click="toggleOpen(g.shot)">{{ open[g.shot] === false ? '▸' : '▾' }} {{ g.shot || $t('publish.backfill.unassigned') }}</button>
                <span v-if="!g.rows.length" class="text-body-secondary fw-normal" data-testid="publish-backfill-none">{{ $t('publish.backfill.none') }}</span>
              </div>
              <template v-if="open[g.shot] !== false"><div v-for="r in g.rows" :key="r.id" class="d-flex align-items-center gap-2 px-2 py-1 small border-top" data-testid="publish-backfill-row" :data-id="r.id" :data-weight="r.weight ? 'true' : 'false'">
                <input type="checkbox" class="form-check-input mt-0" :checked="isOn(r)" :disabled="r.weight" data-testid="publish-backfill-row-check" :data-id="r.id" @change="toggle(r, $event.target.checked)" />
                <span class="font-monospace text-truncate flex-grow-1" :title="r.path">{{ r.name }}</span>
                <span class="badge text-bg-secondary" data-testid="publish-backfill-kind">{{ r.kind }}</span>
                <span class="text-body-secondary" style="min-width: 4rem">{{ r.frames ? `${r.frames} fr` : '' }}</span>
                <span style="min-width: 5rem" class="text-end">{{ formatBytes(r.bytes) }}</span>
                <span style="min-width: 7rem"><span v-for="w in r.where" :key="w" class="badge me-1" :class="w === 'pc' ? 'text-bg-success' : 'text-bg-info'" data-testid="publish-backfill-where" :data-where="w">{{ $t(w === 'pc' ? 'publish.backfill.pc' : 'publish.backfill.volume') }}</span></span>
                <span style="min-width: 1.5rem"><i v-if="r.in_destination" class="fa-solid fa-check text-success" data-testid="publish-backfill-there" :title="$t('publish.backfill.there')"></i></span>
                <span v-if="r.weight" class="badge text-bg-warning" data-testid="publish-backfill-weight">{{ $t('publish.backfill.weightRefused') }}</span>
              </div>
              </template>
            </template>
          </div>
          <div class="d-flex gap-2 mt-2">
            <BButton size="sm" variant="outline-light" data-testid="publish-backfill-copy-csv" @click="copyCsv"><i class="fa-regular fa-copy me-1"></i>{{ csvCopied ? $t('publish.backfill.csvCopied') : $t('publish.backfill.copyCsv') }}</BButton>
            <BButton size="sm" variant="outline-light" data-testid="publish-backfill-save-csv" @click="saveCsv"><i class="fa-solid fa-download me-1"></i>{{ $t('publish.backfill.saveCsv') }}</BButton>
          </div>
        </template>
        <div v-else class="small text-body-secondary" data-testid="publish-backfill-empty">{{ $t('publish.backfill.nothing') }}</div>
      </BCol>
      <BCol lg="4" data-testid="publish-backfill-dest">
        <div class="fw-semibold small mb-1">{{ $t('publish.backfill.destination') }}</div>
        <label class="small mb-0" for="bf-prefix">{{ $t('publish.backfill.prefix') }}</label>
        <BFormInput id="bf-prefix" v-model.trim="prefix" size="sm" class="font-monospace" data-testid="publish-backfill-prefix" />
        <div class="small font-monospace mt-1" data-testid="publish-backfill-destline">{{ $t(store.settings.s3.credentials === 'panama' ? 'publish.backfill.destLine' : 'publish.backfill.destLinePlain', { dest: destPreview }) }}</div>
        <div class="small text-body-secondary" data-testid="publish-backfill-asis">{{ $t('publish.backfill.asIs') }}</div>
        <div class="small text-body-secondary" data-testid="publish-backfill-csvline">{{ $t('publish.backfill.csvLine', { date: today }) }}</div>
        <template v-if="slackOn"><textarea v-model="message" class="form-control form-control-sm font-monospace" rows="3" data-testid="publish-backfill-message"></textarea>
          <div v-if="plan?.slack" class="small text-body-secondary" data-testid="publish-backfill-slack-preview">{{ plan.slack.preview }}</div>
          <PreviewFrame v-model="previewRun" :plan="plan" :supported="previewSupported" :volume-source="store.settings.slack?.volume_source === true" :slack-on="true" /></template>
        <ReturnLayout v-model:overrides="edlOverrides" v-model:round="round" v-model:clip-names="clipNames" :active="layoutActive" :stems="stems" :plan="plan" :prefix="prefix" />
        <div v-for="(b, i) in plan?.blockers || []" :key="i" class="alert alert-danger py-1 px-2 small mt-2 mb-0" data-testid="publish-backfill-blocker">{{ b }}</div>
        <div v-if="plan" class="small mt-2" data-testid="publish-backfill-plan">{{ $t('publish.modal.count', { files: plan.files, size: formatBytes(plan.total_bytes) }) }}<span v-if="skipped" data-testid="publish-backfill-skipped"> · {{ $t('publish.modal.skipped', { n: skipped }) }}</span></div>
        <hr />
        <label class="small mb-0" for="bf-approved">{{ $t('publish.modal.approvedBy') }}</label>
        <BFormInput id="bf-approved" v-model.trim="approvedBy" size="sm" data-testid="publish-backfill-approved-by" />
        <div v-if="!approvedBy" class="small text-warning" data-testid="publish-backfill-approved-hint">{{ $t('publish.modal.approvedHint') }}</div>
        <div v-if="confirmText" class="small mt-2" data-testid="publish-backfill-confirm">{{ confirmText }}</div>
        <BButton variant="primary" size="sm" class="mt-2" :disabled="!canPublish" data-testid="publish-backfill-run" @click="run()"><i class="fa-solid fa-cloud-arrow-up me-1"></i>{{ $t('publish.backfill.publish') }}</BButton>
        <div v-if="runError" class="text-danger small mt-1" data-testid="publish-backfill-run-error">{{ runError }}</div>
      </BCol>
    </BRow>
    <PublishJob v-if="job" :job="job"  @retry="retry" />
  </div>
</template>

<script setup>
/**
 * PublishBackfill: scan the four places finished shots live (this PC's output/, the volume's output/, input/pipe_finals/, project/90_DELIVERIES/), read-only, into an inventory by shot; tick what to upload and send it
 * to S3 as it is (names unchanged), files only on the volume streamed through this PC, with the inventory as a CSV and a Slack status. A named yes is always asked.
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { publishAPI, RESTART } from '../api/publish'
import { usePublishStore } from '../stores/publish'
import { errorText } from '../stores/toast'
import { core } from '../api/bridge'
import { t } from '../i18n'
import { formatBytes } from '../sync-progress'
import { s3Dest, targetState, channelName, roundProblem, blockedRows } from '../utils/publish'
import { clipProblem } from '../utils/renders'
import PublishJob from './PublishJob.vue'
import PreviewFrame from './PreviewFrame.vue'
import ReturnLayout from './ReturnLayout.vue'
import { useUiStore } from '../stores/ui'

const SOURCES = [{ id: 'pc:output/', label: 'publish.backfill.srcPcOutput' }, { id: 'volume:output/', label: 'publish.backfill.srcVolOutput' }, { id: 'volume:input/pipe_finals/', label: 'publish.backfill.srcVolFinals' }, { id: 'volume:project/90_DELIVERIES/', label: 'publish.backfill.srcVolDeliveries' }]
const store = usePublishStore(), ui = useUiStore()
const openConnect = () => { ui.connectTab = 'slack'; ui.connectOpen = true }
const sources = ref(SOURCES.map((s) => s.id))
const scanning = ref(false), scanError = ref(''), restart = ref(false), scanJob = ref('')
const inv = ref(null), selected = ref([]), nameFilter = ref(''), open = reactive({})
const prefix = ref('returns/BKK/'), message = ref(store.settings.defaults.message || ''), plan = ref(null), runError = ref(''), jobId = ref(''), csvCopied = ref(false)
const approvedBy = ref((() => { try { return localStorage.getItem('runpod-manager.approved-by') || '' } catch { return '' } })())
const today = new Date().toISOString().slice(0, 10)
const s3ready = computed(() => targetState(store.settings, 's3')), slackReady = computed(() => targetState(store.settings, 'slack'))
const destPreview = computed(() => `${s3Dest(store.settings.s3.bucket, prefix.value)}<shot>/<name>`)
const rows = computed(() => inv.value?.rows || [])
const isOn = (r) => selected.value.includes(r.id)
const groups = computed(() => {
  const f = nameFilter.value.toLowerCase(), by = new Map()
  const known = Array.isArray(inv.value?.by_shot) ? inv.value.by_shot.map((x) => (typeof x === 'string' ? x : x.shot)) : Object.keys(inv.value?.by_shot || {})
  for (const s of known) by.set(s, [])
  for (const r of rows.value) { if (f && !r.name.toLowerCase().includes(f)) continue; const k = r.shot || ''; if (!by.has(k)) by.set(k, []); by.get(k).push(r) }
  return [...by.entries()].map(([shot, rs]) => ({ shot, rows: rs })).filter((g) => !f || g.rows.length)
})
const totals = computed(() => { const tt = inv.value?.totals; return { files: tt?.files ?? rows.value.length, bytes: tt?.bytes ?? rows.value.reduce((n, r) => n + (r.bytes || 0), 0), there: tt?.in_destination ?? tt?.there ?? rows.value.filter((r) => r.in_destination).length } })
const pickable = computed(() => rows.value.filter((r) => !r.weight))
const allSelected = computed(() => pickable.value.length > 0 && pickable.value.every(isOn))
const toggle = (r, on) => { selected.value = on ? [...new Set([...selected.value, r.id])] : selected.value.filter((i) => i !== r.id) }
const toggleShot = (g, on) => { const ids = g.rows.filter((r) => !r.weight).map((r) => r.id); selected.value = on ? [...new Set([...selected.value, ...ids])] : selected.value.filter((i) => !ids.includes(i)) }
const selectAll = (on) => { selected.value = on ? pickable.value.map((r) => r.id) : [] }
const toggleOpen = (shot) => { open[shot] = open[shot] === false }

let pollTimer = null
async function scan() {
  scanning.value = true; scanError.value = ''; restart.value = false; inv.value = null; selected.value = []
  try {
    const r = await publishAPI.backfill.scan({ sources: [...sources.value] })
    scanJob.value = r.job_id
    await poll()
  } catch (e) { scanning.value = false; if (errorText(e) === RESTART) restart.value = true; else scanError.value = errorText(e) }
}
async function poll() {
  try {
    const r = await publishAPI.backfill.inventory(scanJob.value)
    inv.value = r
    if (r.state === 'scanning') { pollTimer = setTimeout(poll, 1000); return }
    if (r.state === 'failed') scanError.value = t('publish.modal.state.failed')
  } catch (e) { scanError.value = errorText(e) }
  scanning.value = false
}
async function cancelScan() { clearTimeout(pollTimer); try { await store.cancel(scanJob.value) } catch { /* nothing to cancel */ } scanning.value = false; try { inv.value = await publishAPI.backfill.inventory(scanJob.value) } catch { /* keep what is shown */ } }
onBeforeUnmount(() => clearTimeout(pollTimer))

const skipped = computed(() => (plan.value?.items || []).filter((i) => i.skip).length)
const volumeCount = computed(() => rows.value.filter((r) => isOn(r) && !(r.where || []).includes('pc')).length)
// The destination (S3 and Slack) is chosen in the block above the tabs, shared with Publish files
const props = defineProps({ targets: { type: Array, default: () => ['s3'] } })
defineEmits(['update:targets'])
const slackOn = computed(() => props.targets.includes('slack'))
const targets = computed(() => (props.targets.includes('s3') ? props.targets : props.targets))
// first-frame preview of the Slack post: the Slack setting is the start, the tick is this run only (see PreviewFrame.vue)
const previewSupported = computed(() => typeof store.settings.slack?.preview_frame === 'boolean')
const previewRun = ref(store.settings.slack?.preview_frame !== false)
watch(() => store.settings.slack?.preview_frame, (v) => { previewRun.value = v !== false })
const previewBody = () => (previewSupported.value && slackOn.value ? { preview_frame: previewRun.value } : {})
// The BKK return layout (a core that reports it): a round name and a clip name per selected DPX sequence
const round = ref(''), clipNames = ref({}), edlOverrides = ref({})
const layoutActive = computed(() => (plan.value?.layout || store.settings.s3?.layout) === 'bkk-return')
const stems = computed(() => [...new Set(rows.value.filter((r) => isOn(r) && r.kind === 'dpx').map((r) => r.name))])
const clipEdits = () => Object.fromEntries(Object.entries(clipNames.value).filter(([s, v]) => stems.value.includes(s) && v && v !== s))
const clipsBad = computed(() => Object.values(clipNames.value).some((v) => v !== undefined && clipProblem(v)))
const overrideBody = () => { const o = Object.fromEntries(Object.entries(edlOverrides.value).filter(([, v]) => v)); return Object.keys(o).length ? { edl_override: o } : {} }
const layoutBody = () => (layoutActive.value ? { round: round.value, ...(Object.keys(clipEdits()).length ? { clip_names: clipEdits() } : {}), ...overrideBody() } : {})
const layoutOk = computed(() => !layoutActive.value || (!!round.value && !roundProblem(round.value) && !clipsBad.value && !(blockedRows(plan.value, edlOverrides.value).total > 0 && blockedRows(plan.value, edlOverrides.value).blocked === blockedRows(plan.value, edlOverrides.value).total)))
let planTimer = null, planSeq = 0
async function replan() {
  const my = ++planSeq
  if (!selected.value.length) { plan.value = null; return }
  try { const p = await publishAPI.backfill.plan({ rows: [...selected.value], targets: targets.value, destination_prefix: prefix.value, ...(slackOn.value ? { message: message.value } : {}), ...previewBody(), ...layoutBody() }); if (my === planSeq) plan.value = p } catch (e) { if (my === planSeq) plan.value = { ok: false, blockers: [errorText(e)], items: [], total_bytes: 0, files: 0, s3: null, slack: null, refused: [] } }
}
watch([selected, targets, prefix, message, previewRun, round, clipNames, edlOverrides, layoutActive], () => { clearTimeout(planTimer); planTimer = setTimeout(replan, 300) }, { deep: true })
onBeforeUnmount(() => { clearTimeout(planTimer); planSeq++ })
const channel = computed(() => plan.value?.slack?.channel || channelName(store.settings.slack.channel))
const confirmText = computed(() => {
  if (!plan.value || !selected.value.length) return ''
  const dest = plan.value.s3?.dest || s3Dest(store.settings.s3.bucket, prefix.value), size = formatBytes(plan.value.total_bytes)
  return slackOn.value ? t('publish.backfill.confirm', { files: plan.value.files, size, volume: volumeCount.value, dest, channel: channel.value }) : t('publish.backfill.confirmNoSlack', { files: plan.value.files, size, volume: volumeCount.value, dest })
})
const canPublish = computed(() => !!plan.value && plan.value.ok && !plan.value.blockers.length && !!approvedBy.value && s3ready.value.ok && selected.value.length > 0 && layoutOk.value && !(job.value && ['queued', 'uploading', 'posting'].includes(job.value.state)))
async function run(ids) {
  runError.value = ''
  try {
    try { localStorage.setItem('runpod-manager.approved-by', approvedBy.value) } catch { /* storage blocked */ }
    const r = await store.runBackfill({ rows: ids || [...selected.value], targets: targets.value, destination_prefix: prefix.value, approved_by: approvedBy.value, ...(slackOn.value ? { message: message.value } : {}), ...previewBody(), ...layoutBody() })
    jobId.value = r.job_id
  } catch (e) { runError.value = errorText(e) }
}
const retry = (failed) => run(failed.map((f) => f.id || f.path))
const job = computed(() => (jobId.value ? store.job(jobId.value) : null))

const csv = computed(() => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return ['shot,name,kind,frames,bytes,modified,where,in_destination,source,path', ...rows.value.map((r) => [r.shot, r.name, r.kind, r.frames, r.bytes, r.modified, (r.where || []).join('+'), r.in_destination ? 'yes' : 'no', r.source, r.path].map(q).join(','))].join('\n') + '\n'
})
async function copyCsv() { try { await navigator.clipboard.writeText(csv.value); csvCopied.value = true; setTimeout(() => (csvCopied.value = false), 2000) } catch { csvCopied.value = false } }
async function saveCsv() {
  const name = `_inventory_${today}.csv`
  if (core?.files?.saveText) { try { await core.files.saveText(name, csv.value) } catch (e) { scanError.value = errorText(e) } return }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv.value], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove()
}
</script>

<style scoped>
.inv { max-height: 45vh; overflow: auto; }
</style>
