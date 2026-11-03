<template>
  <div class="card mb-3 cfg-io" :class="{ 'cfg-io-flash': flash }" data-testid="cfg-io-panel" ref="root">
    <div class="card-body py-2 small">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <strong><i class="fa-solid fa-file-export me-1"></i>{{ $t('configio.title') }}</strong>
        <span class="text-body-secondary flex-grow-1">{{ $t('configio.hint') }}</span>
        <BButton size="sm" variant="outline-light" class="text-nowrap" :disabled="busy" data-testid="cfg-io-export" @click="doExport"><i class="fa-solid fa-download me-1"></i>{{ $t('configio.export') }}</BButton>
        <BButton size="sm" variant="outline-light" class="text-nowrap" :disabled="busy" data-testid="cfg-io-import" @click="choose"><i class="fa-solid fa-upload me-1"></i>{{ $t('configio.import') }}</BButton>
        <BButton v-if="canUndo" size="sm" variant="outline-warning" class="text-nowrap" :disabled="busy" :title="$t('configio.undoHint')" data-testid="cfg-io-undo" @click="undo"><i class="fa-solid fa-rotate-left me-1"></i>{{ $t('configio.undo') }}</BButton>
        <input ref="fileInput" type="file" accept=".json,application/json" class="d-none" data-testid="cfg-io-file" @change="onFile" />
      </div>
      <div class="d-flex align-items-start gap-3 flex-wrap mt-1" data-testid="cfg-io-secrets-option">
        <BFormCheckbox :model-value="includeSecrets" class="text-nowrap" data-testid="cfg-io-include-secrets" @update:model-value="includeSecrets = $event === true">{{ $t('configio.includeSecrets') }}</BFormCheckbox>
        <div v-if="includeSecrets" class="text-danger fw-semibold flex-grow-1" data-testid="cfg-io-secrets-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('configio.secretsWarning') }}</div>
        <div v-else class="text-body-secondary flex-grow-1" data-testid="cfg-io-secrets-off"><i class="fa-solid fa-shield-halved me-1"></i>{{ $t('configio.secretsOff') }}</div>
      </div>
      <div class="text-body-secondary mt-1" data-testid="cfg-io-excluded">{{ $t('configio.excluded') }}</div>

      <BAlert v-if="error" :model-value="true" variant="danger" dismissible class="mt-2 mb-0 py-2" data-testid="cfg-io-error" @update:model-value="error = null">{{ error }}</BAlert>
      <BAlert v-if="note" :model-value="true" variant="success" dismissible class="mt-2 mb-0 py-2" data-testid="cfg-io-done" @update:model-value="note = null">{{ note }}</BAlert>

      <div v-if="plan" class="mt-2" data-testid="cfg-io-preview">
        <div v-if="!plan.ok" class="text-danger" data-testid="cfg-io-refused">
          <div v-for="(e, n) in plan.errors" :key="n"><i class="fa-solid fa-circle-xmark me-1"></i>{{ e }}</div>
          <BButton size="sm" variant="outline-light" class="mt-2" data-testid="cfg-io-cancel" @click="plan = null">{{ $t('configio.close') }}</BButton>
        </div>
        <template v-else>
          <div class="text-body-secondary mb-1" data-testid="cfg-io-source">{{ $t('configio.from', { name: fileName, version: plan.source.app_version || '?', when: plan.source.exported_at ? plan.source.exported_at.slice(0, 10) : '?' }) }}</div>
          <div v-for="(w, n) in plan.warnings" :key="`w${n}`" class="text-warning" data-testid="cfg-io-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ w }}</div>
          <div v-if="!plan.source.secrets_included && plan.source.secrets_set.length" class="text-body-secondary" data-testid="cfg-io-secrets"><i class="fa-solid fa-key me-1"></i>{{ $t('configio.secretsNone', { names: plan.source.secrets_set.join(', ') }) }}</div>
          <div v-for="s in plan.sections" :key="s.key" class="border-top py-2" :data-testid="`cfg-io-row-${s.key}`">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <BFormCheckbox :model-value="picked.has(s.key)" :disabled="!!s.error" :data-testid="`cfg-io-section-${s.key}`" @update:model-value="toggle(s.key, $event)">{{ s.label }}</BFormCheckbox>
              <BBadge :variant="s.changed ? 'info' : 'secondary'" class="fw-normal" :data-testid="`cfg-io-changed-${s.key}`">{{ s.changed ? $t('configio.changed') : $t('configio.same') }}</BBadge>
              <BBadge v-if="s.machine_specific" variant="warning" class="fw-normal" data-testid="cfg-io-machine-flag">{{ $t('configio.machine') }}</BBadge>
              <BBadge v-if="s.account_specific" variant="secondary" class="fw-normal" data-testid="cfg-io-account-flag">{{ $t('configio.account') }}</BBadge>
            </div>
            <div v-if="s.items?.length" class="ms-4 font-monospace" :data-testid="`cfg-io-items-${s.key}`">
              <div v-for="i in s.items" :key="i.name" :class="i.error ? 'text-danger' : ''" data-testid="cfg-io-secret-item" :data-name="i.name">
                <i :class="i.error ? 'fa-solid fa-circle-xmark me-1' : 'fa-solid fa-key me-1 text-body-secondary'"></i>{{ i.name }}
                <span v-if="!i.error" class="text-body-secondary" data-testid="cfg-io-secret-hint">{{ i.hint }}</span>
                <BBadge v-if="!i.error" :variant="i.changed ? 'info' : 'secondary'" class="fw-normal ms-1">{{ i.changed ? $t('configio.changed') : $t('configio.same') }}</BBadge>
                <span v-else class="ms-1" data-testid="cfg-io-secret-error">{{ i.error }}</span>
              </div>
            </div>
            <div v-if="s.error" class="text-danger ms-4" :data-testid="`cfg-io-error-${s.key}`">{{ s.error }}</div>
            <div v-else-if="s.note" class="text-body-secondary ms-4">{{ s.note }}</div>
            <details v-if="s.changed && s.key !== 'secrets'" class="ms-4">
              <summary class="text-body-secondary">{{ $t('configio.diff') }}</summary>
              <BRow class="g-2"><BCol md="6"><div class="text-body-secondary">{{ $t('configio.now') }}</div><pre class="mb-0 small bg-body-tertiary rounded p-2">{{ show(s.current) }}</pre></BCol>
                <BCol md="6"><div class="text-body-secondary">{{ $t('configio.file') }}</div><pre class="mb-0 small bg-body-tertiary rounded p-2" :data-testid="`cfg-io-incoming-${s.key}`">{{ show(s.incoming) }}</pre></BCol></BRow>
            </details>
          </div>
          <div class="d-flex gap-2 mt-2">
            <BButton size="sm" variant="primary" :disabled="busy || !picked.size" data-testid="cfg-io-apply" @click="apply"><BSpinner v-if="busy" small class="me-1" />{{ $t('configio.apply', { n: picked.size }) }}</BButton>
            <BButton size="sm" variant="outline-light" :disabled="busy" data-testid="cfg-io-cancel" @click="plan = null">{{ $t('configio.cancel') }}</BButton>
            <span class="text-body-secondary align-self-center">{{ $t('configio.backupNote') }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * ConfigIoPanel — export and import of the Default Configuration as one JSON file (docs/ADR-023). Export saves it with the native Save dialog; Import opens the
 * native Open dialog, asks the core to PLAN the import (nothing is written), shows each section the file carries with what changes, and writes only the sections
 * that are ticked, after a backup, with an Undo. The file carries the keys and tokens unless 'Include keys and tokens' is unticked; the preview shows each only by its last four characters. Without Electron (a browser) the file is a download and an <input type=file>.
 */
import { onMounted, ref } from 'vue'
import { configioAPI, hasNativeFiles, openTextFile, saveTextFile } from '../api/configio'
import { useToastStore, errorText } from '../stores/toast'
import { t } from '../i18n'

const props = defineProps({ flash: Boolean })
const emit = defineEmits(['applied'])
const toast = useToastStore()
const busy = ref(false)
const error = ref(null)
const note = ref(null)
const plan = ref(null)
const file = ref(null)          // the parsed file, held to send back on Apply
const fileName = ref('')
const picked = ref(new Set())
const includeSecrets = ref(true)   // keys and tokens go into the file unless this is unticked (ADR-023)
const canUndo = ref(false)
const fileInput = ref(null)
const root = ref(null)

const show = (v) => JSON.stringify(v, null, 2)
const toggle = (key, on) => { const s = new Set(picked.value); on ? s.add(key) : s.delete(key); picked.value = s }
const refreshUndo = async () => { try { canUndo.value = (await configioAPI.backups()).length > 0 } catch { canUndo.value = false } }

async function doExport() {
  error.value = null; note.value = null; busy.value = true
  try {
    const data = await configioAPI.export(includeSecrets.value === true)   // an explicit boolean: unticked must never read as "not given"
    const r = await saveTextFile(await configioAPI.suggestedName(), JSON.stringify(data, null, 2) + '\n')
    if (r && !r.canceled) toast.success(t(includeSecrets.value ? 'configio.savedWithKeys' : 'configio.saved', { where: r.path }))
  } catch (e) { error.value = errorText(e) } finally { busy.value = false }
}

async function choose() {
  error.value = null; note.value = null
  if (hasNativeFiles()) {
    busy.value = true
    try { const r = await openTextFile(); if (r && !r.canceled) await review(r.name, r.text) } catch (e) { error.value = errorText(e) } finally { busy.value = false }
  } else fileInput.value?.click()
}
async function onFile(ev) {
  const f = ev.target.files?.[0]
  ev.target.value = ''   // the same file can be chosen again
  if (!f) return
  try { await review(f.name, await f.text()) } catch (e) { error.value = errorText(e) }
}

/** Parse the text, ask the core for a plan (nothing is written), and show it. */
async function review(name, text) {
  plan.value = null; file.value = null; fileName.value = name
  let obj
  try { obj = JSON.parse(text) } catch (e) { error.value = t('configio.notJson', { name, error: e.message }); return }
  busy.value = true
  try {
    const p = await configioAPI.plan(obj)
    file.value = obj; plan.value = p
    picked.value = new Set(p.ok ? p.sections.filter((s) => s.default_checked).map((s) => s.key) : [])
  } catch (e) { error.value = errorText(e) } finally { busy.value = false }
}

async function apply() {
  busy.value = true; error.value = null
  try {
    const r = await configioAPI.apply(file.value, [...picked.value])
    note.value = t('configio.applied', { n: r.applied.length, sections: r.applied.join(', ') }) + (r.skipped?.length ? ' ' + t('configio.skipped', { names: r.skipped.join(', ') }) : '')
    plan.value = null; file.value = null
    await refreshUndo()
    emit('applied', r)
  } catch (e) { error.value = errorText(e) } finally { busy.value = false }
}

async function undo() {
  busy.value = true; error.value = null
  try { const r = await configioAPI.undo(); note.value = t('configio.undone', { name: r.restored }); await refreshUndo(); emit('applied', r) }
  catch (e) { error.value = errorText(e) } finally { busy.value = false }
}

defineExpose({ el: root })
onMounted(refreshUndo)
</script>

<style scoped>
.cfg-io-flash { animation: cfg-io-flash 1.6s ease-out 1; }
@keyframes cfg-io-flash { 0% { box-shadow: 0 0 0 3px var(--bs-primary); } 100% { box-shadow: 0 0 0 0 transparent; } }
</style>
