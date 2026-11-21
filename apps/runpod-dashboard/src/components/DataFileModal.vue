<template>
  <Teleport to="body">
    <div v-if="files.length" class="viewer-overlay" data-testid="datafile-modal" @click.self="$emit('close')">
      <div class="viewer-card" role="dialog" aria-modal="true" :aria-label="file ? file.filename : ''">
        <div class="d-flex align-items-center gap-2 mb-2">
          <strong class="text-truncate" data-testid="datafile-title">{{ file ? file.filename : '' }}</strong>
          <span v-if="file && file.bytes != null" class="text-body-secondary small" data-testid="datafile-size">{{ sizeText(file.bytes) }}</span>
          <button type="button" class="btn-close btn-close-white ms-auto" :aria-label="$t('pod.close')" data-testid="datafile-close" @click="$emit('close')"></button>
        </div>
        <div v-if="files.length > 1" class="d-flex flex-wrap gap-1 mb-2" data-testid="datafile-list">
          <BButton v-for="(f, i) in files" :key="`${f.subfolder}/${f.filename}`" size="sm" :variant="i === index ? 'primary' : 'outline-light'" class="text-truncate" style="max-width: 18rem" :title="f.filename" data-testid="datafile-item" @click="select(i)">{{ f.filename }}</BButton>
        </div>
        <div v-if="state === 'loading'" class="text-body-secondary py-4 text-center" data-testid="datafile-loading"><BSpinner small class="me-2" />{{ $t('outputs.data.loading') }}</div>
        <div v-else-if="state === 'error'" class="py-3" data-testid="datafile-error">
          <div class="text-danger mb-2">{{ error }}</div>
          <BButton size="sm" variant="outline-light" data-testid="datafile-retry" @click="load">{{ $t('outputs.data.retry') }}</BButton>
        </div>
        <div v-else-if="state === 'binary'" class="text-body-secondary py-3" data-testid="datafile-binary"><i class="fa-regular fa-file fs-3 d-block mb-2"></i>{{ $t('outputs.data.binary') }}</div>
        <template v-else-if="state === 'text'">
          <pre class="datafile-text" data-testid="datafile-text">{{ shown }}</pre>
          <div v-if="truncated" class="small text-warning mt-1" data-testid="datafile-truncated">{{ $t('outputs.data.truncated') }}</div>
        </template>
        <div class="d-flex gap-2 mt-3">
          <BButton v-if="state === 'text'" size="sm" variant="outline-light" data-testid="datafile-copy" @click="copy"><i class="fa-solid fa-copy me-1"></i>{{ copied ? $t('outputs.data.copied') : $t('outputs.data.copy') }}</BButton>
          <BButton size="sm" variant="outline-light" :disabled="!file || downloading" data-testid="datafile-download" @click="download"><BSpinner v-if="downloading" small class="me-1" /><i v-else class="fa-solid fa-download me-1"></i>{{ $t('outputs.data.download') }}</BButton>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
/** DataFileModal: the run's data files (usually one json/txt/csv) in a popup, the text of the selected one pretty-printed, read lazily (only when the popup opens) through the route the gallery uses. */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { viewUrl, sizeText } from '../utils/outputs'
import { PREVIEW_MAX, isTextName, readText, pretty } from '../utils/datafile'
import { errorText } from '../stores/toast'

const props = defineProps({ files: { type: Array, default: () => [] }, base: { type: String, default: '' } })
const emit = defineEmits(['close'])
const index = ref(0), state = ref('loading'), error = ref(''), text = ref(''), truncated = ref(false), copied = ref(false), downloading = ref(false)
const file = computed(() => props.files[index.value] || null)
const shown = computed(() => (file.value ? pretty(file.value.filename, text.value, truncated.value) : ''))
let seq = 0
async function load() {
  const f = file.value
  if (!f) return
  const mine = ++seq
  error.value = ''; text.value = ''; truncated.value = false; copied.value = false
  if (!isTextName(f.filename)) { state.value = 'binary'; return }   // an unknown type: name, size and Download only
  state.value = 'loading'
  try {
    const res = await fetch(viewUrl(props.base, f), { headers: { range: `bytes=0-${PREVIEW_MAX - 1}` } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const r = await readText(res)
    if (mine !== seq) return
    if (r.binary) { state.value = 'binary'; return }
    const total = Number((/\/(\d+)$/.exec(res.headers.get('content-range') || '') || [])[1] || 0)
    text.value = r.text; truncated.value = r.truncated || total > PREVIEW_MAX; state.value = 'text'
  } catch (e) { if (mine === seq) { error.value = errorText(e); state.value = 'error' } }
}
const select = (i) => { index.value = i; load() }
async function copy() { try { await navigator.clipboard.writeText(shown.value); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* the clipboard may be blocked: nothing to do */ } }
async function download() {
  const f = file.value
  if (!f) return
  downloading.value = true
  try {
    const res = await fetch(viewUrl(props.base, f))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const url = URL.createObjectURL(await res.blob()), a = document.createElement('a')
    a.href = url; a.download = f.filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000)
  } catch (e) { error.value = errorText(e); state.value = 'error' } finally { downloading.value = false }
}
const onKey = (e) => { if (props.files.length && e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); emit('close') } }
window.addEventListener('keydown', onKey, true)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
watch(() => props.files, (fs) => { if (fs.length) { index.value = 0; load() } }, { immediate: true })
</script>

<style scoped>
.viewer-overlay { position: fixed; inset: 0; z-index: 2600; background: rgba(0, 0, 0, 0.8); display: flex; align-items: center; justify-content: center; padding: 1.5rem; }
.viewer-card { background: #20232a; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 0.5rem; padding: 1rem; max-width: min(96vw, 1000px); max-height: 90vh; overflow: auto; width: 100%; }
.datafile-text { margin: 0; padding: 0.75rem; background: #14161b; border-radius: 0.375rem; max-height: 60vh; overflow: auto; font-size: 0.8rem; white-space: pre-wrap; word-break: break-word; color: #d7dae0; }
</style>
