<template>
  <div data-testid="adapter-manager">
    <BAlert :model-value="true" variant="info" class="small py-2 mb-3"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('adapters.hint') }}</BAlert>
    <BAlert v-if="error" :model-value="true" variant="danger" dismissible class="small py-2" data-testid="adapters-error" @update:model-value="error = null">{{ error }}</BAlert>

    <div class="d-flex align-items-center mb-2">
      <span class="small text-body-secondary" data-testid="adapters-count">{{ $t('adapters.count', { n: store.adapters.length }) }}</span>
      <BButton size="sm" variant="outline-light" class="ms-auto text-nowrap" data-testid="adapter-new" @click="startNew"><i class="fa-solid fa-plus me-1"></i>{{ $t('adapters.new') }}</BButton>
    </div>

    <div v-for="a in store.adapters" :key="a.id" class="d-flex align-items-center gap-2 py-2 border-bottom flex-wrap" data-testid="adapter-row" :data-id="a.id">
      <div class="flex-grow-1 lh-sm" style="min-width: 12rem">
        <span class="fw-semibold">{{ a.name }}</span> <code class="small text-body-secondary">{{ a.id }}</code>
        <small class="d-block text-body-secondary font-monospace">{{ a.sha256.slice(0, 12) }}…</small>
        <small v-if="a.error" class="text-danger d-block">{{ a.error }}</small>
      </div>
      <BBadge v-if="a.builtin" variant="secondary" class="fw-normal" data-testid="adapter-builtin">{{ $t('import.builtIn') }}</BBadge>
      <BBadge v-else variant="info" class="fw-normal" data-testid="adapter-yours">{{ $t('import.yours') }}</BBadge>
      <div class="d-flex gap-1">
        <BButton size="sm" variant="outline-light" class="text-nowrap" :title="$t('adapters.inspectHint')" data-testid="adapter-inspect" @click="inspect(a.id)"><i class="fa-solid fa-code me-1"></i>{{ $t('adapters.inspect') }}</BButton>
        <BButton v-if="!a.builtin" size="sm" variant="outline-light" class="text-nowrap" data-testid="adapter-edit" @click="startEdit(a.id)"><i class="fa-solid fa-pen me-1"></i>{{ $t('adapters.edit') }}</BButton>
        <BButton size="sm" variant="outline-light" class="text-nowrap" :title="$t('adapters.duplicateHint')" data-testid="adapter-duplicate" @click="startDuplicate(a.id)"><i class="fa-regular fa-copy me-1"></i>{{ $t('adapters.duplicate') }}</BButton>
        <BButton v-if="!a.builtin" size="sm" variant="outline-danger" class="text-nowrap" data-testid="adapter-delete" @click="del(a)"><i class="fa-solid fa-trash me-1"></i>{{ $t('adapters.delete') }}</BButton>
      </div>
    </div>
    <div v-if="!store.adapters.some((a) => !a.builtin)" class="small text-body-secondary mt-2" data-testid="adapters-none">{{ $t('adapters.none') }}</div>

    <!-- Inspect: the code as it is on disk, read-only. -->
    <BModal :model-value="!!viewing" :title="viewing ? $t('adapters.inspectTitle', { id: viewing.id }) : ''" size="xl" scrollable lazy data-testid="adapter-view-modal" @update:model-value="(v) => { if (!v) viewing = null }">
      <template v-if="viewing">
        <div class="small text-body-secondary mb-2">
          <span v-if="viewing.builtin" data-testid="adapter-view-builtin">{{ $t('adapters.builtinNote') }}</span>
          <code class="d-block text-break" data-testid="adapter-view-file">{{ viewing.file }}</code>
          <code class="d-block" data-testid="adapter-view-sha">{{ $t('import.sha', { sha: viewing.sha256 }) }}</code>
        </div>
        <pre class="small p-2 rounded border bg-body mb-0" style="overflow: auto" data-testid="adapter-view-code">{{ viewing.text }}</pre>
      </template>
      <template #footer>
        <BButton variant="outline-light" size="sm" data-testid="adapter-view-close" @click="viewing = null">{{ $t('import.close') }}</BButton>
        <BButton v-if="viewing && !viewing.builtin" variant="outline-light" size="sm" data-testid="adapter-view-edit" @click="editFromView">{{ $t('adapters.edit') }}</BButton>
      </template>
    </BModal>

    <!-- Create, edit, duplicate: the code in a box, the structure checked as you type. -->
    <BModal :model-value="!!editor" :title="editor ? $t(`adapters.${editor.mode}Title`, { id: editor.from || editor.id }) : ''" size="xl" lazy data-testid="adapter-edit-modal" @update:model-value="(v) => { if (!v) editor = null }">
      <template v-if="editor">
        <BFormGroup :label="$t('adapters.id')" label-for="adapter-id" class="mb-2" :description="$t('adapters.idHint')">
          <BFormInput id="adapter-id" v-model.trim="editor.id" size="sm" class="font-monospace" :readonly="editor.mode === 'edit'" data-testid="adapter-id" @update:model-value="check" />
        </BFormGroup>
        <BFormTextarea v-model="editor.text" rows="22" class="font-monospace small" spellcheck="false" data-testid="adapter-code" @update:model-value="check" />
        <div class="small mt-2" data-testid="adapter-structure" :data-ok="problems.length ? 'false' : 'true'">
          <span v-if="!problems.length" class="text-success"><i class="fa-solid fa-circle-check me-1"></i>{{ $t('adapters.structureOk') }}</span>
          <div v-for="(p, i) in problems" :key="i" class="text-warning" data-testid="adapter-problem"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ p }}</div>
        </div>
        <div class="small text-body-secondary mt-1">{{ $t('adapters.saveNote') }}</div>
        <BAlert v-if="editor.error" :model-value="true" variant="danger" class="small py-2 mt-2" data-testid="adapter-save-error">{{ editor.error }}</BAlert>
      </template>
      <template #footer>
        <BButton variant="outline-light" size="sm" @click="editor = null">{{ $t('import.cancel') }}</BButton>
        <BButton variant="primary" size="sm" :disabled="!editor || !editor.id || !editor.text.trim() || saving" data-testid="adapter-save" @click="save">
          <BSpinner v-if="saving" small class="me-1" />{{ $t('adapters.save') }}
        </BButton>
      </template>
    </BModal>
  </div>
</template>

<script setup>
/**
 * AdapterManager — Default Configuration › Import adapters (docs/ADR-008): every adapter listed with its code open to
 * read, so an import is never a black box. Built-ins are read-only (Duplicate one to change it); yours can be created
 * (from a template), edited, duplicated and deleted. The structure is checked as you type. There is no approval step:
 * the code is open to read here, and it only ever runs fenced, read-only on the folder it is given.
 */
import { onMounted, ref } from 'vue'
import { importsAPI } from '../api/imports'
import { useImportsStore } from '../stores/imports'
import { useToastStore, errorText } from '../stores/toast'
import { t } from '../i18n'

const store = useImportsStore()
const toast = useToastStore()
const error = ref(null)
const viewing = ref(null)
const editor = ref(null)      // { mode: 'new' | 'edit' | 'duplicate', id, from?, text, error }
const problems = ref([])
const saving = ref(false)

onMounted(() => store.loadAdapters())

async function inspect(id) {
  try { viewing.value = await importsAPI.source(id) } catch (e) { error.value = errorText(e) }
}
/** From Inspect straight into the editor. */
async function editFromView() { const id = viewing.value.id; viewing.value = null; await startEdit(id) }

let checkRun = 0
async function check() {
  const mine = ++checkRun
  if (!editor.value) return
  try { const r = await importsAPI.validate(editor.value.text, editor.value.id); if (mine === checkRun) problems.value = r || [] } catch { /* the save reports it */ }
}
async function open(mode, id, text, from) {
  editor.value = { mode, id, from, text, error: null }
  await check()
}
async function startNew() {
  error.value = null
  const id = 'my-adapter'
  try { await open('new', id, await importsAPI.template(id)) } catch (e) { error.value = errorText(e) }
}
async function startEdit(id) {
  try { const s = await importsAPI.source(id); await open('edit', id, s.text) } catch (e) { error.value = errorText(e) }
}
async function startDuplicate(from) {
  const id = `${from}-copy`.slice(0, 63)
  try { await open('duplicate', id, await importsAPI.duplicate(from, id), from) } catch (e) { error.value = errorText(e) }
}
async function save() {
  const e = editor.value
  saving.value = true; e.error = null
  try {
    await importsAPI.save(e.id, e.text)
    editor.value = null
    toast.success(t('adapters.saved', { id: e.id }))
    await store.loadAdapters()
  } catch (x) { e.error = errorText(x) } finally { saving.value = false }
}
async function del(a) {
  if (!window.confirm(t('adapters.confirmDelete', { id: a.id }))) return
  try { await importsAPI.remove(a.id); toast.success(t('adapters.deleted', { id: a.id })); await store.loadAdapters() } catch (e) { error.value = errorText(e) }
}
</script>
