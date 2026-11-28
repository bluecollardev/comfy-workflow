<template>
  <div ref="rootRef" class="border rounded p-2 mb-2" data-testid="storage-add-form">
    <div class="fw-semibold mb-2">{{ $t('storage.addTitle') }}</div>
    <div v-if="!hideType" class="d-flex gap-3 mb-2" data-testid="storage-new-type">
      <label class="small"><input v-model="draftType" type="radio" value="wasabi" class="form-check-input me-1" data-testid="storage-new-type-wasabi" />{{ $t('storage.typeWasabi') }}</label>
      <label class="small"><input v-model="draftType" type="radio" value="s3" class="form-check-input me-1" data-testid="storage-new-type-s3" />{{ $t('storage.typeS3') }}</label>
    </div>
    <BRow class="g-2">
      <BCol md="6"><BFormGroup :label="$t('storage.name')"><BFormInput v-model.trim="draft.name" size="sm" data-testid="storage-new-name" /></BFormGroup></BCol>
      <BCol v-if="draftType === 's3'" md="6"><BFormGroup :label="$t('storage.endpoint')" :description="$t('storage.endpointHelp')"><BFormInput v-model.trim="draft.endpoint" size="sm" class="font-monospace" placeholder="https://" data-testid="storage-new-endpoint" /></BFormGroup></BCol>
      <BCol md="4"><BFormGroup :label="$t('storage.region')"><BFormInput v-model.trim="draft.region" size="sm" class="font-monospace" data-testid="storage-new-region" /></BFormGroup></BCol>
      <BCol md="4"><BFormGroup :label="$t('storage.bucket')"><BFormInput v-model.trim="draft.bucket" size="sm" class="font-monospace" data-testid="storage-new-bucket" /></BFormGroup></BCol>
      <BCol md="4"><BFormGroup :label="$t('storage.prefix')"><BFormInput v-model.trim="draft.prefix" size="sm" class="font-monospace" data-testid="storage-new-prefix" /></BFormGroup></BCol>
      <BCol md="6"><BFormGroup :label="$t('storage.accessKey')"><BFormInput v-model.trim="draft.access_key_id" type="password" autocomplete="off" size="sm" class="font-monospace" data-testid="storage-new-access-key" /></BFormGroup></BCol>
      <BCol md="6"><BFormGroup :label="$t('storage.secretKey')"><BFormInput v-model.trim="draft.secret_access_key" type="password" autocomplete="off" size="sm" class="font-monospace" data-testid="storage-new-secret-key" /></BFormGroup></BCol>
    </BRow>
    <div v-if="help" class="form-text" data-testid="storage-new-help">{{ help }}</div>
    <div class="d-flex gap-2 mt-2">
      <BButton size="sm" variant="primary" :disabled="!draft.name" data-testid="storage-new-save" @click="create">{{ $t('storage.save') }}</BButton>
      <BButton size="sm" variant="outline-light" data-testid="storage-new-cancel" @click="$emit('cancel')">{{ $t('storage.cancel') }}</BButton>
    </div>
  </div>
</template>

<script setup>
/**
 * StorageAddForm: the Add Storage form (Wasabi or any S3-compatible storage), shared by Configuration > Storage and the Network Volumes window.
 * It links a bucket that already exists; it makes none. Saves through storageAPI.save, puts the new storage first, and emits `saved` with the list and the new id (or `error` with the reason).
 */
import { nextTick, onMounted, reactive, ref, watch } from 'vue'
import { storageAPI } from '../api/storage'
import { errorText } from '../stores/toast'

const props = defineProps({ help: { type: String, default: '' }, /** the type chosen outside (the Network Volumes window's first choice): then the form has no radios of its own */ type: { type: String, default: 'wasabi' }, hideType: { type: Boolean, default: false } })
const emit = defineEmits(['saved', 'cancel', 'error'])
const rootRef = ref(null), draftType = ref(props.type)
const draft = reactive({ name: '', endpoint: '', region: '', bucket: '', prefix: '', access_key_id: '', secret_access_key: '' })
watch(() => props.type, (v) => { draftType.value = v })
const wasabiEndpoint = (region) => (!region || region === 'us-east-1' ? 'https://s3.wasabisys.com' : `https://s3.${region}.wasabisys.com`)
onMounted(() => nextTick(() => { rootRef.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); rootRef.value?.querySelector('input[type="text"], input:not([type])')?.focus?.() }))   // the form is at the top of the list and scrolled to
async function create() {
  try {
    const before = new Set((await storageAPI.list()).adapters.map((x) => x.id))
    const body = { ...draft, ...(draftType.value === 'wasabi' ? { endpoint: wasabiEndpoint(draft.region.trim()) } : {}) }
    let r = await storageAPI.save(body)
    const fresh = r.adapters.find((x) => !before.has(x.id))
    if (fresh) r = await storageAPI.reorder([fresh.id, ...r.adapters.filter((x) => x.id !== fresh.id).map((x) => x.id)])   // the new one is first
    emit('saved', { adapters: r.adapters, fresh: fresh?.id || '' })
  } catch (e) { emit('error', errorText(e)) }
}
</script>
