<template>
  <div data-testid="slack-pane">
    <div v-if="store.old" class="alert alert-info small" data-testid="slack-restart">{{ $t('publish.restart') }}</div>
    <div v-else-if="form" class="border rounded p-3" data-testid="publish-slack-block">
      <div class="d-flex align-items-center gap-2 mb-2"><span class="fw-semibold">{{ $t('publish.slack.title') }}</span>
        <span class="badge" :class="store.settings.slack.ready ? 'text-bg-success' : 'text-bg-secondary'" data-testid="publish-slack-ready">{{ store.settings.slack.ready ? $t('publish.ready') : $t('publish.notReady') }}</span>
        <span v-if="store.settings.slack.ready" class="small text-body-secondary" data-testid="publish-slack-ready-note">{{ $t('publish.slack.readyNote') }}</span>
        <span v-if="store.settings.slack.problem && !store.settings.slack.ready" class="small text-warning" data-testid="publish-slack-problem">{{ store.settings.slack.problem }}</span></div>
      <BRow class="g-2">
        <BCol md="4"><BFormGroup :label="$t('publish.slack.workspace')" label-for="pub-ws"><BFormInput id="pub-ws" v-model.trim="form.workspace_name" size="sm" data-testid="publish-slack-workspace" /></BFormGroup></BCol>
        <BCol md="8"><BFormGroup :label="$t('publish.slack.workspaceUrl')" label-for="pub-wsu"><BFormInput id="pub-wsu" v-model.trim="form.workspace_url" size="sm" class="font-monospace" data-testid="publish-slack-workspace-url" /></BFormGroup></BCol>
        <BCol md="4"><BFormGroup :label="$t('publish.slack.channel')" label-for="pub-ch"><BFormInput id="pub-ch" v-model.trim="form.channel" size="sm" class="font-monospace" placeholder="#" data-testid="publish-slack-channel" /><div class="form-text" data-testid="publish-slack-channel-hint">{{ $t('publish.slack.channelHint') }}</div><div v-if="fieldError('channel')" class="text-danger small" data-testid="publish-field-error" data-field="slack.channel">{{ fieldError('channel') }}</div></BFormGroup></BCol>
        <BCol md="4"><BFormGroup :label="$t('publish.slack.username')" label-for="pub-un"><BFormInput id="pub-un" v-model.trim="form.username" size="sm" data-testid="publish-slack-username" /><div class="form-text" data-testid="publish-slack-username-hint">{{ $t('publish.slack.usernameHint') }}</div></BFormGroup></BCol>
        <BCol md="12"><BFormGroup :label="$t('publish.slack.webhook')" label-for="pub-wh"><BFormInput id="pub-wh" v-model.trim="webhook" type="password" autocomplete="off" size="sm" class="font-monospace" :placeholder="store.settings.slack.webhook_hint ? $t('publish.s3.saved', { hint: store.settings.slack.webhook_hint }) : 'https://hooks.slack.com/services/…'" data-testid="publish-slack-webhook" /><div v-if="fieldError('webhook_url')" class="text-danger small" data-testid="publish-field-error" data-field="slack.webhook_url">{{ fieldError('webhook_url') }}</div></BFormGroup>
          <div class="form-text" data-testid="publish-slack-help">{{ $t('publish.slack.webhookHelp') }}</div>
          <details class="small mt-1" :open="!store.settings.slack.webhook_hint" data-testid="slack-howto"><summary>{{ $t('publish.slack.howtoTitle') }}</summary>
            <div data-testid="slack-howto-1">{{ $t('publish.slack.howto1') }}</div><div>{{ $t('publish.slack.howto2') }}</div><div>{{ $t('publish.slack.howto3') }}</div><div>{{ $t('publish.slack.howto4') }}</div>
            <div class="text-body-secondary mt-1" data-testid="slack-howto-admin">{{ $t('publish.slack.howtoAdmin') }}</div></details>
          <BButton v-if="store.settings.slack.webhook_hint" variant="link" size="sm" class="p-0 text-danger" data-testid="publish-slack-clear" @click="clear">{{ $t('publish.slack.clearWebhook') }}</BButton></BCol>
      </BRow>
      <div v-if="hasPreview" class="mt-2" data-testid="slack-preview-block">
        <label class="d-flex align-items-center gap-2 small mb-0"><input v-model="form.preview_frame" type="checkbox" class="form-check-input mt-0" data-testid="slack-preview-frame" />{{ $t('publish.preview.setting') }}</label>
        <div class="form-text" data-testid="slack-preview-help">{{ $t('publish.preview.help') }}</div>
      </div>
      <div v-if="hasVolumeSource" class="mt-2" data-testid="slack-volume-block">
        <label class="d-flex align-items-center gap-2 small mb-0"><input v-model="form.volume_source" type="checkbox" class="form-check-input mt-0" data-testid="slack-volume-source" />{{ $t('publish.volumeSource.setting') }}</label>
        <div class="form-text" data-testid="slack-volume-help">{{ $t('publish.volumeSource.help') }}</div>
      </div>
      <div v-if="hasPerShot" class="mt-2" data-testid="slack-per-shot-block">
        <label class="d-flex align-items-center gap-2 small mb-0"><input v-model="form.per_shot" type="checkbox" class="form-check-input mt-0" data-testid="slack-per-shot" />{{ $t('publish.ret.perShot') }}</label>
        <div class="form-text" data-testid="slack-per-shot-help">{{ $t('publish.ret.perShotHelp') }}</div>
      </div>
      <div v-if="hasLinks" class="mt-2 border rounded p-2" data-testid="slack-links">
        <div class="small fw-semibold">{{ $t('publish.links.title') }}</div>
        <label class="d-flex align-items-center gap-2 small mb-0"><input v-model="form.folder_link" type="checkbox" class="form-check-input mt-0" data-testid="slack-folder-link" />{{ $t('publish.links.folder') }}</label>
        <div class="form-text mt-0 ms-4" data-testid="slack-folder-link-help">{{ $t('publish.links.folderHelp') }}</div>
        <div class="d-flex align-items-center gap-2 flex-wrap mt-1"><label class="d-flex align-items-center gap-2 small mb-0"><input v-model="form.file_links" type="checkbox" class="form-check-input mt-0" data-testid="slack-file-links" />{{ $t('publish.links.files') }}</label>
          <label class="small mb-0 d-flex align-items-center gap-1">{{ $t('publish.links.firstN') }}<BFormInput v-model.number="form.file_link_count" type="number" min="1" max="25" size="sm" style="width: 5.5rem" :disabled="!form.file_links" data-testid="slack-file-link-count" /></label></div>
        <div v-if="countBad" class="text-danger small" data-testid="slack-file-link-count-error">{{ $t('publish.links.countBad') }}</div>
        <div class="form-text mt-0 ms-4" data-testid="slack-file-links-help">{{ $t('publish.links.filesHelp') }}</div>
      </div>
      <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
        <BButton variant="primary" size="sm" :disabled="saving" data-testid="publish-slack-save" @click="save()"><BSpinner v-if="saving" small class="me-1" />{{ $t('publish.save') }}</BButton>
        <span v-if="savedFlag" class="small text-success" data-testid="publish-slack-saved">{{ $t('publish.saved') }}</span>
        <span v-if="error && !errField" class="small text-danger" data-testid="publish-slack-error">{{ error }}</span>
        <BButton size="sm" variant="outline-light" :disabled="testing || dirty" data-testid="publish-slack-test" @click="runTest"><BSpinner v-if="testing" small class="me-1" />{{ $t('publish.slack.test') }}</BButton>
        <span v-if="dirty" class="small text-body-secondary" data-testid="publish-slack-save-first">{{ $t('publish.saveFirst') }}</span>
        <span v-if="result" class="small" :class="result.ok ? 'text-success' : 'text-danger'" data-testid="publish-slack-test-result">{{ result.ok ? $t('publish.slack.testOk', { detail: result.detail }) : result.detail }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * SlackPane: the Slack connection (Connect > Slack): the Beinghuman workspace (defaults baked in by the core, editable), the channel, the name posts carry and the Incoming Webhook URL.
 * The webhook is write-only: the field starts empty, the saved one shows only as a hint, an empty field keeps it, Clear removes it. Send a test message asks first.
 */
import { computed, onMounted, ref } from 'vue'
import { usePublishStore } from '../stores/publish'
import { useConfirmStore } from '../stores/confirm'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { channelName } from '../utils/publish'
import { publishAPI } from '../api/publish'

const store = usePublishStore(), confirm = useConfirmStore()
const form = ref(null), webhook = ref('')
const hasPerShot = computed(() => typeof store.settings.slack?.per_shot === 'boolean')   // an older core posts one message per publish
const hasLinks = computed(() => typeof store.settings.slack?.file_links === 'boolean')   // an older core has no link settings
const countBad = computed(() => hasLinks.value && !!form.value && form.value.file_links && !(Number.isInteger(form.value.file_link_count) && form.value.file_link_count >= 1 && form.value.file_link_count <= 25))
const hasVolumeSource = computed(() => typeof store.settings.slack?.volume_source === 'boolean')   // an older core has no volume-source setting
const hasPreview = computed(() => typeof store.settings.slack?.preview_frame === 'boolean')   // an older core has no preview setting
const saving = ref(false), savedFlag = ref(false), error = ref(''), errField = ref(''), testing = ref(false), result = ref(null)
/** Edited and not saved: the test acts on the saved settings, so it waits for Save. */
const dirty = computed(() => { const s = store.settings.slack, f = form.value; return !!f && (!!webhook.value || f.workspace_name !== (s.workspace_name || 'Beinghuman') || f.workspace_url !== (s.workspace_url || 'https://beinghuman-hq.slack.com') || (f.channel || '') !== (s.channel || '') || (f.username || '') !== (s.username || '') || (hasPreview.value && f.preview_frame !== (s.preview_frame !== false)) || (hasVolumeSource.value && f.volume_source !== (s.volume_source !== false)) || (hasPerShot.value && f.per_shot !== (s.per_shot !== false)) || (hasLinks.value && (f.file_links !== (s.file_links !== false) || f.folder_link !== (s.folder_link !== false) || f.file_link_count !== (s.file_link_count ?? 10)))) })
function fill() { const s = store.settings.slack; form.value = { workspace_name: s.workspace_name || 'Beinghuman', workspace_url: s.workspace_url || 'https://beinghuman-hq.slack.com', channel: s.channel || '', username: s.username || '', ...(typeof s.preview_frame === 'boolean' ? { preview_frame: s.preview_frame } : {}), ...(typeof s.volume_source === 'boolean' ? { volume_source: s.volume_source } : {}), ...(typeof s.per_shot === 'boolean' ? { per_shot: s.per_shot } : {}), ...(typeof s.file_links === 'boolean' ? { file_links: s.file_links, folder_link: s.folder_link !== false, file_link_count: s.file_link_count ?? 10 } : {}) } }
onMounted(async () => { await store.loadSettings(); if (!store.old) fill() })
const fieldError = (f) => (errField.value === `slack.${f}` ? error.value.replace(/^[\w.]+:\s*/, '') : '')
async function save(extra = {}) {
  if (countBad.value) return   // the number says why, next to the field
  saving.value = true; savedFlag.value = false; error.value = ''; errField.value = ''
  try { await store.save({ slack: { ...form.value, channel: form.value.channel ? channelName(form.value.channel) : '', ...(webhook.value ? { webhook_url: webhook.value } : {}) }, ...extra }); webhook.value = ''; fill(); savedFlag.value = true } catch (e) { error.value = errorText(e); errField.value = /^([\w]+\.[\w]+):/.exec(error.value)?.[1] || '' } finally { saving.value = false }
}
async function clear() {
  if (!(await confirm.ask(t('publish.clearConfirm'), { title: t('publish.slack.clearWebhook') }))) return
  await save({ clear: ['slack_webhook'] })
}
async function runTest() {
  const ch = channelName(form.value.channel) || t('publish.notConfigured')
  if (!(await confirm.ask(t('publish.slack.testConfirm', { channel: ch, workspace: form.value.workspace_name || 'Slack' }), { title: t('publish.slack.test'), danger: false }))) return
  testing.value = true; result.value = null
  try { result.value = await publishAPI.test({ target: 'slack' }) } catch (e) { result.value = { ok: false, detail: errorText(e) } } finally { testing.value = false }
}
</script>
