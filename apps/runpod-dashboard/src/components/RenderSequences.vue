<template>
  <div class="border rounded p-2 mb-2" data-testid="pod-outputs-render">
    <div class="fw-semibold">{{ $t('outputs.render.title') }}</div>
    <div class="small text-body-secondary mb-1">{{ $t('outputs.render.desc') }}</div>
    <div v-if="settingsNote" class="small text-body-secondary mb-2" data-testid="pod-outputs-render-settings" :data-source="settingsNote === 'settingsPod' ? 'pod' : 'default'">{{ $t(`outputs.render.${settingsNote}`) }}</div>
    <div v-if="renders.old || plan?.old" class="alert alert-info py-1 px-2 small mb-2" data-testid="pod-outputs-render-restart">{{ $t('outputs.render.restart') }}</div>
    <template v-else>
      <div class="small mb-2" role="radiogroup" data-testid="pod-outputs-render-kind">
        <label v-for="k in KINDS" :key="k" class="d-flex gap-2 align-items-center"><input v-model="prefs.kind" type="radio" class="form-check-input mt-0" :value="k" :data-testid="`pod-outputs-render-kind-${k}`" />{{ $t(k === 'review' ? 'outputs.render.kindReview' : 'outputs.render.kindProxy') }}</label>
      </div>
      <div v-if="isReview" class="mb-2">
        <label class="small mb-0 d-block">{{ $t('outputs.render.approvedBy') }}
          <input v-model="approvedBy" type="text" class="form-control form-control-sm" :placeholder="$t('outputs.render.approvedPlaceholder')" data-testid="pod-outputs-render-approved-by" autocomplete="off" />
        </label>
        <div v-if="!approvedBy.trim()" class="small text-warning" data-testid="pod-outputs-render-approved-hint">{{ $t('outputs.render.approvedHint') }}</div>
        <div class="d-flex gap-3 flex-wrap small mt-1" data-testid="pod-outputs-render-codecs">
          <label class="d-flex gap-2 align-items-center"><input v-model="prefs.h264" type="checkbox" class="form-check-input mt-0" data-testid="pod-outputs-render-codec-h264" />{{ $t('outputs.render.codecH264') }}</label>
          <label class="d-flex gap-2 align-items-center"><input v-model="prefs.prores" type="checkbox" class="form-check-input mt-0" data-testid="pod-outputs-render-codec-prores" />{{ $t('outputs.render.codecProres') }}</label>
        </div>
        <div v-if="prefs.prores && !prefs.h264" class="small text-body-secondary mt-1" data-testid="pod-outputs-render-prores-hint">{{ $t('outputs.render.proresOnlyHint') }}</div>
        <div class="small text-body-secondary mt-1" data-testid="pod-outputs-render-review-note">{{ $t('outputs.render.reviewNote') }}</div>
      </div>
      <div class="d-flex gap-3 flex-wrap align-items-end mb-2">
        <label class="small mb-0">{{ $t('outputs.render.size') }}
          <select v-model="prefs.width" class="form-select form-select-sm" data-testid="pod-outputs-render-width"><option v-for="o in widthOptions" :key="o.v" :value="o.v">{{ o.label }}</option></select>
        </label>
        <div v-if="prefs.width !== 'source'" class="small text-body-secondary w-100 order-last" data-testid="pod-outputs-render-downscale-hint">{{ $t('outputs.render.downscaleHint') }}</div>
        <label class="small mb-0">{{ $t('outputs.render.fps') }}
          <select v-model="prefs.fps" class="form-select form-select-sm" data-testid="pod-outputs-render-fps"><option v-for="f in FPS_CHOICES" :key="f" :value="f">{{ f === 'auto' ? $t('outputs.render.fpsAuto') : `${f} fps` }}</option></select>
        </label>
        <label class="small mb-0">{{ $t('outputs.render.where') }}
          <select v-model="prefs.where" class="form-select form-select-sm" data-testid="pod-outputs-render-where"><option v-for="w in WHERE_CHOICES" :key="w" :value="w" :data-ok="whereOk(w) ? 'true' : 'false'">{{ whereLabel(w) }}</option></select>
        </label>
      </div>
      <div class="small mb-2" data-testid="pod-outputs-render-adapters">
        <div v-for="id in ['pod', 'local']" :key="id" class="d-flex align-items-baseline gap-2" data-testid="pod-outputs-render-adapter" :data-id="id" :data-ok="adapters[id].ok ? 'true' : 'false'">
          <i class="fa-solid fa-circle dot" :class="adapters[id].ok ? 'text-success' : 'text-danger'" aria-hidden="true"></i>
          <span class="fw-semibold">{{ $t(id === 'pod' ? 'outputs.render.adapterPod' : 'outputs.render.adapterLocal') }}</span>
          <span class="text-body-secondary" data-testid="pod-outputs-render-adapter-reason">{{ adapterText(id) }}</span>
        </div>
        <div v-if="problem && !problem.blocker" class="text-body-secondary mt-1" data-testid="pod-outputs-render-no-ffmpeg-note">{{ problem.kind === 'broken' ? problem.reason : $t('outputs.render.noFfmpeg.note') }}</div>
      </div>
      <FfmpegAlert v-if="problem && problem.blocker" :problem="problem" :busy="planning" @check="checkAgain" />
      <div v-if="!items.length" class="small text-body-secondary mb-2" data-testid="pod-outputs-render-none">{{ $t('outputs.render.noSequences') }}</div>
      <div v-else class="small mb-2" data-testid="pod-outputs-render-plan" :data-sequences="summary.sequences" :data-frames="summary.frames">
        <template v-if="planning && !plan"><BSpinner small class="me-1" />{{ $t('outputs.render.planning') }}</template>
        <template v-else-if="plan">{{ planText }}</template>
      </div>
      <div v-if="isReview && plan && !plan.old" class="small mb-2" data-testid="pod-outputs-render-review-rows">
        <div v-if="planning && reviewRows.length < plan.sequences.length" class="text-body-secondary" data-testid="pod-outputs-render-review-planning"><BSpinner small class="me-1" />{{ $t('outputs.render.reviewPlanning') }}</div>
        <div v-for="s in reviewRows" :key="`${s.dir}/${s.name}`" data-testid="pod-outputs-render-review-shot" :data-shot="s.shot" :data-version="s.next_version"><span class="font-monospace">{{ $t('outputs.render.reviewShot', { shot: s.shot, version: v3(s.next_version) }) }}</span> <span class="text-body-secondary">{{ $t('outputs.render.reviewFolder', { folder: reviewFolder(s.shot, s.next_version) }) }}</span></div>
      </div>
      <div v-if="plan && !plan.old && items.length" class="small mb-2" data-testid="pod-outputs-render-pod">
        <div v-if="plan.pod_cpu" :class="plan.pod_cpu.cores < 8 ? 'text-warning' : 'text-body-secondary'" data-testid="pod-outputs-render-pod-cpu" :data-warn="plan.pod_cpu.cores < 8 ? 'true' : 'false'">{{ $t('outputs.render.podCpu', { cores: plan.pod_cpu.cores, ram: Math.round((plan.pod_cpu.mem_mb || 0) / 1024), free: Math.round(plan.pod_cpu.free_gb || 0) }) }}</div>
        <div v-if="outputGb" class="text-body-secondary" data-testid="pod-outputs-render-output-size">{{ $t('outputs.render.outputSize', { gb: outputGb, codec: isReview && prefs.prores ? 'ProRes' : 'H.264' }) }}</div>
        <div v-for="(n, i) in plan.notes || []" :key="i" class="text-warning" data-testid="pod-outputs-render-note">{{ n }}</div>
        <div class="text-body-secondary" data-testid="pod-outputs-render-cpu-hint">{{ $t('outputs.render.cpuHint') }}</div>
      </div>
      <div v-if="plan && !plan.old && plan.sequences.length" class="small mb-2" data-testid="pod-outputs-render-outputs">
        <span class="text-body-secondary">{{ $t('outputs.render.clipOutputs') }}:</span>
        <span v-for="n in outputList" :key="n" class="font-monospace ms-2" data-testid="pod-outputs-render-output-name">{{ n }}</span>
      </div>
      <details v-if="items.length" class="small mb-2" data-testid="pod-outputs-render-clipnames">
        <summary>{{ $t('outputs.render.clipNamesTitle') }}</summary>
        <div class="text-body-secondary my-1">{{ $t('outputs.render.clipNamesNote') }}</div>
        <div v-for="i in items" :key="`${i.dir}/${i.name}`" class="mb-1">
          <input type="text" class="form-control form-control-sm font-monospace" :value="clipOf(i)" :aria-label="$t('outputs.render.clipNameFor', { name: i.name })" data-testid="pod-outputs-render-clipname" :data-name="i.name" @input="clipEdits[`${i.dir}/${i.name}`] = $event.target.value" />
          <div v-if="clipProblem(clipOf(i))" class="text-danger" data-testid="pod-outputs-render-clipname-error">{{ $t(`outputs.render.${clipProblem(clipOf(i))}`) }}</div>
        </div>
      </details>
      <div v-for="(n, i) in estimates" :key="i" class="small text-body-secondary mb-2" data-testid="pod-outputs-render-estimate">{{ n }}</div>
      <div v-if="skipped" class="small text-body-secondary mb-2" data-testid="pod-outputs-render-skipped">{{ $t('outputs.render.skippedNames', { n: skipped }) }}</div>
      <div v-for="s in incompleteList" :key="`${s.dir}/${s.name}`" class="small text-warning mb-1" data-testid="pod-outputs-render-incomplete" :data-name="s.name"><i class="fa-solid fa-triangle-exclamation me-1"></i><span class="font-monospace">{{ s.name }}</span>: {{ $t('outputs.render.incomplete', { ranges: missingText(s.missing) }) }}</div>
      <label v-if="summary.incomplete && !isReview" class="d-flex align-items-center gap-2 small mb-2"><input v-model="prefs.allowPartial" type="checkbox" class="form-check-input mt-0" data-testid="pod-outputs-render-allow-partial" />{{ $t('outputs.render.allowPartial') }}</label>
      <div v-for="(w, i) in warnings" :key="i" class="alert alert-warning py-1 px-2 small mb-2" data-testid="pod-outputs-render-warning">{{ w }}</div>
      <label v-if="prefs.where !== 'local'" class="d-flex align-items-center gap-2 small mb-2"><input v-model="prefs.pull" type="checkbox" class="form-check-input mt-0" data-testid="pod-outputs-render-pull" />{{ $t('outputs.render.pull') }}</label>
      <div v-if="startError && !problem" class="text-danger small mb-2" data-testid="pod-outputs-render-error">{{ startError }}</div>
      <div class="d-flex gap-2 align-items-center mb-2">
        <BButton variant="primary" size="sm" :disabled="!canStart" :title="$t('outputs.render.startTitle')" data-testid="pod-outputs-render-start" @click="start"><BSpinner v-if="starting" small class="me-1" /><i v-else class="fa-solid fa-film me-1"></i>{{ $t('outputs.render.start') }}</BButton>
        <BButton v-if="running" variant="outline-warning" size="sm" data-testid="pod-outputs-render-stop" @click="stop"><i class="fa-solid fa-stop me-1"></i>{{ $t('outputs.render.stop') }}</BButton>
      </div>
      <div v-if="job" class="mb-2" data-testid="pod-outputs-render-job" :data-state="job.state" :data-job="job.job_id">
        <BProgress :value="percent" :max="100" :animated="running" :striped="running" height="0.6rem" :data-percent="percent" data-testid="pod-outputs-render-progress" />
        <div class="small mt-1" data-testid="pod-outputs-render-status">{{ statusText }}</div>
        <div v-if="eta" class="small text-body-secondary" data-testid="pod-outputs-render-eta">{{ $t('outputs.render.eta', { time: eta }) }}</div>
        <div v-if="job.state === 'pulling'" class="small text-info" data-testid="pod-outputs-render-syncing"><BSpinner small class="me-1" />{{ $t('outputs.render.syncing') }}<template v-if="job.pulled_files"> · {{ $t('outputs.render.syncingDetail', { files: job.pulled_files, size: sizeText(job.pulled_bytes || 0) }) }}</template></div>
        <ul class="list-unstyled small mb-1 mt-1 rows" data-testid="pod-outputs-render-seqs">
          <li v-for="(s, i) in job.sequences || []" :key="i" class="d-flex gap-2 align-items-baseline flex-wrap" data-testid="pod-outputs-render-seq" :data-state="s.state" :data-where="s.where || ''" :data-name="s.name">
            <span class="font-monospace text-truncate" :title="`${s.dir}/${s.name}`">{{ s.name }}</span><span v-if="s.clip_name && s.clip_name !== s.name" class="font-monospace text-body-secondary" data-testid="pod-outputs-render-seq-clip">→ {{ s.clip_name }}</span>
            <span v-if="s.where" class="badge text-bg-secondary" data-testid="pod-outputs-render-seq-where">{{ $t(`outputs.render.whereBadge.${s.where}`) }}</span>
            <span :class="s.state === 'failed' ? 'text-danger' : 'text-body-secondary'" data-testid="pod-outputs-render-seq-state">{{ $t(`outputs.render.state.${s.state}`) }}<template v-if="s.state === 'rendering' && s.frames_total">{{ ` ${s.frames_done} / ${s.frames_total}` }}</template></span>
            <span v-if="s.error" class="text-danger" data-testid="pod-outputs-render-seq-error">{{ s.error }}</span>
            <span v-else-if="s.warning" class="text-warning" data-testid="pod-outputs-render-seq-warning">{{ s.warning }}</span>
          </li>
        </ul>
        <div v-for="r in reviewDone" :key="`${r.s.dir}/${r.s.name}`" class="small d-flex gap-2 align-items-center" data-testid="pod-outputs-render-review-done" :data-shot="r.shot" :data-version="r.version"><span class="text-success">{{ $t('outputs.render.reviewDone', { shot: r.shot, version: v3(r.version), folder: reviewFolder(r.shot, r.version) }) }}</span><BButton variant="outline-light" size="sm" data-testid="pod-outputs-render-review-play" :data-shot="r.shot" @click="playReview(r)"><i class="fa-solid fa-play me-1"></i>{{ $t('outputs.render.reviewPlay') }}</BButton></div>
        <ul v-if="reviewDone.length && reviewDone[0].files.length" class="list-unstyled small mb-1" data-testid="pod-outputs-render-review-files"><li v-for="f in reviewDone[0].files" :key="f.name" class="font-monospace" :data-codec="f.codec">{{ f.name }}<span v-if="!/\.mp4$/i.test(f.name)" class="text-body-secondary font-sans-serif"> · {{ $t('outputs.render.notPlayable') }}</span></li></ul>
        <div v-if="reviewDone.length && reviewDone[0].codecs.length" class="small text-body-secondary" data-testid="pod-outputs-render-review-codecs">{{ $t('outputs.render.codecsLine', { codecs: reviewDone[0].codecs.join(', ') }) }}</div>
        <div v-if="finishedJob" class="small" :class="job.state === 'failed' ? 'text-danger' : 'text-success'" data-testid="pod-outputs-render-summary">{{ summaryText }}</div>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap pt-2 border-top">
        <BButton variant="outline-danger" size="sm" data-testid="pod-outputs-render-clear" @click="clear"><i class="fa-regular fa-trash-can me-1"></i>{{ $t('outputs.render.clear') }}</BButton>
        <span v-if="cleared" class="small text-body-secondary" data-testid="pod-outputs-render-cleared">{{ cleared }}</span>
        <span class="small text-body-secondary" data-testid="pod-outputs-render-clear-note">{{ $t('outputs.render.clearNote') }}</span>
      </div>
    </template>
  </div>
</template>

<script setup>
/**
 * RenderSequences: the "Render sequences" option of the Previews window (docs/ADR-048). The sequences are the DPX tiles the Outputs window lists; the core renders each into an H.264 proxy ON THE POD (then synced here) or ON THIS PC (ffmpeg, from the synced frames).
 * Size, frame rate, where, sync; a plan line from the core; Start; progress of the store's job (polled there, so closing the window loses nothing); Stop; a summary; Clear for the copies on this PC. All wording is in outputs.render.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRendersStore } from '../stores/renders'
import { useConfirmStore } from '../stores/confirm'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { sizeText } from '../utils/outputs'
import { rendersAPI } from '../api/renders'
import FfmpegAlert from './FfmpegAlert.vue'
import { fmtEta } from '../utils/syncs'
import { WIDTHS, FPS_CHOICES, WHERE_CHOICES, KINDS, clipProblem, outputNames, REVIEW_WIDTH, DEFAULT_WIDTH, APPROVED_KEY, reviewFolder, versionName, fpsFor, missingText, adapterMap, whereState, ffmpegProblem, planSummary, jobPercent, currentSequence, isActive } from '../utils/renders'

const props = defineProps({ pod: { type: Object, required: true }, items: { type: Array, default: () => [] }, skipped: { type: Number, default: 0 } })
const renders = useRendersStore(), confirm = useConfirmStore()
const prefs = renders.prefs
const isReview = computed(() => prefs.kind === 'review')
const v3 = (n) => versionName(n).slice(1)
const approvedBy = ref((() => { try { return localStorage.getItem(APPROVED_KEY) || '' } catch { return '' } })())   // remembered like the other approvals
watch(approvedBy, (v) => { try { localStorage.setItem(APPROVED_KEY, v.trim()) } catch { /* storage blocked: it lasts this window */ } })
watch(() => prefs.kind, (k) => { prefs.width = k === 'review' ? REVIEW_WIDTH : DEFAULT_WIDTH })   // both start at the source size (IMAX 4K)
const codecs = computed(() => [...(prefs.h264 ? ['h264'] : []), ...(prefs.prores ? ['prores422hq'] : [])])
const src0 = computed(() => plan.value?.sequences?.find((s) => s.source?.width)?.source)
const widthOptions = computed(() => [{ v: 'source', label: src0.value ? t('outputs.render.sourceResSize', { w: src0.value.width, h: src0.value.height }) : t('outputs.render.sourceRes') }, ...[...WIDTHS].reverse().map((w) => ({ v: w.px, label: t(`outputs.render.${w.id}`) }))])
const outputGb = computed(() => { const n = (plan.value?.sequences || []).reduce((a, s) => a + (Number(s.estimate?.output_gb) || 0), 0); return n > 0 ? Math.round(n * 10) / 10 : 0 })
const eta = computed(() => { const j = job.value; return j && j.state === 'rendering' && j.rate_fps > 0 && j.frames_total > j.frames_done ? fmtEta(Math.round((j.frames_total - j.frames_done) / j.rate_fps)) : '' })
const estimates = computed(() => [...new Set((plan.value?.sequences || []).map((s) => s.estimate?.note).filter(Boolean))])
const settingsNote = ref('')
const plan = ref(null), planning = ref(false), starting = ref(false), startError = ref(''), startErrObj = ref(null), cleared = ref('')
/** The review rows only for sequences the core has planned as reviews (a shot and a version): while the review plan is still on its way the plan on screen is the quick proxy's, which has neither, and printed 'undefined'. */
const reviewRows = computed(() => (plan.value?.sequences || []).filter((x) => x.shot && x.next_version != null))

const clipEdits = reactive({})   // `${dir}/${name}` -> an edited clip name (outputs are named with it; the frames are never renamed)
const clipOf = (i) => clipEdits[`${i.dir}/${i.name}`] ?? i.name
const clipBad = computed(() => props.items.some((i) => clipProblem(clipOf(i))))
/** Sent with the sequence only when it differs from the sequence's own name. */
const sequences = computed(() => props.items.map((i) => ({ ...i, fps: fpsFor(prefs.fps, i.name), ...(clipOf(i) !== i.name ? { clip_name: clipOf(i) } : {}) })))
const outputList = computed(() => (plan.value?.sequences || []).flatMap((s) => outputNames(s, { kind: prefs.kind, codecs: codecs.value, width: prefs.width })))
const podArg = () => (prefs.where === 'local' ? {} : { pod_id: props.pod.id })
let planSeq = 0, timer = null
async function replan() {
  const my = ++planSeq
  if (!props.items.length) { plan.value = null; planning.value = false; return }
  planning.value = true
  try {
    const p = await rendersAPI.plan({ ...podArg(), sequences: sequences.value, width: prefs.width, where: prefs.where, kind: prefs.kind, ...(isReview.value ? { codecs: codecs.value } : {}) })
    if (my === planSeq) { plan.value = p; if (p.settings && !seeded) seed(p) }
  } catch (e) { if (my === planSeq) plan.value = { old: false, pod_ok: false, reason: errorText(e), adapters: [], total_frames: 0, sequences: [] } } finally { if (my === planSeq) planning.value = false }
}
const later = () => { clearTimeout(timer); timer = setTimeout(replan, 150) }
watch(() => [prefs.kind, codecs.value.join(), props.items.map((i) => clipOf(i)).join('|'), props.items.map((i) => `${i.dir}/${i.name}:${i.first}-${i.last}:${i.fps}`).join('|'), prefs.width, prefs.fps, prefs.where, props.pod.id, props.pod.status], later)
watch(() => renders.finished, later)
onMounted(() => { replan(); renders.watch() })
onBeforeUnmount(() => { clearTimeout(timer); planSeq++ })
/** The window starts from the settings of the pod's configuration (or the default's) that the core reports with the plan; its own changes are per run and never saved. Once per opening. */
let seeded = false
async function seed(p) {
  seeded = true
  const s = p.settings, review = s.kind === 'review'
  settingsNote.value = p.settings_source === 'pod' ? 'settingsPod' : 'settingsDefault'
  prefs.kind = s.kind || 'proxy'; prefs.where = s.where || 'auto'; prefs.fps = s.fps ?? 'auto'; prefs.pull = s.pull !== false
  prefs.h264 = (s.codecs || ['h264']).includes('h264'); prefs.prores = (s.codecs || []).includes('prores422hq')
  await nextTick()   // the kind watcher sets the width first; the configured width wins
  prefs.width = (review ? s.review_width : s.proxy_width) ?? 'source'
}
function checkAgain() { startErrObj.value = null; startError.value = ''; return replan() }

const adapters = computed(() => adapterMap(plan.value?.adapters?.length ? plan.value.adapters : [{ id: 'pod', ok: !!plan.value?.pod_ok, reason: plan.value?.reason }]))
const ws = computed(() => (plan.value ? whereState(prefs.where, plan.value.adapters?.length ? plan.value.adapters : [{ id: 'pod', ok: !!plan.value.pod_ok, reason: plan.value.reason }, { id: 'local', ok: false, reason: '' }]) : { ok: false, why: [] }))
const whereOk = (w) => (plan.value ? whereState(w, plan.value.adapters || []).ok : true)
const whereLabel = (w) => `${t(w === 'auto' ? 'outputs.render.whereAuto' : w === 'pod' ? 'outputs.render.wherePod' : 'outputs.render.whereLocal')}${plan.value && !whereOk(w) ? ` (${t('outputs.render.adapterNo')})` : ''}`
const adapterText = (id) => (adapters.value[id].ok ? t('outputs.render.adapterOk') : adapters.value[id].reason || (id === 'pod' ? t('outputs.render.podNeeded') : t('outputs.render.adapterNo')))
const problem = computed(() => ffmpegProblem(plan.value?.adapters, prefs.where, startErrObj.value))
const warnings = computed(() => {
  if (!plan.value || plan.value.old || ws.value.ok || !props.items.length) return []
  const out = ws.value.why.filter((w) => w && !(problem.value && w === problem.value.reason))
  if (!out.length && !problem.value) out.push(plan.value.reason || t('outputs.render.podNeeded'))
  return out
})
const summary = computed(() => planSummary(plan.value))
const incompleteList = computed(() => (plan.value?.sequences || []).filter((s) => s.complete === false || (s.complete === undefined && (Array.isArray(s.gaps) ? s.gaps.length : Number(s.gaps)) > 0)).slice(0, 20))
const one = (n, k) => t(`outputs.render.${k}${n === 1 ? 'One' : 'Many'}`, { n })
const planText = computed(() => {
  const s = summary.value, parts = [one(s.sequences, 'sequence'), one(s.frames, 'frame')]
  if (s.pod && s.local) parts.push(t('outputs.render.usingPod', { n: s.pod }), t('outputs.render.usingLocal', { n: s.local }))
  else parts.push(t(s.local ? 'outputs.render.renderedOnLocal' : 'outputs.render.renderedOnPod'))
  if (s.rendered) parts.push(t('outputs.render.alreadyRendered', { n: s.rendered }))
  if (s.incomplete) parts.push(t('outputs.render.completeCounts', { complete: s.complete, incomplete: s.incomplete }))
  return parts.join(' · ')
})

const job = computed(() => renders.jobForPod(props.pod.id))
const running = computed(() => isActive(job.value))
const finishedJob = computed(() => !!job.value && ['done', 'failed', 'cancelled'].includes(job.value.state))
const percent = computed(() => jobPercent(job.value))
const statusText = computed(() => {
  const j = job.value
  if (!j) return ''
  if (j.state === 'queued') return t('outputs.render.queued')
  const base = t('outputs.render.progress', { i: currentSequence(j), n: (j.sequences || []).length, done: j.frames_done || 0, total: j.frames_total || 0 })
  return j.rate_fps ? `${base} · ${t('outputs.render.progressRate', { fps: Math.round(j.rate_fps) })}` : base
})
const summaryText = computed(() => {
  const j = job.value
  if (j.state === 'cancelled') return j.summary || t('outputs.render.jobCancelled')
  if (j.state === 'failed') return j.error || j.summary || t('outputs.render.jobFailed')
  return j.summary || t('outputs.render.summaryDefault', { n: (j.sequences || []).length })
})
/** A finished review job: each shot's version and folder, and a Play that opens the viewer on it. */
const reviewDone = computed(() => {
  const j = job.value
  if (!j || j.state !== 'done' || (j.kind || '') !== 'review') return []
  return (j.sequences || []).filter((s) => ['rendered', 'pulled', 'done'].includes(s.state)).map((s) => ({ s, shot: s.shot || j.shot || '', version: s.version ?? j.version ?? 0, files: s.files || j.files || [], codecs: j.codecs || [] }))
})
const emit = defineEmits(['play'])
function playReview(r) { renders.play = { dir: r.s.dir, name: r.s.name, review: true }; emit('play') }

const canStart = computed(() => !!plan.value && !plan.value.old && props.items.length > 0 && ws.value.ok && !clipBad.value && (!summary.value.incomplete || (prefs.allowPartial && !isReview.value)) && (!isReview.value || (!!approvedBy.value.trim() && codecs.value.length > 0)) && !running.value && !starting.value)
async function start() {
  starting.value = true; startError.value = ''; startErrObj.value = null
  const fixed = prefs.fps !== 'auto'
  try {
    await renders.start({ ...podArg(), sequences: sequences.value, width: prefs.width, where: prefs.where, kind: prefs.kind, ...(isReview.value ? { approved_by: approvedBy.value.trim(), codecs: codecs.value } : {}), ...(fixed ? { fps: Number(prefs.fps) } : {}), ...(prefs.where !== 'local' ? { pull: !!prefs.pull } : {}), ...(summary.value.incomplete && prefs.allowPartial && !isReview.value ? { allow_partial: true } : {}) })
  } catch (e) { startErrObj.value = e; startError.value = errorText(e) } finally { starting.value = false }
}
const stop = () => job.value && renders.cancel(job.value.job_id).catch((e) => { startError.value = errorText(e) })
async function clear() {
  if (!(await confirm.ask(t('outputs.render.clearConfirm'), { title: t('outputs.render.clear'), okLabel: t('outputs.render.clearOk') }))) return
  try {
    const r = await renders.clearLocal()
    cleared.value = r.removed ? t('outputs.render.cleared', { n: r.removed, size: sizeText(r.bytes) }) : t('outputs.render.clearedNone')
  } catch (e) { cleared.value = errorText(e) }
}
</script>

<style scoped>
.dot { font-size: 0.5rem; }
.rows { max-height: 12rem; overflow: auto; }
</style>
