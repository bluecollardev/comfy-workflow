<template>
  <div data-testid="settings-publishing">
    <BAlert :model-value="true" variant="info" class="small py-2 mb-3" data-testid="publish-settings-note"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('publish.note') }}</BAlert>
    <div v-if="store.old" class="alert alert-info small" data-testid="publish-settings-restart">{{ $t('publish.restart') }}</div>
    <template v-else-if="form">
      <!-- S3 -->
      <div class="border rounded p-3 mb-3" data-testid="publish-s3-block">
        <div class="d-flex align-items-center gap-2 mb-2"><span class="fw-semibold">{{ $t('publish.s3.title') }}</span>
          <span class="badge" :class="store.settings.s3.ready ? 'text-bg-success' : 'text-bg-secondary'" data-testid="publish-s3-ready">{{ store.settings.s3.ready ? $t('publish.ready') : $t('publish.notReady') }}</span>
          <span v-if="store.settings.s3.problem && !store.settings.s3.ready" class="small text-warning" data-testid="publish-s3-problem">{{ store.settings.s3.problem }}</span>
          <BButton v-if="store.settings.s3.problem && !store.settings.s3.ready && form.s3.credentials === 'panama'" size="sm" variant="outline-light" data-testid="publish-s3-open-panama" @click="openPanama">{{ $t('publish.s3.openPanama') }}</BButton></div>
        <div v-if="store.settings.s3.note" class="small text-body-secondary mb-2" data-testid="publish-s3-note">{{ store.settings.s3.note }}</div>
        <BRow class="g-2">
          <BCol md="6"><BFormGroup :label="$t('publish.s3.bucket')" label-for="pub-bucket"><BFormInput id="pub-bucket" v-model.trim="form.s3.bucket" size="sm" class="font-monospace" data-testid="publish-s3-bucket" /><div v-if="fieldError('s3', 'bucket')" class="text-danger small" data-testid="publish-field-error" data-field="s3.bucket">{{ fieldError('s3', 'bucket') }}</div></BFormGroup></BCol>
          <BCol md="6"><BFormGroup :label="$t('publish.s3.prefix')" label-for="pub-prefix"><BFormInput id="pub-prefix" v-model.trim="form.s3.prefix" size="sm" class="font-monospace" data-testid="publish-s3-prefix" /><div v-if="fieldError('s3', 'prefix')" class="text-danger small" data-testid="publish-field-error" data-field="s3.prefix">{{ fieldError('s3', 'prefix') }}</div></BFormGroup></BCol>
          <BCol md="12"><div class="small text-body-secondary font-monospace" data-testid="publish-s3-preview">{{ dest ? $t('publish.s3.preview', { dest }) : '' }}</div></BCol>
          <BCol md="4"><BFormGroup :label="$t('publish.s3.region')" label-for="pub-region"><BFormInput id="pub-region" v-model.trim="form.s3.region" size="sm" class="font-monospace" data-testid="publish-s3-region" /></BFormGroup></BCol>
          <BCol md="4"><BFormGroup :label="$t('publish.s3.presign')" label-for="pub-presign"><BFormInput id="pub-presign" v-model.number="form.s3.presign_hours" type="number" min="1" size="sm" data-testid="publish-s3-presign" /><div v-if="fieldError('s3', 'presign_hours')" class="text-danger small" data-testid="publish-field-error" data-field="s3.presign_hours">{{ fieldError('s3', 'presign_hours') }}</div></BFormGroup></BCol>
          <BCol md="12"><details><summary class="small text-body-secondary">{{ $t('publish.s3.advanced') }}</summary><BFormGroup :label="$t('publish.s3.endpoint')" label-for="pub-endpoint" class="mt-1"><BFormInput id="pub-endpoint" v-model.trim="form.s3.endpoint" size="sm" class="font-monospace" placeholder="https://" data-testid="publish-s3-endpoint" /></BFormGroup></details></BCol>
          <BCol md="12">
            <div class="small fw-semibold">{{ $t('publish.s3.credentials') }}</div>
            <div class="form-check form-check-inline"><input id="pub-cred-app" v-model="form.s3.credentials" type="radio" value="app" class="form-check-input" data-testid="publish-s3-cred-app" /><label for="pub-cred-app" class="form-check-label">{{ $t('publish.s3.credApp') }}</label></div>
            <div class="form-check form-check-inline"><input id="pub-cred-panama" v-model="form.s3.credentials" type="radio" value="panama" class="form-check-input" data-testid="publish-s3-cred-panama" /><label for="pub-cred-panama" class="form-check-label">{{ $t('publish.s3.credPanama') }}</label></div>
          </BCol>
          <template v-if="form.s3.credentials === 'app'">
            <BCol md="6"><BFormGroup :label="$t('publish.s3.accessKey')" label-for="pub-ak"><BFormInput id="pub-ak" v-model.trim="secrets.access_key_id" type="password" autocomplete="off" size="sm" class="font-monospace" :placeholder="keyHint" data-testid="publish-s3-access-key" /></BFormGroup></BCol>
            <BCol md="6"><BFormGroup :label="$t('publish.s3.secretKey')" label-for="pub-sk"><BFormInput id="pub-sk" v-model.trim="secrets.secret_access_key" type="password" autocomplete="off" size="sm" class="font-monospace" :placeholder="keyHint" data-testid="publish-s3-secret-key" /></BFormGroup>
              <BButton v-if="store.settings.s3.access_key_hint" variant="link" size="sm" class="p-0 text-danger" data-testid="publish-s3-clear" @click="clear('s3_keys')">{{ $t('publish.s3.clearKeys') }}</BButton></BCol>
          </template>
        </BRow>
        <div v-if="blockError('s3')" class="text-danger small mt-1" data-testid="publish-error-s3">{{ blockError('s3') }}</div>
        <div class="d-flex align-items-center gap-2 mt-2"><BButton size="sm" variant="outline-light" :disabled="testing === 's3' || dirty" data-testid="publish-s3-test" @click="runTest('s3')"><BSpinner v-if="testing === 's3'" small class="me-1" />{{ $t('publish.s3.test') }}</BButton>
          <span v-if="dirty" class="small text-body-secondary" data-testid="publish-save-first">{{ $t('publish.saveFirst') }}</span><span v-if="results.s3" class="small" :class="results.s3.ok ? 'text-success' : 'text-danger'" data-testid="publish-s3-test-result">{{ results.s3.ok ? $t('publish.s3.testOk', { detail: results.s3.detail }) : results.s3.detail }}</span></div>
      </div>
      <!-- Slack is connected in Connect > Slack: here only its state -->
      <div class="border rounded p-3 mb-3 d-flex align-items-center gap-2 flex-wrap" data-testid="publish-slack-status">
        <span :class="store.settings.slack.ready ? 'text-success' : 'text-body-secondary'" data-testid="publish-slack-status-text">{{ store.settings.slack.ready ? $t('publish.slackStatus.connected', { workspace: store.settings.slack.workspace_name || 'Slack', channel: store.settings.slack.channel }) : $t('publish.slackStatus.notConnected') }}</span>
        <BButton size="sm" variant="outline-light" data-testid="publish-slack-open-connect" @click="openConnect">{{ $t('publish.slackStatus.open') }}</BButton>
      </div>
      <!-- defaults -->
      <div class="border rounded p-3 mb-3" data-testid="publish-defaults-block">
        <div class="fw-semibold mb-2">{{ $t('publish.defaults.title') }}</div>
        <div class="small mb-2"><span class="me-3">{{ $t('publish.defaults.targets') }}</span>
          <label class="me-3"><input v-model="form.defaults.targets" type="checkbox" value="s3" class="form-check-input me-1" data-testid="publish-default-s3" />S3</label>
          <label><input v-model="form.defaults.targets" type="checkbox" value="slack" class="form-check-input me-1" data-testid="publish-default-slack" />Slack</label></div>
        <BFormGroup :label="$t('publish.defaults.transfer')" label-for="pub-transfer" class="mb-2"><BFormSelect id="pub-transfer" v-model="form.s3.transfer" size="sm" class="w-auto" :options="transferOptions" data-testid="publish-transfer" /><div class="form-text" data-testid="publish-transfer-help">{{ $t('publish.defaults.transferHelp') }}</div></BFormGroup>
        <BFormGroup :label="$t('publish.defaults.message')" label-for="pub-msg"><textarea id="pub-msg" v-model="form.defaults.message" class="form-control form-control-sm font-monospace" rows="3" data-testid="publish-default-message"></textarea></BFormGroup>
        <div class="form-text" data-testid="publish-placeholders">{{ $t('publish.defaults.placeholders', { list: placeholderList }) }}</div>
        <div v-if="unknown.length" class="text-warning small" data-testid="publish-unknown-placeholder">{{ $t('publish.unknownPlaceholder', { list: unknownList }) }}</div>
        <div v-if="blockError('defaults')" class="text-danger small mt-1" data-testid="publish-error-defaults">{{ blockError('defaults') }}</div>
      </div>
      <div v-if="error && !errField" class="small text-danger" data-testid="publish-settings-error">{{ error }}</div>
    </template>
  </div>
</template>

<script setup>
/**
 * PublishSettings: the app-wide Publishing section of Default Configuration (S3 bucket and directory, Slack workspace and webhook, the defaults of a publish). Secrets are write-only:
 * the fields start empty, the saved ones show only as a hint, and an empty field keeps the stored value; Clear removes it. Test buttons check the bucket (read only) and post one Slack test message after a confirm.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { usePublishStore } from '../stores/publish'
import { useUiStore } from '../stores/ui'
import { useConfirmStore } from '../stores/confirm'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { PLACEHOLDERS, s3Dest, unknownPlaceholders } from '../utils/publish'
import { publishAPI } from '../api/publish'

const store = usePublishStore(), confirm = useConfirmStore()
const form = ref(null)
const secrets = reactive({ access_key_id: '', secret_access_key: '' })
const ui = useUiStore()
const openConnect = () => { ui.connectTab = 'slack'; ui.connectOpen = true }
const openPanama = () => { ui.configFocus = 'panama'; ui.configOpen = true }
const saving = ref(false), error = ref(''), errField = ref(''), testing = ref('')
const results = reactive({})
const dest = computed(() => s3Dest(form.value?.s3.bucket, form.value?.s3.prefix))
const keyHint = computed(() => (store.settings.s3.access_key_hint ? t('publish.s3.saved', { hint: store.settings.s3.access_key_hint }) : ''))
const unknown = computed(() => unknownPlaceholders(form.value?.defaults.message))
const braces = (list) => list.map((p) => '{' + p + '}').join(' ')
const placeholderList = braces(PLACEHOLDERS)
const unknownList = computed(() => braces(unknown.value))
const snapshot = ref('')
const transferOptions = computed(() => ['auto', 'pod', 'pc'].map((v) => ({ value: v, text: t(`publish.defaults.transferOption.${v}`) })))
/** Whether anything here differs from what is saved: a changed field or a secret typed. The window's one Save writes it. */
const dirty = computed(() => !!form.value && (JSON.stringify(form.value) !== snapshot.value || !!secrets.access_key_id || !!secrets.secret_access_key))
function fill() {
  const s = store.settings
  form.value = { s3: { bucket: '', prefix: '', region: '', endpoint: '', credentials: 'app', presign_hours: 72, transfer: 'auto', ...pick(s.s3, ['bucket', 'prefix', 'region', 'endpoint', 'credentials', 'presign_hours', 'transfer']) },
    defaults: { targets: [...(s.defaults.targets || [])], message: s.defaults.message || '' } }
  snapshot.value = JSON.stringify(form.value)
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]))
onMounted(async () => { await store.loadSettings(); if (!store.old) fill() })
/** A 400 names its field as `s3.bucket: …`: it shows under that field, or under its block. */
const fieldError = (block, field) => (errField.value === `${block}.${field}` ? error.value.replace(/^[\w.]+:\s*/, '') : '')
const blockError = (block) => (errField.value && errField.value.startsWith(`${block}.`) && !['s3.bucket', 's3.prefix', 's3.presign_hours', 'slack.channel', 'slack.webhook_url'].includes(errField.value) ? error.value : '')
function body(extra = {}) {
  const f = form.value
  return {
    s3: { ...f.s3, ...(secrets.access_key_id ? { access_key_id: secrets.access_key_id } : {}), ...(secrets.secret_access_key ? { secret_access_key: secrets.secret_access_key } : {}) },
    defaults: { targets: [...f.defaults.targets], message: f.defaults.message },
    ...extra,
  }
}
/** Client-side checks before anything is written; '' when fine. */
function validate() {
  const h = form.value?.s3.presign_hours
  if (h !== undefined && h !== null && h !== '' && !(Number.isInteger(Number(h)) && Number(h) >= 1)) { errField.value = 's3.presign_hours'; error.value = 's3.presign_hours: whole hours, at least 1'; return error.value }
  return ''
}
/** Writes this section (only changed secrets go with it): { ok: true } or { ok: false, error } with the core's message shown under its field. */
async function save(extra = {}) {
  saving.value = true; error.value = ''; errField.value = ''
  try { await store.save(body(extra)); secrets.access_key_id = ''; secrets.secret_access_key = ''; fill(); return { ok: true } } catch (e) { error.value = errorText(e); errField.value = /^([\w]+\.[\w]+):/.exec(error.value)?.[1] || ''; return { ok: false, error: error.value.replace(/^[\w.]+:\s*/, '') } } finally { saving.value = false }
}
defineExpose({ dirty, validate, save })
async function clear(what) {
  if (!(await confirm.ask(t('publish.clearConfirm'), { title: t(what === 's3_keys' ? 'publish.s3.clearKeys' : 'publish.slack.clearWebhook') }))) return
  await save({ clear: [what] })
}
async function runTest(target) {
  testing.value = target; delete results[target]
  try { results[target] = await publishAPI.test({ target }) } catch (e) { results[target] = { ok: false, detail: errorText(e) } } finally { testing.value = '' }
}
</script>
