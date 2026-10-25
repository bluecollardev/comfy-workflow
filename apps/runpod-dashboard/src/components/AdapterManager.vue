<template>
  <div data-testid="adapter-manager">
    <BAlert :model-value="true" variant="info" class="small py-2 mb-3"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('adapters.hint') }}</BAlert>
    <BAlert v-if="error" :model-value="true" variant="danger" dismissible class="small py-2" data-testid="adapters-error" @update:model-value="error = null">{{ error }}</BAlert>

    <div class="d-flex align-items-center mb-2">
      <span class="small text-body-secondary" data-testid="adapters-count">{{ $t('adapters.count', { n: store.adapters.length }) }}</span>
      <BButton size="sm" variant="outline-light" class="ms-auto text-nowrap" data-testid="adapter-new" @click="studio.openNew({})"><i class="fa-solid fa-plus me-1"></i>{{ $t('adapters.new') }}</BButton>
    </div>

    <div v-for="a in store.adapters" :key="a.id" class="d-flex align-items-center gap-2 py-2 border-bottom flex-wrap" data-testid="adapter-row" :data-id="a.id">
      <div class="flex-grow-1 lh-sm" style="min-width: 12rem">
        <span class="fw-semibold">{{ a.name }}</span> <code class="small text-body-secondary">{{ a.id }}</code>
        <small class="d-block text-body-secondary font-monospace">{{ a.sha256.slice(0, 12) }}…</small>
        <small v-if="a.error" class="text-danger d-block">{{ a.error }}</small>
      </div>
      <BBadge v-if="a.builtin" :variant="a.modified ? 'warning' : 'secondary'" class="fw-normal" data-testid="adapter-builtin">{{ a.modified ? $t('studio.builtinModified') : $t('import.builtIn') }}</BBadge>
      <BBadge v-else variant="info" class="fw-normal" data-testid="adapter-yours">{{ $t('import.yours') }}</BBadge>
      <div class="d-flex gap-1">
        <BButton size="sm" variant="outline-light" class="text-nowrap" :title="$t('adapters.editHint')" data-testid="adapter-edit" @click="studio.openAdapter(a.id, {})"><i class="fa-solid fa-pen me-1"></i>{{ $t('adapters.edit') }}</BButton>
        <BButton size="sm" variant="outline-light" class="text-nowrap" :title="$t('adapters.duplicateHint')" data-testid="adapter-duplicate" @click="studio.openNew({ copyOf: a.id })"><i class="fa-regular fa-copy me-1"></i>{{ $t('adapters.duplicate') }}</BButton>
        <BButton v-if="!a.builtin" size="sm" variant="outline-danger" class="text-nowrap" data-testid="adapter-delete" @click="del(a)"><i class="fa-solid fa-trash me-1"></i>{{ $t('adapters.delete') }}</BButton>
        <BButton v-else-if="a.modified" size="sm" variant="outline-warning" class="text-nowrap" :title="$t('studio.resetHint')" data-testid="adapter-reset" @click="del(a)"><i class="fa-solid fa-rotate-left me-1"></i>{{ $t('studio.reset') }}</BButton>
      </div>
    </div>
    <div v-if="!store.adapters.some((a) => !a.builtin)" class="small text-body-secondary mt-2" data-testid="adapters-none">{{ $t('adapters.none') }}</div>
  </div>
</template>

<script setup>
/**
 * AdapterManager — Default Configuration > Import adapters (docs/ADR-008, docs/ADR-009): every adapter listed with its code hash. Edit opens the
 * Adapter Studio (the same modal as New adapter and Write an adapter with Claude), for built-ins too: editing a built-in makes an override that
 * Reset removes. Duplicate copies any adapter under a new id; Delete removes yours. There is no approval step.
 */
import { onMounted, ref } from 'vue'
import { importsAPI } from '../api/imports'
import { useImportsStore } from '../stores/imports'
import { useStudioStore } from '../stores/studio'
import { useToastStore, errorText } from '../stores/toast'
import { t } from '../i18n'

const store = useImportsStore()
const studio = useStudioStore()
const toast = useToastStore()
const error = ref(null)
onMounted(() => store.loadAdapters())

async function del(a) {
  if (!window.confirm(t(a.builtin ? 'studio.confirmReset' : 'adapters.confirmDelete', { id: a.id }))) return
  try { await importsAPI.remove(a.id); toast.success(t(a.builtin ? 'studio.wasReset' : 'adapters.deleted', { id: a.id })); await store.loadAdapters() } catch (e) { error.value = errorText(e) }
}
</script>
