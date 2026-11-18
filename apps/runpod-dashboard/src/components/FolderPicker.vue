<template>
  <BModal :model-value="modelValue" :title="title" size="lg" scrollable @update:model-value="$emit('update:modelValue', $event)" @show="open">
    <div v-if="volumeRows.length" class="mb-2" data-testid="folder-volumes">
      <div class="small text-body-secondary mb-1"><i class="fa-solid fa-hard-drive me-1"></i>{{ $t('picker.volumes') }}</div>
      <div class="list-group list-group-flush border rounded">
        <button v-for="v in volumeRows" :key="v.path" type="button" class="list-group-item list-group-item-action py-1 small d-flex align-items-center gap-2" :class="{ 'text-body-secondary': v.link }" :disabled="loading || !v.readable" data-testid="folder-volume" :data-path="v.path" :data-readable="v.readable ? 'true' : 'false'" :data-link="v.link ? 'true' : 'false'" :title="v.link && v.target ? $t('picker.linkTo', { target: v.target }) : v.path" @click="go(v.path)">
          <i class="fa-solid me-1" :class="v.link ? 'fa-link' : 'fa-hard-drive'"></i><span class="fw-semibold">{{ v.name }}</span>
          <span v-if="v.link" class="badge text-bg-secondary" data-testid="folder-volume-link">{{ $t('picker.link') }}</span>
          <span v-if="!v.readable" class="badge text-bg-warning" data-testid="folder-volume-unreadable" :title="v.reason || ''">{{ $t('picker.unreadable') }}<template v-if="v.reason">{{ `: ${v.reason}` }}</template></span>
          <span v-else-if="v.size_bytes != null" class="text-body-secondary ms-auto" data-testid="folder-volume-free">{{ $t('picker.volumeFree', { free: formatBytes(v.free_bytes), size: formatBytes(v.size_bytes) }) }}</span>
        </button>
      </div>
    </div>
    <div class="d-flex gap-2 mb-2">
      <BButton size="sm" variant="outline-light" :disabled="!listing?.parent" :title="$t('picker.up')" data-testid="picker-up" @click="go(listing.parent)"><i class="fa-solid fa-arrow-up"></i></BButton>
      <BButton size="sm" variant="outline-light" :title="$t('picker.home')" data-testid="picker-home" @click="go('')"><i class="fa-solid fa-house"></i></BButton>
      <BFormInput v-model.trim="typed" size="sm" class="font-monospace" :placeholder="$t('picker.path')" data-testid="picker-path" @keydown.enter.prevent="go(typed)" />
      <BButton size="sm" variant="outline-light" @click="go(typed)">{{ $t('picker.go') }}</BButton>
    </div>
    <div v-if="showFilter" class="mb-2"><BFormInput v-model="filter" size="sm" :placeholder="$t('picker.filter')" data-testid="folder-filter" autocomplete="off" /></div>
    <div v-if="loading" class="text-center text-body-secondary py-3" data-testid="folder-loading"><BSpinner small class="me-2" />{{ $t('picker.loading') }}</div>
    <BAlert v-else-if="errorCode === 'timeout'" :model-value="true" variant="warning" class="mb-2" data-testid="folder-timeout"><div class="fw-semibold"><i class="fa-solid fa-hourglass-half me-1"></i>{{ $t('picker.timeoutTitle') }}</div><div data-testid="folder-timeout-text">{{ error }}</div><BButton size="sm" variant="outline-secondary" class="mt-2" data-testid="folder-retry" @click="load(lastPath, filter)"><i class="fa-solid fa-rotate me-1"></i>{{ $t('picker.retry') }}</BButton></BAlert>
    <BAlert v-else-if="errorCode === 'no_permission'" :model-value="true" variant="warning" class="mb-2" data-testid="folder-permission-hint"><div class="fw-semibold"><i class="fa-solid fa-lock me-1"></i>{{ $t('picker.noPermissionTitle') }}</div><div>{{ $t('picker.noPermissionBody', { path: errorPath }) }}</div><div data-testid="folder-permission-hint-text">{{ errorHint || $t('picker.noPermissionWhere') }}</div></BAlert>
    <BAlert v-else-if="error" :model-value="true" variant="danger" class="mb-2">{{ error }}</BAlert>
    <div v-if="!loading && !error && listing?.truncated > 0" class="small text-warning mb-1" data-testid="folder-truncated">{{ $t('picker.truncated', { shown: listing.dirs.length, total: listing.total ?? listing.dirs.length + listing.truncated }) }}</div>
    <div v-if="!loading && !error && listing?.real" class="small text-body-secondary mb-1 font-monospace" data-testid="folder-real"><i class="fa-solid fa-link me-1"></i>{{ $t('picker.realPath', { real: listing.real }) }}</div>
    <div v-if="!loading && !error && listing" class="list-group list-group-flush border rounded folder-list" data-testid="folder-picker">
      <button v-for="d in listing.dirs" :key="d.path" type="button" class="list-group-item list-group-item-action py-1 font-monospace small" data-testid="picker-item" :data-name="d.name" @dblclick="go(d.path)" @click="selected = d.path" :class="{ active: selected === d.path }">
        <i class="fa-regular fa-folder me-2"></i>{{ d.name }}
        <span v-if="d.link" class="ms-2 text-body-secondary" data-testid="folder-link" :title="d.target || ''"><i class="fa-solid fa-link me-1"></i><span class="badge text-bg-secondary">{{ $t('picker.link') }}</span></span>
      </button>
      <div v-if="!listing.dirs.length" class="list-group-item text-body-secondary small">{{ $t('picker.noSubfolders') }}</div>
    </div>
    <BFormCheckbox v-model="hidden" switch size="sm" class="mt-2" @update:model-value="go(listing?.path || '')">{{ $t('picker.showHidden') }}</BFormCheckbox>
    <template #footer>
      <small class="text-body-secondary me-auto font-monospace text-truncate" style="max-width: 60%">{{ selected || listing?.path }}</small>
      <BButton variant="outline-light" size="sm" @click="$emit('update:modelValue', false)">{{ $t('picker.cancel') }}</BButton>
      <BButton variant="primary" size="sm" :disabled="!(selected || listing?.path)" data-testid="picker-use" @click="choose">{{ $t('picker.use') }}</BButton>
    </template>
  </BModal>
</template>

<script setup>
/**
 * FolderPicker — choose a folder on this PC. Lists folders through the pod manager API
 * (GET /api/fs/dirs), which runs on the same machine as the dashboard, so it works the same in
 * the browser and in the Electron app. Single click selects, double click enters, Enter in the
 * path box jumps there. Emits `choose` with the absolute path. Remembers the last folder
 * browsed per `memoryKey` (one per row of the configuration) in localStorage, and opens there
 * when the field being filled is still empty; a row never browsed starts at the last folder
 * browsed anywhere.
 */
import { computed, ref, watch } from 'vue'
import { mountsAPI } from '../api/mounts'
import { formatBytes } from '../sync-progress'

const props = defineProps({ modelValue: Boolean, title: { type: String, default: 'Choose a folder' }, start: { type: String, default: '' }, memoryKey: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue', 'choose'])

const listing = ref(null)
const loading = ref(false)
const error = ref(null)
const errorCode = ref(''), errorHint = ref(''), errorPath = ref('')   // a folder the app may not read (macOS privacy): the hint, not a bare error
const volumes = ref([])
/** The mounted volumes, the boot volume's link last and greyed. */
const volumeRows = computed(() => [...volumes.value].sort((a, b) => Number(!!a.link) - Number(!!b.link)))
const typed = ref('')
const selected = ref('')
const hidden = ref(false)

const LAST_DIR = 'folderPicker.lastDir'
const keyed = () => (props.memoryKey ? `${LAST_DIR}.${props.memoryKey}` : '')
function remember(path) {
  try { localStorage.setItem(LAST_DIR, path); if (keyed()) localStorage.setItem(keyed(), path) } catch { /* private window or blocked storage */ }
}
function lastDir() {
  try { return (keyed() && localStorage.getItem(keyed())) || localStorage.getItem(LAST_DIR) || '' } catch { return '' }
}

// The listing can be slow (a big or sleeping volume): the window stays responsive, and a newer request wins; an older answer that arrives late is ignored.
const filter = ref(''), lastPath = ref('')
let seq = 0, filterTimer = null, settingFilter = false
const showFilter = computed(() => !!filter.value || (listing.value && ((listing.value.total ?? listing.value.dirs.length) > 20 || listing.value.truncated > 0)))
/** Navigating to a folder starts with no filter. */
function go(path) { clearTimeout(filterTimer); if (filter.value) { settingFilter = true; filter.value = '' } return load(path, '') }
watch(filter, (v) => { if (settingFilter) { settingFilter = false; return } clearTimeout(filterTimer); filterTimer = setTimeout(() => load(listing.value?.path || lastPath.value, v), 250) })
async function load(path, flt = '') {
  const my = ++seq
  lastPath.value = path
  loading.value = true; error.value = null; errorCode.value = ''; errorHint.value = ''; selected.value = ''
  try {
    const r = await mountsAPI.dirs(path, hidden.value, flt)
    if (my !== seq) return
    listing.value = r
    typed.value = listing.value.path
    remember(listing.value.path)
  } catch (e) {
    if (my !== seq) return
    error.value = e.response?.data?.detail || e.message
    errorCode.value = e.response?.data?.code || e.code || (e.response?.status === 504 || e.status === 504 ? 'timeout' : ''); errorHint.value = e.response?.data?.hint || e.hint || ''; errorPath.value = path || ''
  } finally { if (my === seq) loading.value = false }
}

async function open() {
  mountsAPI.volumes().then((v) => { volumes.value = v }).catch(() => { volumes.value = [] })   // an older core: no section
  if (props.start) return go(props.start)
  const last = lastDir()
  if (!last) return go('')
  try { await go(last) } catch { /* unreachable */ }
  if (error.value) { error.value = null; await go('') }   // the remembered folder is gone: fall back to home
}

function choose() {
  const path = selected.value || listing.value?.path
  remember(path)
  emit('choose', path)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.folder-list { max-height: 50vh; overflow: auto; }
</style>
