<template>
  <BModal :model-value="!!file" :title="file?.filename || ''" size="xl" centered scrollable lazy no-footer data-testid="output-viewer" @update:model-value="(v) => !v && $emit('close')">
    <div v-if="file" class="viewer-stage text-center" data-testid="output-viewer-stage" :data-kind="file.kind">
      <img v-if="file.kind === 'image'" :src="url" :alt="file.filename" class="viewer-media" data-testid="output-viewer-image" />
      <video v-else-if="file.kind === 'video'" :src="url" controls autoplay loop class="viewer-media" data-testid="output-viewer-video"></video>
      <audio v-else-if="file.kind === 'audio'" :src="url" controls autoplay class="w-100" data-testid="output-viewer-audio"></audio>
      <div v-else class="text-body-secondary py-5" data-testid="output-viewer-other"><i class="fa-regular fa-file fs-1 d-block mb-2"></i>{{ $t('outputs.noPreview') }}</div>
    </div>
    <div v-if="file" class="d-flex align-items-center gap-2 mt-3 small flex-wrap">
      <span class="badge" :class="file.type === 'output' ? 'text-bg-success' : 'text-bg-secondary'">{{ $t(`outputs.type.${file.type}`) }}</span>
      <span class="font-monospace text-body-secondary text-truncate" :title="path">{{ path }}</span>
      <span class="ms-auto d-flex gap-2">
        <BButton v-if="hasPrev" variant="outline-light" size="sm" data-testid="output-viewer-prev" :title="$t('outputs.prev')" @click="$emit('step', -1)"><i class="fa-solid fa-chevron-left"></i></BButton>
        <span v-if="count > 1" class="align-self-center text-body-secondary">{{ index + 1 }} / {{ count }}</span>
        <BButton v-if="hasNext" variant="outline-light" size="sm" data-testid="output-viewer-next" :title="$t('outputs.next')" @click="$emit('step', 1)"><i class="fa-solid fa-chevron-right"></i></BButton>
        <BButton variant="outline-light" size="sm" data-testid="output-viewer-open" :href="url" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square me-1"></i>{{ $t('outputs.open') }}</BButton>
        <BButton variant="primary" size="sm" data-testid="output-viewer-download" @click="download"><i class="fa-solid fa-download me-1"></i>{{ $t('outputs.download') }}</BButton>
      </span>
    </div>
    <div v-if="error" class="text-danger small mt-2" data-testid="output-viewer-error">{{ error }}</div>
  </BModal>
</template>

<script setup>
/** OutputViewerModal: one output file of a run, large (image, video or audio of the pod's ComfyUI /view), with Previous/Next among the gallery's files, Open in a new tab and Download. */
import { computed, ref, watch } from 'vue'
import { core } from '../api/bridge'
import { viewUrl } from '../utils/outputs'
import { errorText } from '../stores/toast'

const props = defineProps({ file: { type: Object, default: null }, base: { type: String, default: '' }, index: { type: Number, default: 0 }, count: { type: Number, default: 1 } })
defineEmits(['close', 'step'])
const error = ref('')
const url = computed(() => (props.file ? viewUrl(props.base, props.file) : ''))
const path = computed(() => (props.file ? [props.file.subfolder, props.file.filename].filter(Boolean).join('/') : ''))
const hasPrev = computed(() => props.index > 0), hasNext = computed(() => props.index < props.count - 1)
watch(() => props.file, () => { error.value = '' })
/** In the app: a Save As dialog and the bytes from the pod; in a browser: the address with a download attribute. */
async function download() {
  error.value = ''
  if (core?.files?.download) { try { await core.files.download(url.value, props.file.filename) } catch (e) { error.value = errorText(e) } return }
  const a = document.createElement('a'); a.href = url.value; a.download = props.file.filename; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove()
}
</script>

<style scoped>
.viewer-stage { background: #14161b; border-radius: 0.375rem; padding: 0.5rem; }
.viewer-media { max-width: 100%; max-height: 70vh; }
</style>
