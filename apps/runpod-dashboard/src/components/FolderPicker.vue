<template>
  <BModal :model-value="modelValue" :title="title" size="lg" scrollable @update:model-value="$emit('update:modelValue', $event)" @show="open">
    <div class="d-flex gap-2 mb-2">
      <BButton size="sm" variant="outline-light" :disabled="!listing?.parent || loading" title="Up one folder" @click="go(listing.parent)"><i class="fa-solid fa-arrow-up"></i></BButton>
      <BButton size="sm" variant="outline-light" :disabled="loading" title="Home folder" @click="go('')"><i class="fa-solid fa-house"></i></BButton>
      <BFormInput v-model.trim="typed" size="sm" class="font-monospace" placeholder="/path/to/folder" @keydown.enter.prevent="go(typed)" />
      <BButton size="sm" variant="outline-light" :disabled="loading" @click="go(typed)">Go</BButton>
    </div>
    <div v-if="loading" class="text-center text-body-secondary py-3"><BSpinner small /></div>
    <BAlert v-else-if="error" :model-value="true" variant="danger" class="mb-2">{{ error }}</BAlert>
    <div v-else-if="listing" class="list-group list-group-flush border rounded folder-list">
      <button v-for="d in listing.dirs" :key="d.path" type="button" class="list-group-item list-group-item-action py-1 font-monospace small" @dblclick="go(d.path)" @click="selected = d.path" :class="{ active: selected === d.path }">
        <i class="fa-regular fa-folder me-2"></i>{{ d.name }}
      </button>
      <div v-if="!listing.dirs.length" class="list-group-item text-body-secondary small">No subfolders</div>
    </div>
    <BFormCheckbox v-model="hidden" switch size="sm" class="mt-2" @update:model-value="go(listing?.path || '')">Show hidden folders</BFormCheckbox>
    <template #footer>
      <small class="text-body-secondary me-auto font-monospace text-truncate" style="max-width: 60%">{{ selected || listing?.path }}</small>
      <BButton variant="outline-light" size="sm" @click="$emit('update:modelValue', false)">Cancel</BButton>
      <BButton variant="primary" size="sm" :disabled="!(selected || listing?.path)" @click="choose">Use this folder</BButton>
    </template>
  </BModal>
</template>

<script setup>
/**
 * FolderPicker — choose a folder on this PC. Lists folders through the pod manager API
 * (GET /api/fs/dirs), which runs on the same machine as the dashboard, so it works the same in
 * the browser and in the Electron app. Single click selects, double click enters, Enter in the
 * path box jumps there. Emits `choose` with the absolute path.
 */
import { ref } from 'vue'
import { mountsAPI } from '../api/mounts'

const props = defineProps({ modelValue: Boolean, title: { type: String, default: 'Choose a folder' }, start: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue', 'choose'])

const listing = ref(null)
const loading = ref(false)
const error = ref(null)
const typed = ref('')
const selected = ref('')
const hidden = ref(false)

async function go(path) {
  loading.value = true; error.value = null; selected.value = ''
  try {
    listing.value = await mountsAPI.dirs(path, hidden.value)
    typed.value = listing.value.path
  } catch (e) {
    error.value = e.response?.data?.detail || e.message
  } finally { loading.value = false }
}

function open() { go(props.start || '') }

function choose() {
  emit('choose', selected.value || listing.value?.path)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.folder-list { max-height: 50vh; overflow: auto; }
</style>
