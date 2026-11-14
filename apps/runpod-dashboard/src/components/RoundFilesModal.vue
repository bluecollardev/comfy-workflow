<template>
  <BModal :model-value="!!round" :title="shot ? `${round} / ${shot}` : (round || '')" size="xl" scrollable lazy ok-only :ok-title="$t('panama.filesClose')" ok-variant="outline-light" data-testid="round-files-modal" @update:model-value="(v) => !v && $emit('close')">
    <div v-if="loading" class="text-body-secondary small" data-testid="round-files-loading"><BSpinner small class="me-2" />{{ $t('panama.filesLoading') }}</div>
    <BAlert v-else-if="error" :model-value="true" variant="danger" data-testid="round-files-error">{{ error }}</BAlert>
    <template v-else-if="listing">
      <div class="small text-body-secondary mb-2" data-testid="round-files-summary">
        {{ $t('panama.sizeLine', shown) }}
        <span class="ms-2">{{ $t(target === 'pod' ? 'panama.filesBucketPod' : 'panama.filesBucket') }}</span>
      </div>
      <div class="explorer rounded" data-testid="round-files-tree">
        <StudioTreeRows :rows="rows" :empty="$t('panama.filesEmpty')" testid="round-files" @toggle="toggle" />
      </div>
    </template>
  </BModal>
</template>

<script setup>
/** RoundFilesModal: the files of one delivery round in the bucket as a folder tree (read-only). On Local, a file already on this PC is ticked. */
import { computed, reactive, ref, watch } from 'vue'
import { panamaAPI } from '../api/panama'
import { treeRows, fmtBytes as fmt } from '../utils/studioTree'
import StudioTreeRows from './StudioTreeRows.vue'

const props = defineProps({ round: { type: String, default: '' }, shot: { type: String, default: '' }, target: { type: String, default: 'local' } })   // `shot`: only that shot's folder
defineEmits(['close'])
const loading = ref(false), error = ref(''), listing = ref(null)
const collapsed = reactive(new Set())
const toggle = (p) => (collapsed.has(p) ? collapsed.delete(p) : collapsed.add(p))
const entries = computed(() => (listing.value?.entries || []).filter((e) => !props.shot || e.path === props.shot || e.path.startsWith(`${props.shot}/`)))
const shown = computed(() => { const fs = entries.value.filter((e) => !e.dir); return { files: fs.length, size: fmt(props.shot ? fs.reduce((a, e) => a + (e.size ?? e.bytes ?? 0), 0) : listing.value?.bytes ?? 0) } })
const rows = computed(() => treeRows(entries.value, collapsed, (e) => ({ status: !e.dir && props.target === 'local' && e.local ? 'copy' : '', to: [] })))
watch(() => [props.round, props.shot], async ([r]) => {
  listing.value = null; error.value = ''; collapsed.clear()
  if (!r) return
  loading.value = true
  try {
    listing.value = await panamaAPI.files(r)
    for (const e of entries.value) if (e.dir && e.path.includes('/') && e.path !== props.shot) collapsed.add(e.path)   // the top level open, deeper folders closed
  } catch (e) { error.value = e?.response?.data?.error || e?.message || String(e) } finally { loading.value = false }
}, { immediate: true })
</script>

<style scoped>
.explorer { background: #20232a; max-height: 60vh; overflow: auto; }
</style>
