<template>
  <div ref="rootRef" data-testid="storage-adapters">
    <BAlert :model-value="true" variant="info" class="small py-2 mb-3"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('storage.hint') }}</BAlert>
    <div v-if="old" class="alert alert-info small" data-testid="storage-restart">{{ restart }}</div>
    <BAlert v-if="error" :model-value="true" variant="danger" dismissible class="small py-2" data-testid="storage-error" @update:model-value="error = ''">{{ error }}</BAlert>
    <div class="d-flex align-items-center mb-2">
      <span class="small text-body-secondary" data-testid="storage-count">{{ $t('storage.count', { n: shown.length }) }}</span>
      <BButton size="sm" variant="outline-light" class="ms-auto text-nowrap" data-testid="storage-add" @click="startAdd"><i class="fa-solid fa-plus me-1"></i>{{ $t('storage.add') }}</BButton>
    </div>

    <!-- Add Storage -->
    <div v-if="adding" ref="addRef" class="border rounded p-2 mb-2" data-testid="storage-add-form">
      <div class="fw-semibold mb-2">{{ $t('storage.addTitle') }}</div>
      <div class="d-flex gap-3 mb-2" data-testid="storage-new-type">
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
      <div class="d-flex gap-2 mt-2">
        <BButton size="sm" variant="primary" :disabled="!draft.name" data-testid="storage-new-save" @click="create">{{ $t('storage.save') }}</BButton>
        <BButton size="sm" variant="outline-light" data-testid="storage-new-cancel" @click="adding = false">{{ $t('storage.cancel') }}</BButton>
      </div>
    </div>
    <div v-for="a in shown" :key="a.id" class="border rounded p-2 mb-2" :class="{ 'storage-over': overId === a.id && dragId && dragId !== a.id, 'opacity-50': dragId === a.id }" data-testid="storage-card" :data-id="a.id" :data-enabled="a.enabled ? 'true' : 'false'" @dragover.prevent="overId = a.id" @drop.prevent="dropOn(a.id)">
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <span class="text-body-secondary" style="cursor: grab" draggable="true" role="button" :title="$t('storage.dragHandle')" :aria-label="$t('storage.dragHandle')" data-testid="storage-handle" @dragstart="dragStart($event, a.id)" @dragend="fromId = ''; dragId = overId = ''"><i class="fa-solid fa-grip-vertical"></i></span>
        <BFormCheckbox v-if="a.kind !== 'publish'" :key="`${a.id}:${gen}`" :model-value="a.enabled" switch class="mb-0" :aria-label="$t('storage.switch', { name: label(a) })" :disabled="busy === a.id" data-testid="storage-enabled" @update:model-value="(v) => flip(a, v)" />
        <template v-if="renaming === a.id">
          <BFormInput v-model.trim="nameDraft" size="sm" style="max-width: 18rem" maxlength="60" autofocus data-testid="storage-rename-input" @keyup.enter="saveName(a)" @keyup.esc="renaming = ''" />
          <BButton size="sm" variant="primary" data-testid="storage-rename-save" @click="saveName(a)">{{ $t('storage.save') }}</BButton>
          <BButton size="sm" variant="outline-light" @click="renaming = ''">{{ $t('storage.cancel') }}</BButton>
        </template>
        <template v-else>
          <span class="fw-semibold" data-testid="storage-name">{{ label(a) }}</span>
          <BButton size="sm" variant="link" class="p-0 text-body-secondary" :title="$t('storage.rename')" :aria-label="$t('storage.rename')" data-testid="storage-rename" @click="startRename(a)"><i class="fa-solid fa-pen"></i></BButton>
        </template> <code class="small text-body-secondary">{{ a.id }}</code>
        <BBadge :variant="a.ready ? 'success' : 'secondary'" class="fw-normal" data-testid="storage-ready">{{ a.ready ? $t('storage.ready') : $t('storage.notReady') }}</BBadge>
        <BBadge :variant="a.builtin ? 'secondary' : 'info'" class="fw-normal">{{ a.builtin ? $t('storage.builtin') : $t('storage.yours') }}</BBadge>
        <span v-if="a.problem && !a.ready" class="small text-warning" data-testid="storage-problem">{{ a.problem }}</span>
        <span class="ms-auto small font-monospace text-body-secondary text-truncate" style="max-width: 24rem" data-testid="storage-dest">{{ dest(a) }}</span>
      </div>

      <!-- The same five switches on every S3 card (docs/ADR-064). On the publish destination, Approved is Auto-publish and Publishing is what the destination is. -->
      <div class="mt-2" data-testid="storage-events">
        <div class="small fw-semibold">{{ $t('storage.events') }}</div>
        <div class="small text-body-secondary mb-1">{{ $t('storage.eventsHelp') }}</div>
        <div class="d-flex flex-wrap gap-3">
          <BFormCheckbox v-for="ev in EVENTS" :key="`${a.id}:${ev}:${gen}:${apGen}`" :model-value="evOn(a, ev)" switch class="mb-0" :disabled="busy === a.id || (a.kind === 'publish' && ev === 'publishing')" :title="evNote(a, ev)" :data-testid="`storage-event-${ev}`" @update:model-value="(on) => flipEvent(a, ev, on)">{{ $t(`storage.event.${ev}`) }}</BFormCheckbox>
        </div>
        <div v-if="a.kind === 'publish'" class="small text-body-secondary mt-1" data-testid="storage-publish-events">{{ $t('storage.approvedHelp') }}</div>
      </div>

      <!-- Publishing's destination: its form lives here now (the slot), the values stay where Publishing keeps them -->
      <!-- One Panama bucket, two roles (docs/ADR-065): the bucket, region and keys once, then Pull Rounds and Publish Returns each with its own switch -->
      <div v-if="a.kind === 'publish'" class="mt-2" data-testid="storage-publish-body">
        <div data-testid="storage-panama-body"><slot name="panama"></slot></div>
        <div v-if="pan" class="border rounded p-2 mt-3" data-testid="storage-role-pull">
          <BFormCheckbox :key="`pull:${pan.id}:${gen}`" :model-value="pan.enabled" switch class="mb-1 fw-semibold" :disabled="busy === pan.id" data-testid="storage-enabled-panama" @update:model-value="(v) => flip(pan, v)">{{ $t('storage.rolePull') }}</BFormCheckbox>
          <div class="small text-body-secondary mb-2">{{ $t('storage.rolePullHelp') }}</div>
          <slot name="panama-pull"></slot>
        </div>
        <div class="border rounded p-2 mt-3" data-testid="storage-role-publish">
          <BFormCheckbox :key="`pub:${a.id}:${gen}`" :model-value="a.enabled" switch class="mb-1 fw-semibold" :disabled="busy === a.id" data-testid="storage-enabled-publish" @update:model-value="(v) => flip(a, v)">{{ $t('storage.rolePublish') }}</BFormCheckbox>
          <div class="small text-body-secondary mb-2">{{ $t('storage.rolePublishHelp') }}</div>
          <slot name="publish"></slot>
        </div>
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

    <div v-if="!adapters.some((a) => !a.builtin)" class="small text-body-secondary" data-testid="storage-none">{{ $t('storage.none') }}</div>
  </div>
</template>

<script setup>
/**
 * StorageAdapters — Default Configuration > Adapters > Storage (docs/ADR-063): every S3-compatible storage with its on/off switch. The publish destination's form is the
 * `publish` slot (it keeps saving with the window's one Save), Panama's form (the BH bucket keys, bucket, region, profile and pull on start) is the `panama` slot, Wasabi and the ones you add are edited here.
 */
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { storageAPI, RESTART } from '../api/storage'
import { useConfirmStore } from '../stores/confirm'
import { useAutopublishStore } from '../stores/autopublish'
import { useNamePromptStore } from '../stores/nameprompt'
import { errorText } from '../stores/toast'
import { t } from '../i18n'

const confirm = useConfirmStore(), ap = useAutopublishStore(), prompt = useNamePromptStore(), apGen = ref(0)
const rootRef = ref(null), addRef = ref(null), draftType = ref('wasabi')
const shown = computed(() => adapters.value.filter((a) => a.kind !== 'panama'))   // the Panama exchange is a role of the publish card (docs/ADR-065)
const pan = computed(() => adapters.value.find((a) => a.kind === 'panama'))
const dragId = ref(''), overId = ref(''), renaming = ref(''), nameDraft = ref('')
const startRename = (a) => { nameDraft.value = a.name; renaming.value = a.id }
async function saveName(a) {
  error.value = ''
  try { fill((await storageAPI.save({ id: a.id, name: nameDraft.value })).adapters); renaming.value = '' } catch (e) { error.value = errorText(e) }
}
let fromId = ''
function dragStart(e, id) { fromId = id; setTimeout(() => { dragId.value = id }, 0); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); const card = e.target.closest('[data-testid="storage-card"]'); if (card && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(card, 12, 12) } catch { /* a browser without it */ } }
async function dropOn(id) {
  const from = fromId; fromId = ''; dragId.value = overId.value = ''
  if (!from || from === id) return
  const ids = adapters.value.map((a) => a.id), i = ids.indexOf(from); ids.splice(i, 1); ids.splice(ids.indexOf(id) + (i < ids.indexOf(id) ? 1 : 0), 0, from)
  try { fill((await storageAPI.reorder(ids)).adapters) } catch (e) { error.value = errorText(e); await load() }
}
/** Approved on the publish destination is Auto-publish (ADR-050, ADR-064): on needs a name and a tick, and starts as Auto-publish's own setting says. */
async function flipApproved() {
  apGen.value++; error.value = ''
  try {
    if (ap.enabled) { await ap.off(); return }
    await prompt.ask({ title: t('autopublish.block.enableTitle'), checkbox: t('autopublish.block.understood', { dest: ap.settings?.destination || '' }), okLabel: t('autopublish.block.enableOk'), message: t('storage.approvedHelp'),
      submit: async ({ name, checked }) => { try { await ap.setSettings({ enabled: true, approved_by: name, understood: checked }); return '' } catch (e) { return errorText(e) } } })
  } catch (e) { error.value = errorText(e) } finally { apGen.value++ }
}
const adapters = ref([]), old = ref(false), error = ref(''), busy = ref(''), testing = ref(''), adding = ref(false)
const restart = RESTART, gen = ref(0)   // a refused switch re-draws the checkbox so it shows what is saved
const forms = reactive({}), results = reactive({})
const draft = reactive({ name: '', endpoint: '', region: '', bucket: '', prefix: '', access_key_id: '', secret_access_key: '' })
const EVENTS = ['generating', 'generated', 'approved', 'publishing', 'published']
const FIELDS = ['bucket', 'prefix', 'region', 'endpoint']
const label = (a) => a.name
const dest = (a) => (a.bucket ? `s3://${a.bucket}/${a.prefix || ''}${a.endpoint ? `  ·  ${a.endpoint}` : ''}` : '')
const hint = (a) => (a.key_hint ? t('storage.keysSaved', { hint: a.key_hint }) : '')
function fill(list) {
  adapters.value = list
  for (const a of list) if (a.kind === 'wasabi' || a.kind === 'custom') forms[a.id] = { ...Object.fromEntries(FIELDS.map((k) => [k, k === 'endpoint' ? (a.builtin ? '' : a.endpoint) : a[k] || ''])), access_key_id: '', secret_access_key: '' }
}
const load = async () => { try { const r = await storageAPI.list(); old.value = r.old; fill(r.adapters) } catch (e) { error.value = errorText(e) } }
onMounted(() => { load(); try { ap.refresh?.() } catch { /* the rule's state is a hint here */ } })
defineExpose({ load })
const changed = (a) => { const f = forms[a.id]; return !!f && (!!f.access_key_id || !!f.secret_access_key || FIELDS.some((k) => f[k] !== (k === 'endpoint' ? (a.builtin ? '' : a.endpoint) : a[k] || ''))) }
async function flip(a, on) {
  busy.value = a.id; error.value = ''
  try { fill((await storageAPI.setEnabled(a.id, on)).adapters) } catch (e) { error.value = errorText(e); gen.value++; await load() } finally { busy.value = '' }
}
const evOn = (a, ev) => (a.kind === 'publish' && ev === 'approved' ? ap.enabled : a.kind === 'publish' && ev === 'publishing' ? true : (a.events || []).includes(ev))
const evNote = (a, ev) => (a.kind === 'publish' && ev === 'approved' ? t('storage.approvedHelp') : a.kind === 'publish' && ev === 'publishing' ? t('storage.publishingHelp') : '')
async function flipEvent(a, ev, on) {
  if (a.kind === 'publish' && ev === 'approved') return flipApproved()
  if (a.kind === 'publish' && ev === 'publishing') return
  busy.value = a.id; error.value = ''
  const next = EVENTS.filter((e) => (e === ev ? on : (a.events || []).includes(e)) && !(a.kind === 'publish' && (e === 'approved' || e === 'publishing')))
  try { fill((await storageAPI.save({ id: a.id, events: next })).adapters) } catch (e) { error.value = errorText(e); gen.value++; await load() } finally { busy.value = '' }
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
const startAdd = () => {
  Object.assign(draft, { name: '', endpoint: '', region: '', bucket: '', prefix: '', access_key_id: '', secret_access_key: '' }); draftType.value = 'wasabi'; adding.value = true
  nextTick(() => { addRef.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); addRef.value?.querySelector('input[type="text"], input:not([type])')?.focus?.() })   // the form is at the top of the list and scrolled to
}
const wasabiEndpoint = (region) => (!region || region === 'us-east-1' ? 'https://s3.wasabisys.com' : `https://s3.${region}.wasabisys.com`)
async function create() {
  error.value = ''
  try {
    const before = new Set(adapters.value.map((x) => x.id))
    const body = { ...draft, ...(draftType.value === 'wasabi' ? { endpoint: wasabiEndpoint(draft.region.trim()) } : {}) }
    let r = await storageAPI.save(body); adding.value = false
    const fresh = r.adapters.find((x) => !before.has(x.id))
    if (fresh) r = await storageAPI.reorder([fresh.id, ...r.adapters.filter((x) => x.id !== fresh.id).map((x) => x.id)])   // the new one is first
    fill(r.adapters)
    if (fresh) nextTick(() => rootRef.value?.querySelector(`[data-testid="storage-card"][data-id="${fresh.id}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }))
  } catch (e) { error.value = errorText(e) }
}
</script>
