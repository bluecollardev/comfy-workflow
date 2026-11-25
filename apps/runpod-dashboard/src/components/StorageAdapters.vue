<template>
  <div data-testid="storage-adapters">
    <BAlert :model-value="true" variant="info" class="small py-2 mb-3"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('storage.hint') }}</BAlert>
    <div v-if="old" class="alert alert-info small" data-testid="storage-restart">{{ restart }}</div>
    <BAlert v-if="error" :model-value="true" variant="danger" dismissible class="small py-2" data-testid="storage-error" @update:model-value="error = ''">{{ error }}</BAlert>
    <div class="d-flex align-items-center mb-2">
      <span class="small text-body-secondary" data-testid="storage-count">{{ $t('storage.count', { n: adapters.length }) }}</span>
      <BButton size="sm" variant="outline-light" class="ms-auto text-nowrap" data-testid="storage-add" @click="startAdd"><i class="fa-solid fa-plus me-1"></i>{{ $t('storage.add') }}</BButton>
    </div>

    <div v-for="a in adapters" :key="a.id" class="border rounded p-2 mb-2" data-testid="storage-card" :data-id="a.id" :data-enabled="a.enabled ? 'true' : 'false'">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <BFormCheckbox :key="`${a.id}:${gen}`" :model-value="a.enabled" switch class="mb-0" :aria-label="$t('storage.switch', { name: label(a) })" :disabled="busy === a.id" data-testid="storage-enabled" @update:model-value="(v) => flip(a, v)" />
        <span class="fw-semibold" data-testid="storage-name">{{ label(a) }}</span> <code class="small text-body-secondary">{{ a.id }}</code>
        <BBadge :variant="a.ready ? 'success' : 'secondary'" class="fw-normal" data-testid="storage-ready">{{ a.ready ? $t('storage.ready') : $t('storage.notReady') }}</BBadge>
        <BBadge :variant="a.builtin ? 'secondary' : 'info'" class="fw-normal">{{ a.builtin ? $t('storage.builtin') : $t('storage.yours') }}</BBadge>
        <span v-if="a.problem && !a.ready" class="small text-warning" data-testid="storage-problem">{{ a.problem }}</span>
        <span class="ms-auto small font-monospace text-body-secondary text-truncate" style="max-width: 24rem" data-testid="storage-dest">{{ dest(a) }}</span>
      </div>

      <!-- Publishing's destination: its form lives here now (the slot), the values stay where Publishing keeps them -->
      <div v-if="a.kind === 'publish'" class="mt-2" data-testid="storage-publish-body">
        <div class="small text-body-secondary mb-2">{{ $t('storage.publishHint') }}</div>
        <slot name="publish"></slot>
      </div>
      <div v-else-if="a.kind === 'panama'" class="mt-2" data-testid="storage-panama-body">
        <div class="small text-body-secondary mb-2">{{ $t('storage.panamaHint') }}</div>
        <slot name="panama"></slot>
      </div>
      <div v-else class="mt-2" :data-testid="`storage-body-${a.id}`">
        <div v-if="a.kind === 'wasabi'" class="small text-body-secondary mb-2">{{ $t('storage.wasabiHint') }}</div>
        <BRow class="g-2">
          <BCol md="6"><BFormGroup :label="$t('storage.bucket')"><BFormInput v-model.trim="forms[a.id].bucket" size="sm" class="font-monospace" data-testid="storage-bucket" /></BFormGroup></BCol>
          <BCol md="6"><BFormGroup :label="$t('storage.prefix')"><BFormInput v-model.trim="forms[a.id].prefix" size="sm" class="font-monospace" data-testid="storage-prefix" /></BFormGroup></BCol>
          <BCol md="4"><BFormGroup :label="$t('storage.region')"><BFormInput v-model.trim="forms[a.id].region" size="sm" class="font-monospace" data-testid="storage-region" /></BFormGroup></BCol>
          <BCol md="8"><BFormGroup :label="$t('storage.endpoint')" :description="$t('storage.endpointHelp')"><BFormInput v-model.trim="forms[a.id].endpoint" size="sm" class="font-monospace" :placeholder="a.endpoint || 'https://'" data-testid="storage-endpoint" /></BFormGroup></BCol>
          <BCol md="6"><BFormGroup :label="$t('storage.accessKey')"><BFormInput v-model.trim="forms[a.id].access_key_id" type="password" autocomplete="off" size="sm" class="font-monospace" :placeholder="hint(a)" data-testid="storage-access-key" /></BFormGroup></BCol>
          <BCol md="6"><BFormGroup :label="$t('storage.secretKey')"><BFormInput v-model.trim="forms[a.id].secret_access_key" type="password" autocomplete="off" size="sm" class="font-monospace" :placeholder="hint(a)" data-testid="storage-secret-key" /></BFormGroup></BCol>
        </BRow>
        <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
          <BButton size="sm" variant="primary" :disabled="busy === a.id || !changed(a)" data-testid="storage-save" @click="saveOne(a)">{{ $t('storage.save') }}</BButton>
          <BButton size="sm" variant="outline-light" :disabled="testing === a.id || changed(a)" data-testid="storage-test" @click="runTest(a)"><BSpinner v-if="testing === a.id" small class="me-1" />{{ $t('storage.test') }}</BButton>
          <BButton v-if="!a.builtin" size="sm" variant="outline-danger" data-testid="storage-delete" @click="del(a)"><i class="fa-solid fa-trash me-1"></i>{{ $t('storage.delete') }}</BButton>
          <span v-if="results[a.id]" class="small" :class="results[a.id].ok ? 'text-success' : 'text-danger'" data-testid="storage-test-result">{{ results[a.id].ok ? $t('storage.testOk', { detail: results[a.id].detail }) : $t('storage.testFail', { detail: results[a.id].detail }) }}</span>
        </div>
      </div>
    </div>

    <!-- Add Storage -->
    <div v-if="adding" class="border rounded p-2 mb-2" data-testid="storage-add-form">
      <div class="fw-semibold mb-2">{{ $t('storage.addTitle') }}</div>
      <BRow class="g-2">
        <BCol md="6"><BFormGroup :label="$t('storage.name')"><BFormInput v-model.trim="draft.name" size="sm" data-testid="storage-new-name" /></BFormGroup></BCol>
        <BCol md="6"><BFormGroup :label="$t('storage.endpoint')" :description="$t('storage.endpointHelp')"><BFormInput v-model.trim="draft.endpoint" size="sm" class="font-monospace" placeholder="https://" data-testid="storage-new-endpoint" /></BFormGroup></BCol>
        <BCol md="4"><BFormGroup :label="$t('storage.region')"><BFormInput v-model.trim="draft.region" size="sm" class="font-monospace" data-testid="storage-new-region" /></BFormGroup></BCol>
        <BCol md="4"><BFormGroup :label="$t('storage.bucket')"><BFormInput v-model.trim="draft.bucket" size="sm" class="font-monospace" data-testid="storage-new-bucket" /></BFormGroup></BCol>
        <BCol md="4"><BFormGroup :label="$t('storage.prefix')"><BFormInput v-model.trim="draft.prefix" size="sm" class="font-monospace" data-testid="storage-new-prefix" /></BFormGroup></BCol>
        <BCol md="6"><BFormGroup :label="$t('storage.accessKey')"><BFormInput v-model.trim="draft.access_key_id" type="password" autocomplete="off" size="sm" class="font-monospace" data-testid="storage-new-access-key" /></BFormGroup></BCol>
        <BCol md="6"><BFormGroup :label="$t('storage.secretKey')"><BFormInput v-model.trim="draft.secret_access_key" type="password" autocomplete="off" size="sm" class="font-monospace" data-testid="storage-new-secret-key" /></BFormGroup></BCol>
      </BRow>
      <div class="d-flex gap-2 mt-2">
        <BButton size="sm" variant="primary" :disabled="!draft.name" data-testid="storage-new-save" @click="create">{{ $t('storage.save') }}</BButton>
        <BButton size="sm" variant="outline-light" data-testid="storage-new-cancel" @click="adding = false">{{ $t('storage.cancel') }}</BButton>
      </div>
    </div>
    <div v-if="!adapters.some((a) => !a.builtin)" class="small text-body-secondary" data-testid="storage-none">{{ $t('storage.none') }}</div>
  </div>
</template>

<script setup>
/**
 * StorageAdapters — Default Configuration > Adapters > Storage (docs/ADR-063): every S3-compatible storage with its on/off switch. The publish destination's form is the
 * `publish` slot (it keeps saving with the window's one Save), Panama's form (the BH bucket keys, bucket, region, profile and pull on start) is the `panama` slot, Wasabi and the ones you add are edited here.
 */
import { onMounted, reactive, ref } from 'vue'
import { storageAPI, RESTART } from '../api/storage'
import { useConfirmStore } from '../stores/confirm'
import { errorText } from '../stores/toast'
import { t } from '../i18n'

const confirm = useConfirmStore()
const adapters = ref([]), old = ref(false), error = ref(''), busy = ref(''), testing = ref(''), adding = ref(false)
const restart = RESTART, gen = ref(0)   // a refused switch re-draws the checkbox so it shows what is saved
const forms = reactive({}), results = reactive({})
const draft = reactive({ name: '', endpoint: '', region: '', bucket: '', prefix: '', access_key_id: '', secret_access_key: '' })
const FIELDS = ['bucket', 'prefix', 'region', 'endpoint']
const label = (a) => (a.kind === 'publish' ? t('storage.publishName') : a.kind === 'panama' ? t('storage.panamaName') : a.name)
const dest = (a) => (a.bucket ? `s3://${a.bucket}/${a.prefix || ''}${a.endpoint ? `  ·  ${a.endpoint}` : ''}` : '')
const hint = (a) => (a.key_hint ? t('storage.keysSaved', { hint: a.key_hint }) : '')
function fill(list) {
  adapters.value = list
  for (const a of list) if (a.kind === 'wasabi' || a.kind === 'custom') forms[a.id] = { ...Object.fromEntries(FIELDS.map((k) => [k, k === 'endpoint' ? (a.builtin ? '' : a.endpoint) : a[k] || ''])), access_key_id: '', secret_access_key: '' }
}
const load = async () => { try { const r = await storageAPI.list(); old.value = r.old; fill(r.adapters) } catch (e) { error.value = errorText(e) } }
onMounted(load)
defineExpose({ load })
const changed = (a) => { const f = forms[a.id]; return !!f && (!!f.access_key_id || !!f.secret_access_key || FIELDS.some((k) => f[k] !== (k === 'endpoint' ? (a.builtin ? '' : a.endpoint) : a[k] || ''))) }
async function flip(a, on) {
  busy.value = a.id; error.value = ''
  try { fill((await storageAPI.setEnabled(a.id, on)).adapters) } catch (e) { error.value = errorText(e); gen.value++; await load() } finally { busy.value = '' }
}
async function saveOne(a) {
  busy.value = a.id; error.value = ''
  const f = forms[a.id]
  try { const r = await storageAPI.save({ id: a.id, ...Object.fromEntries(FIELDS.map((k) => [k, f[k]])), ...(f.access_key_id ? { access_key_id: f.access_key_id } : {}), ...(f.secret_access_key ? { secret_access_key: f.secret_access_key } : {}) }); delete results[a.id]; fill(r.adapters) } catch (e) { error.value = errorText(e) } finally { busy.value = '' }
}
async function runTest(a) {
  testing.value = a.id; delete results[a.id]
  try { results[a.id] = await storageAPI.test(a.id) } catch (e) { results[a.id] = { ok: false, detail: errorText(e) } } finally { testing.value = '' }
}
async function del(a) {
  if (!(await confirm.ask(t('storage.confirmDelete', { name: a.name }), { title: t('storage.delete') }))) return
  try { fill((await storageAPI.remove(a.id)).adapters) } catch (e) { error.value = errorText(e) }
}
const startAdd = () => { Object.assign(draft, { name: '', endpoint: '', region: '', bucket: '', prefix: '', access_key_id: '', secret_access_key: '' }); adding.value = true }
async function create() {
  error.value = ''
  try { const r = await storageAPI.save({ ...draft }); adding.value = false; fill(r.adapters) } catch (e) { error.value = errorText(e) }
}
</script>
