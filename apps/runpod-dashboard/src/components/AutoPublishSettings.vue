<template>
  <CollapsibleSection v-if="show" id="autopublish" :title="$t('autopublish.block.title')" testid="settings-autopublish">
    <template #badge><span class="badge fw-normal" :class="model.enabled ? (model.dry_run ? 'text-bg-warning' : 'text-bg-success') : 'text-bg-secondary'" data-testid="autopublish-state">{{ model.enabled ? (model.dry_run ? $t('autopublish.chipDry') : $t('autopublish.chipOn')) : $t('autopublish.block.enabledOff') }}</span></template>
    <div class="small text-body-secondary mb-2" data-testid="autopublish-destination">{{ $t('autopublish.block.uploadsTo', { dest }) }}</div>
    <label class="d-flex align-items-center gap-2 mb-2"><input type="checkbox" class="form-check-input mt-0" role="switch" :checked="model.enabled" data-testid="autopublish-switch" @change="toggle($event)" />{{ $t('autopublish.block.switch') }}</label>
    <label v-if="hasDryFirst" class="d-flex align-items-center gap-2 small mb-2"><input v-model="model.dry_run_first" type="checkbox" class="form-check-input mt-0" data-testid="autopublish-dry-first" />{{ $t('autopublish.block.startDry') }}</label>
    <template v-if="model.enabled">
      <div v-if="model.standing" class="small mb-2" data-testid="autopublish-standing">{{ $t('autopublish.block.standing', { name: model.standing.approved_by, date: dateText(model.standing.at) }) }}</div>
      <label class="d-flex align-items-center gap-2 small mb-2"><input type="checkbox" class="form-check-input mt-0" :checked="model.dry_run" data-testid="autopublish-dry-run" @change="toggleDry($event)" />{{ $t('autopublish.block.dryRun') }}</label>
      <div class="small mb-2" data-testid="autopublish-targets" data-pipeline="true">
        <div class="fw-semibold mb-1">{{ $t('autopublish.pipe.title') }}</div>
        <div v-if="hasGenerate" class="border rounded p-2" data-testid="autopublish-step-generate">
          <div class="fw-semibold mb-1">{{ $t('autopublish.pipe.step1') }}</div>
          <div v-if="hasGenerate" class="small mb-2 border rounded p-2" data-testid="autopublish-generate">
            <label class="d-flex align-items-center gap-2 fw-semibold"><input v-model="model.generate.enabled" type="checkbox" class="form-check-input mt-0" data-testid="config-autopublish-generate" />{{ $t('autopublish.gen.title') }}</label>
            <template v-if="model.generate.enabled">
              <div class="d-flex gap-3 flex-wrap align-items-end mt-1">
                <label class="mb-0">{{ $t('autopublish.gen.where') }}
                  <select v-model="model.generate.where" class="form-select form-select-sm" data-testid="config-autopublish-generate-where"><option value="local">{{ $t('autopublish.gen.local') }}</option><option value="pod">{{ $t('autopublish.gen.pod') }}</option></select></label>
                <label class="mb-0">{{ $t('autopublish.gen.preset') }}
                  <select v-model="model.generate.preset" class="form-select form-select-sm" data-testid="config-autopublish-generate-preset"><option value="review">{{ $t('autopublish.gen.review') }}</option><option value="tunnel">{{ $t('autopublish.gen.tunnel') }}</option></select></label>
                <label class="mb-0">{{ $t('autopublish.gen.max') }}<BFormInput :model-value="model.generate.max_per_day ?? ''" type="number" min="1" size="sm" style="width: 7rem" :placeholder="$t('autopublish.gen.noLimit')" data-testid="config-autopublish-generate-max" @update:model-value="setMax" /></label>
                <label class="mb-0">{{ $t('autopublish.gen.settle') }}<BFormInput v-model.number="model.generate.settle_minutes" type="number" min="1" max="120" size="sm" style="width: 7rem" data-testid="config-autopublish-generate-settle" /></label>
              </div>
              <div v-if="'colour_in' in model.generate" class="mt-1" data-testid="autopublish-generate-colour-block">
            <label class="mb-0">{{ $t('autopublish.gen.colour') }}
              <select :value="model.generate.colour_in || ''" class="form-select form-select-sm" style="width: auto" data-testid="config-autopublish-generate-colour" @change="model.generate.colour_in = $event.target.value || null"><option value="">{{ $t('edl.colourChoose') }}</option><option v-for="c in COLOURS" :key="c" :value="c">{{ $t(`edl.colours.${c}`) }}</option></select></label>
            <div class="text-body-secondary" data-testid="config-autopublish-generate-colour-help">{{ $t('autopublish.gen.colourHelp') }}</div>
            <label v-if="model.generate.colour_in" class="mb-0 d-block">{{ $t('autopublish.gen.approver') }}<BFormInput v-model.trim="model.approved_by" size="sm" style="max-width: 16rem" autocomplete="off" data-testid="config-autopublish-generate-colour-approver" /></label>
          </div>
          <div v-if="'start_pod' in model.generate" class="mt-1" data-testid="autopublish-generate-startpod">
            <label class="d-flex align-items-center gap-2"><input v-model="model.generate.start_pod" type="checkbox" class="form-check-input mt-0" data-testid="config-autopublish-generate-start-pod" />{{ $t('autopublish.gen.startPod') }}</label>
            <template v-if="model.generate.start_pod">
              <div class="text-warning" data-testid="autopublish-generate-startpod-warning">{{ $t('autopublish.gen.spendsMoney') }}</div>
              <label class="d-flex align-items-center gap-2"><input v-model="model.generate.stop_when_done" type="checkbox" class="form-check-input mt-0" data-testid="config-autopublish-generate-stop-when-done" />{{ $t('autopublish.gen.stopWhenDone') }}</label>
              <label class="mb-0">{{ $t('autopublish.gen.maxSpend') }}<BFormInput v-model.number="model.generate.max_spend_usd_per_day" type="number" min="1" size="sm" style="width: 7rem" data-testid="config-autopublish-generate-max-spend" /></label>
              <label v-if="model.generate.where !== 'pod'" class="mb-0 d-block">{{ $t('autopublish.gen.approver') }}<BFormInput v-model.trim="model.approved_by" size="sm" style="max-width: 16rem" autocomplete="off" data-testid="config-autopublish-generate-start-approver" /></label>
            </template>
          </div>
          <div v-if="model.generate.where === 'pod'" class="mt-1" data-testid="autopublish-generate-pod">
                <div class="text-warning" data-testid="autopublish-generate-pod-warning">{{ $t('autopublish.gen.podWarning') }}</div>
                <label class="mb-0">{{ $t('autopublish.gen.approver') }}<BFormInput v-model.trim="model.approved_by" size="sm" style="max-width: 16rem" autocomplete="off" data-testid="config-autopublish-generate-approver" /></label>
                <label class="d-flex align-items-center gap-2"><input v-model="model.generate.fallback_local" type="checkbox" class="form-check-input mt-0" data-testid="config-autopublish-generate-fallback" />{{ $t('autopublish.gen.fallback') }}</label>
              </div>
            </template>
            <div class="text-body-secondary mt-1" data-testid="config-autopublish-generate-help">{{ $t('autopublish.gen.help') }}</div>
          </div>
        </div>
        <div v-if="hasGenerate" class="text-center text-body-secondary" data-testid="autopublish-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-down"></i></div>
        <div class="border rounded p-2" data-testid="autopublish-step-publish">
          <div class="fw-semibold mb-1">{{ $t('autopublish.pipe.step2') }}</div>
          <div class="font-monospace text-body-secondary mb-1" data-testid="autopublish-destination-readonly">{{ pipeDest }}</div>
    <div v-if="model.enabled && model.dry_run" class="text-warning mb-1" data-testid="autopublish-step-dry-s3">{{ $t('autopublish.dry.stepS3') }}</div>
          <div class="d-flex gap-3 flex-wrap align-items-end mb-2 small">
            <label class="mb-0">{{ $t('autopublish.block.window') }}<BFormInput v-model.number="model.window_minutes" type="number" min="0" max="120" size="sm" style="width: 8rem" data-testid="autopublish-window" /></label>
            <div v-if="hasCap" class="d-flex align-items-end gap-2">
              <label class="d-flex align-items-center gap-2 mb-1"><input type="checkbox" class="form-check-input mt-0" :checked="capOn" data-testid="autopublish-cap-on" @change="setCap($event.target.checked)" />{{ $t('autopublish.block.capOn') }}</label>
              <label v-if="capOn" class="mb-0">{{ $t('autopublish.block.cap') }}<BFormInput v-model.number="model.daily_cap" type="number" min="0" max="100" size="sm" style="width: 8rem" data-testid="autopublish-cap" /></label>
              <span v-else class="small text-body-secondary mb-1" data-testid="autopublish-no-limit">{{ $t('autopublish.block.noLimit') }}</span>
            </div>
          </div>
          <div v-if="hasSources" class="small mb-2" data-testid="autopublish-sources">
            <div class="fw-semibold">{{ $t('autopublish.sources.title') }}</div>
            <label class="d-flex align-items-center gap-2"><input type="checkbox" class="form-check-input mt-0" :checked="model.sources.local" data-testid="config-autopublish-source-local" @change="setSource('local', $event)" />{{ $t('autopublish.sources.local') }}</label>
            <label class="d-flex align-items-center gap-2"><input type="checkbox" class="form-check-input mt-0" :checked="model.sources.volume" data-testid="config-autopublish-source-volume" @change="setSource('volume', $event)" />{{ $t('autopublish.sources.volume') }}</label>
            <label class="mb-0 mt-1">{{ $t('autopublish.sources.minutes') }}<BFormInput v-model.number="model.volume_scan_minutes" type="number" min="1" max="120" size="sm" style="width: 8rem" :disabled="!model.sources.volume" data-testid="config-autopublish-volume-minutes" /></label>
            <div v-if="sourcesError" class="text-danger" data-testid="config-autopublish-sources-error">{{ $t('autopublish.sources.atLeastOne') }}</div>
            <div class="text-body-secondary" data-testid="config-autopublish-sources-help">{{ $t('autopublish.sources.help') }}</div>
          </div>
          <div v-if="hasRound" class="small mb-2" data-testid="autopublish-return">
            <label class="mb-0 d-block">{{ $t('autopublish.block.round') }}<BFormInput v-model.trim="model.round" size="sm" class="font-monospace" style="max-width: 24rem" data-testid="config-autopublish-round" /></label>
            <div class="text-body-secondary" data-testid="config-autopublish-round-example">{{ $t('autopublish.block.roundExample', { example: roundExample(model.round) }) }}</div>
            <label class="d-flex align-items-center gap-2 mt-1"><input v-model="model.include_dpx" type="checkbox" class="form-check-input mt-0" data-testid="config-autopublish-include-dpx" />{{ $t('autopublish.block.includeDpx') }}</label>
            <label class="d-flex align-items-center gap-2 mt-1">{{ $t('autopublish.block.scope') }}<BFormSelect v-model="model.scope" size="sm" :options="scopeOptions" style="max-width: 16rem" :title="$t('autopublish.block.scopeHelp')" data-testid="config-autopublish-scope" /></label>
            <div class="text-body-secondary" data-testid="config-autopublish-scope-help">{{ $t('autopublish.block.scopeHelp') }}</div>
            <label v-if="model.include_dpx" class="d-flex align-items-center gap-2 mt-1 ms-4"><input :checked="model.fix_dpx !== false" @change="model.fix_dpx = $event.target.checked" type="checkbox" class="form-check-input mt-0" data-testid="config-autopublish-fix-dpx" />{{ $t('autopublish.block.fixDpx') }}</label>
            <div v-if="model.include_dpx" class="form-text ms-4" data-testid="config-autopublish-fix-dpx-note">{{ model.fix_dpx !== false ? $t('autopublish.block.fixDpxOn') : $t('autopublish.block.fixDpxOff') }}</div>
          </div>
          <div v-if="hasReview" class="mt-1" data-testid="autopublish-review-block">
      <label class="d-flex align-items-center gap-2"><input v-model="model.require_review" type="checkbox" class="form-check-input mt-0" data-testid="config-autopublish-require-review" />{{ $t('autopublish.pipe.requireReview') }}</label>
      <div class="text-body-secondary" data-testid="config-autopublish-require-review-help">{{ $t('autopublish.pipe.reviewHelp') }}</div>
      <template v-if="model.require_review === false">
        <div v-if="ap.status?.watching?.without_review" class="text-warning" data-testid="autopublish-without-review-preview">{{ $t('autopublish.pipe.withoutReview', { n: ap.status.watching.without_review.sequences ?? 0, gb: Math.round((ap.status.watching.without_review.bytes ?? 0) / 1e8) / 10 }) }}</div>
        <label class="mb-0 d-block">{{ $t('autopublish.gen.approver') }}<BFormInput v-model.trim="model.approved_by" size="sm" style="max-width: 16rem" autocomplete="off" data-testid="config-autopublish-require-review-approver" /></label>
      </template>
      <label v-if="'max_gb_per_day' in model" class="mb-0 d-block mt-1">{{ $t('autopublish.pipe.maxGb') }}<BFormInput :model-value="model.max_gb_per_day ?? ''" type="number" min="1" size="sm" style="width: 8rem" :placeholder="$t('autopublish.gen.noLimit')" data-testid="config-autopublish-max-gb" @update:model-value="(v) => (model.max_gb_per_day = v === '' || v === null ? null : Number(v))" /></label>
    </div>
    <div v-if="hasRequire" class="mt-1" role="radiogroup" data-testid="autopublish-publish-option">
      <label class="d-flex align-items-start gap-2"><input type="radio" class="form-check-input mt-1" name="ap-publish" :checked="model.require_approval === true" data-testid="config-autopublish-publish-approved" @change="model.require_approval = true" /><span><strong>{{ $t('autopublish.pipe.approvedOpt') }}</strong><span class="d-block text-body-secondary" data-testid="config-autopublish-publish-approved-help">{{ $t('autopublish.pipe.approvedHelp') }}</span></span></label>
      <label class="d-flex align-items-start gap-2"><input type="radio" class="form-check-input mt-1" name="ap-publish" :checked="model.require_approval !== true" data-testid="config-autopublish-publish-all" @change="model.require_approval = false" /><span><strong>{{ $t('autopublish.pipe.allOpt') }}</strong><span class="d-block text-body-secondary" data-testid="config-autopublish-publish-all-help">{{ $t('autopublish.pipe.allHelp') }}</span></span></label>
    </div>
            <label class="d-flex align-items-center gap-2"><input v-model="model.targets.s3" type="checkbox" class="form-check-input mt-0" data-testid="autopublish-target-s3" />S3 <code class="text-body-secondary" data-testid="autopublish-target-s3-dest">{{ dest }}</code></label>
            <label class="d-flex align-items-center gap-2 text-body-secondary" :title="$t('autopublish.block.tunnelTip')"><input type="checkbox" class="form-check-input mt-0" disabled :checked="false" data-testid="autopublish-target-tunnel" />{{ $t('autopublish.block.tunnel') }}</label>
        </div>
        <div class="text-center text-body-secondary" data-testid="autopublish-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-down"></i></div>
        <div class="border rounded p-2" data-testid="autopublish-step-slack">
          <div class="fw-semibold mb-1">{{ $t('autopublish.pipe.step3') }}</div>
          <div v-if="slackChannel" class="font-monospace text-body-secondary" data-testid="autopublish-slack-channel">{{ slackChannel }}</div>
    <div v-if="model.enabled && model.dry_run" class="text-warning mb-1" data-testid="autopublish-step-dry-slack">{{ $t('autopublish.dry.stepSlack') }}</div>
            <label class="d-flex align-items-center gap-2"><input v-model="model.targets.slack" type="checkbox" class="form-check-input mt-0" :disabled="!slackOk.ok" data-testid="autopublish-target-slack" />Slack</label>
            <div v-if="!slackOk.ok" class="text-warning ms-4 d-flex align-items-center gap-2" data-testid="autopublish-target-slack-reason">{{ slackOk.reason }} <BButton v-if="slackOk.connect" size="sm" variant="outline-light" data-testid="autopublish-slack-connect" @click="openConnect">{{ $t('publish.modal.openConnect') }}</BButton></div>
        </div>
      </div>
      <div v-if="ap.settings?.problem && !ap.settings.ready" class="small text-warning mb-2" data-testid="autopublish-problem">{{ ap.settings.problem }}</div>   <!-- no "ready" badge: the header badge already says the state; only a problem is worth a line -->
      <div class="d-flex align-items-center gap-3">
        <BButton variant="danger" size="sm" class="flex-shrink-0" data-testid="autopublish-off" @click="off"><i class="fa-solid fa-power-off me-1"></i>{{ $t('autopublish.block.off') }}</BButton>
        <span class="small text-body-secondary" data-testid="autopublish-off-note">{{ $t('autopublish.block.offNote') }}</span>
      </div>
    </template>
    <div v-if="ap.status?.generate?.enabled" class="border rounded p-2 mt-2" data-testid="autopublish-generate-block"><AutoPublishGenerate :status="ap.status" /></div>
    <div v-if="problem" class="text-danger small mt-1" data-testid="autopublish-error">{{ $t(problem === 'window' ? 'autopublish.block.windowBad' : problem === 'cap' ? 'autopublish.block.capBad' : problem === 'round' ? 'autopublish.block.roundBad' : problem === 'minutes' ? 'autopublish.sources.minutesBad' : problem === 'spend' ? 'autopublish.gen.spendBad' : problem === 'maxgb' ? 'autopublish.pipe.maxGbBad' : problem === 'settle' ? 'autopublish.gen.settleBad' : problem === 'genmax' ? 'autopublish.gen.maxBad' : problem === 'approver' ? 'autopublish.gen.approverNeeded' : 'autopublish.block.targetsBad') }}</div>
    <div v-if="error" class="text-danger small mt-1" data-testid="autopublish-action-error">{{ error }}</div>
    <div class="small text-body-secondary mt-2" data-testid="autopublish-preview-note">{{ $t('autopublish.block.previewNote') }}</div>
    <div class="small text-body-secondary mt-2" data-testid="autopublish-binc-note">{{ $t('autopublish.block.binc') }}</div>
  </CollapsibleSection>
</template>

<script setup>
/**
 * AutoPublishSettings: the Auto-publish block of Settings > Publishing (docs/ADR-050 amendment). Its values are part of the configuration (`auto_publish`): the window, the cap, the Slack tick and the Dry run tick (ON) are edited here
 * and saved by the window's one Save with the rest. Enabling, going live and Turn off are immediate acts with their own prompt: the core does them, then the window reloads the configuration's value so Save never writes a stale one.
 */
import CollapsibleSection from './CollapsibleSection.vue'
import { computed, onMounted, ref } from 'vue'
import { useAutopublishStore } from '../stores/autopublish'
import { usePublishStore } from '../stores/publish'
import { useNamePromptStore } from '../stores/nameprompt'
import { useUiStore } from '../stores/ui'
import { useConfirmStore } from '../stores/confirm'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { s3Dest, targetState } from '../utils/publish'
import { settingsProblem, CAP_START } from '../utils/autopublish'
import { roundExample } from '../utils/publish'
const scopeOptions = computed(() => [{ value: 'edl', text: t('autopublish.block.scopeEdl') }, { value: 'all', text: t('autopublish.block.scopeAll') }])
import AutoPublishGenerate from './AutoPublishGenerate.vue'

const props = defineProps({ modelValue: { type: Object, default: null }, show: { type: Boolean, default: true }, validate: { type: Boolean, default: false } })
const emit = defineEmits(['changed'])
const model = computed(() => props.modelValue || {})
const confirm = useConfirmStore()
const ap = useAutopublishStore(), pub = usePublishStore(), prompt = useNamePromptStore(), ui = useUiStore()
const error = ref('')
const hasGenerate = computed(() => !!props.modelValue && !!props.modelValue.generate)   // a core that cannot render by itself has no group
const setMax = (v) => { props.modelValue.generate.max_per_day = v === '' || v === null ? null : Number(v) }
const COLOURS = ['linear-p3-d65', 'linear-rec709', 'p3-d65-gamma26', 'p3-d65-srgb', 'p3-d65-gamma22', 'kodak-log']
const hasReview = computed(() => !!props.modelValue && 'require_review' in props.modelValue)   // a core where a review video is always required has no switch
const hasRequire = computed(() => !!props.modelValue && 'require_approval' in props.modelValue)   // a core where approval is the default has no switch
const slackChannel = computed(() => pub.settings.slack?.channel || '')
const pipeDest = computed(() => `${dest.value}${hasRound.value && model.value.round ? `${model.value.round}/` : ''}`)
const hasSources = computed(() => !!props.modelValue && !!props.modelValue.sources)   // a core without the two places watches this PC only
const sourcesError = ref(false)
/** Unticking the last place is refused inline (the core refuses it too). */
function setSource(k, ev) {
  const other = k === 'local' ? 'volume' : 'local'
  if (!ev.target.checked && !props.modelValue.sources[other]) { ev.target.checked = true; sourcesError.value = true; return }
  sourcesError.value = false; props.modelValue.sources[k] = ev.target.checked
}
const hasRound = computed(() => !!props.modelValue && 'round' in props.modelValue)   // a core without the return layout has neither the template nor Include DPX
const hasCap = computed(() => !!props.modelValue && 'daily_cap' in props.modelValue)   // an older core has no cap at all: no control
const hasDryFirst = computed(() => !!props.modelValue && 'dry_run_first' in props.modelValue)   // an older core always starts in dry run: no choice
const dryFirst = computed(() => model.value.dry_run_first !== false)
const capOn = computed(() => model.value.daily_cap != null)
const setCap = (on) => { props.modelValue.daily_cap = on ? CAP_START : null }
onMounted(() => { ap.loadSettings(); pub.loadSettings() })
const dest = computed(() => ap.settings?.destination || s3Dest(pub.settings.s3.bucket, pub.settings.s3.prefix) || t('publish.notConfigured'))
const slackReady = computed(() => targetState(pub.settings, 'slack'))
/** Slack is available when it is connected AND S3 is on (it announces an upload); the reason says which. */
const slackOk = computed(() => {
  if (!slackReady.value.ok) return { ok: false, reason: ap.settings?.target_state?.slack?.problem || slackReady.value.reason, connect: true }
  if (!model.value.targets?.s3) return { ok: false, reason: t('autopublish.block.slackNeedsS3'), connect: false }
  return { ok: true, reason: '', connect: false }
})
const problem = computed(() => (props.validate && model.value.enabled ? settingsProblem(model.value) : ''))
const dateText = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
const openConnect = () => { ui.connectTab = 'slack'; ui.connectOpen = true }
/** Turning ON: a name and a tick, then the core does it (the first time in dry run); its 400s show in the prompt. */
async function toggle(ev) {
  error.value = ''
  ev.target.checked = !!model.value.enabled   // the checkbox shows what the core says; the act below changes it
  if (model.value.enabled) { await off(); return }
  const extra = hasDryFirst.value ? { label: t('autopublish.block.startDryShort'), value: dryFirst.value, note: (on) => t(on ? 'autopublish.block.startsDry' : 'autopublish.block.startsLive'), okLabel: (on) => t(on ? 'autopublish.block.enableOk' : 'autopublish.block.enableLiveOk'), danger: (on) => !on } : null
  const r = await prompt.ask({ title: t('autopublish.block.enableTitle'), checkbox: t('autopublish.block.understood', { dest: dest.value }), okLabel: t('autopublish.block.enableOk'), message: `${hasRequire.value ? t(model.value.require_approval ? 'autopublish.pipe.statusApproved' : 'autopublish.pipe.statusAll') : ''}${hasDryFirst.value ? '' : ` ${t('autopublish.block.startsDry')}`}`.trim(), extra,
    submit: async ({ name, checked, extra: dry }) => { try { await ap.setSettings({ enabled: true, approved_by: name, understood: checked, ...(hasDryFirst.value ? { dry_run_first: !!dry } : {}) }); return '' } catch (e) { return errorText(e) } } })
  if (r) emit('changed')
}
/** Unticking Dry run on a running rule is going live: a plain confirm (no name), `understood: true`; ticking it again is a plain edit saved with the window. */
async function toggleDry(ev) {
  error.value = ''
  if (!model.value.dry_run) { props.modelValue.dry_run = true; return }   // ticked: a plain edit
  ev.target.checked = true   // unticking is going live: it only becomes so when the core says
  if (!(await confirm.ask(t('autopublish.block.liveConfirm', { dest: dest.value }), { title: t('autopublish.block.liveTitle'), okLabel: t('autopublish.block.liveOk') }))) return
  try { await ap.setSettings({ dry_run: false, understood: true }); emit('changed') } catch (e) { error.value = errorText(e) }
}
async function off() { error.value = ''; try { await ap.off(); emit('changed') } catch (e) { error.value = errorText(e) } }
</script>
