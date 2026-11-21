<template>
  <div v-if="show" class="border rounded p-2 mb-2" data-testid="autopublish-dryrun-panel">
    <div class="fw-semibold">{{ $t('autopublish.dry.title') }}</div>
    <div class="small" data-testid="autopublish-dryrun-line">{{ $t('autopublish.dry.line', { n: plans.length, files: files.toLocaleString('en-US'), size: sizeText, dest, n_min: status.window_minutes ?? 10 }) }}</div>
    <div class="small text-body-secondary" data-testid="autopublish-dryrun-slack">{{ slackLine }}</div>
    <div class="d-flex align-items-center gap-2 flex-wrap mt-1">
      <BButton size="sm" variant="outline-light" :disabled="busy" data-testid="autopublish-dryrun-copy" @click="copy"><BSpinner v-if="busy" small class="me-2" />{{ copied ? $t('autopublish.dry.copied') : $t('autopublish.dry.copy') }}</BButton>
      <BButton size="sm" variant="outline-primary" :disabled="!!allBlocked" :title="allBlocked || $t('autopublish.dry.publishAllTip')" data-testid="autopublish-dryrun-deliver-all" @click="deliverAll">{{ $t('autopublish.dry.publishAll') }}</BButton>
      <span class="small text-body-secondary" data-testid="autopublish-dryrun-hint">{{ $t('autopublish.dry.hint') }}</span>
    </div>
    <div v-if="err" class="small text-danger" data-testid="autopublish-dryrun-error">{{ err }}</div>
  </div>
</template>

<script setup>
/** AutoPublishDryRun: while Auto-publish is in a dry run, what it WOULD do in one panel: N review videos, files and size, the S3 destination, the Slack summary state and the text to copy. Hidden when the core gives no dry-run plans. */
import { computed, ref } from 'vue'
import { useAutopublishStore } from '../stores/autopublish'
import { useNamePromptStore } from '../stores/nameprompt'
import { targetsText } from '../utils/autopublish'
import { errorText } from '../stores/toast'
import { formatBytes } from '../sync-progress'
import { whenText } from '../utils/when'
import { t } from '../i18n'

const ap = useAutopublishStore()
const status = computed(() => ap.status || {})
const plans = computed(() => (ap.pending || []).filter((e) => e.dry_run_plan))
const show = computed(() => !!status.value.enabled && !!status.value.dry_run && plans.value.length > 0)
const files = computed(() => plans.value.reduce((n, e) => n + (e.dry_run_plan.total_files ?? (e.dry_run_plan.files || []).length), 0))
const sizeText = computed(() => formatBytes(plans.value.reduce((n, e) => n + (e.dry_run_plan.total_bytes ?? 0), 0)))
const dest = computed(() => { const p = plans.value[0]?.dry_run_plan; return p ? `s3://${p.bucket}/${String(p.prefix || '').replace(/^\/+/, '').replace(/\/?$/, '/')}${p.round ? `${p.round}/` : ''}` : '' })
const slackLine = computed(() => { const s = status.value; if (!s.targets?.slack) return t('autopublish.dry.slackOff'); const at = whenText(s.slack_dry_run?.posted_at); return at ? t('autopublish.dry.slackPosted', { when: at }) : t('autopublish.dry.slackNone') })
const busy = ref(false), copied = ref(false), err = ref(''), prompt = useNamePromptStore()
const wouldList = computed(() => (ap.pending || []).filter((e) => e.state === 'would_upload'))
const running = computed(() => (ap.pending || []).some((e) => ['uploading', 'posting'].includes(e.state)))
const allBlocked = computed(() => { if (!wouldList.value.length) return t('autopublish.dry.publishAllNone'); if (status.value.today && status.value.today.left === 0) return t('autopublish.pane.realCapSpent', { cap: status.value.daily_cap }); return '' })
async function deliverAll() {
  const st = status.value, n = wouldList.value.length, bytes = wouldList.value.reduce((a, e) => a + (e.bytes || 0), 0), fileCount = wouldList.value.reduce((a, e) => a + (e.files ?? 0), 0)
  const round = wouldList.value[0]?.dry_run_plan?.round || ap.settings?.round || ''
  const message = t('autopublish.dry.publishAllMessage', { n, files: fileCount.toLocaleString('en-US'), size: formatBytes(bytes), round, targets: targetsText(st.targets || {}), left: st.today?.left ?? t('autopublish.pane.capNone') })
  err.value = ''
  await prompt.ask({ title: t('autopublish.dry.publishAllTitle'), message, okLabel: t('autopublish.dry.publishAll'), name: st.standing?.approved_by || '', submit: async ({ name }) => {
    try { const r = await ap.publishAllDry(name); if (r?.refused?.length) err.value = t('autopublish.dry.publishAllRefused', { list: r.refused.map((x) => `${x.shot} ${x.version}: ${x.reason}`).join('; ') }); return '' } catch (x) { return errorText(x) }
  } })
}
async function copy() {
  busy.value = true; err.value = ''
  try { const r = await ap.dryRunReport(); await navigator.clipboard.writeText(r.text); copied.value = true; setTimeout(() => (copied.value = false), 2000) } catch (e) { err.value = errorText(e) } finally { busy.value = false }
}
</script>
