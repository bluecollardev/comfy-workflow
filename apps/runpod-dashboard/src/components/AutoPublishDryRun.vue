<template>
  <div v-if="show" class="border rounded p-2 mb-2" data-testid="autopublish-dryrun-panel">
    <div class="fw-semibold">{{ $t('autopublish.dry.title') }}</div>
    <div class="small" data-testid="autopublish-dryrun-line">{{ $t('autopublish.dry.line', { n: plans.length, files: files.toLocaleString('en-US'), size: sizeText, dest, n_min: status.window_minutes ?? 10 }) }}</div>
    <div class="small text-body-secondary" data-testid="autopublish-dryrun-slack">{{ slackLine }}</div>
    <div class="d-flex align-items-center gap-2 flex-wrap mt-1">
      <BButton size="sm" variant="outline-light" :disabled="busy" data-testid="autopublish-dryrun-copy" @click="copy"><BSpinner v-if="busy" small class="me-2" />{{ copied ? $t('autopublish.dry.copied') : $t('autopublish.dry.copy') }}</BButton>
      <span class="small text-body-secondary" data-testid="autopublish-dryrun-hint">{{ $t('autopublish.dry.hint') }}</span>
    </div>
    <div v-if="err" class="small text-danger" data-testid="autopublish-dryrun-error">{{ err }}</div>
  </div>
</template>

<script setup>
/** AutoPublishDryRun: while Auto-publish is in a dry run, what it WOULD do in one panel: N review videos, files and size, the S3 destination, the Slack summary state and the text to copy. Hidden when the core gives no dry-run plans. */
import { computed, ref } from 'vue'
import { useAutopublishStore } from '../stores/autopublish'
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
const busy = ref(false), copied = ref(false), err = ref('')
async function copy() {
  busy.value = true; err.value = ''
  try { const r = await ap.dryRunReport(); await navigator.clipboard.writeText(r.text); copied.value = true; setTimeout(() => (copied.value = false), 2000) } catch (e) { err.value = errorText(e) } finally { busy.value = false }
}
</script>
