<template>
  <BModal :model-value="true" :title="$t('outputs.title', { name: pod.name })" size="xl" scrollable lazy no-footer data-testid="pod-outputs-modal" @update:model-value="(v) => !v && $emit('close')">
    <div class="d-flex align-items-center mb-2">
      <span class="small text-body-secondary">{{ $t('outputs.buttonTitle') }}</span>
      <BButton v-if="shown.length > 1" variant="outline-light" size="sm" class="ms-auto me-2" :disabled="!canZip || zipping" :title="canZip ? '' : $t('outputs.zipApp')" data-testid="pod-outputs-zip-all" @click="zipAll"><BSpinner v-if="zipping" small class="me-1" /><i v-else class="fa-solid fa-file-zipper me-1"></i>{{ $t('outputs.zipAllRuns') }}</BButton>
      <BButton variant="outline-light" size="sm" :class="{ 'ms-auto': runs.length <= 1 }" data-testid="pod-outputs-refresh" @click="$emit('refresh')"><i class="fa-solid fa-rotate me-1"></i>{{ $t('outputs.refresh') }}</BButton>
    </div>
    <label v-if="shot" class="d-flex align-items-center gap-2 small mb-3" data-testid="pod-outputs-shot-filter">
      <input v-model="onlyShot" type="checkbox" class="form-check-input mt-0" />{{ $t('outputs.onlyShot', { shot }) }}
      <span v-if="onlyShot && hidden" class="text-body-secondary">{{ $t('outputs.hiddenRuns', { n: hidden }) }}</span>
    </label>
    <div v-if="!shown.length" class="text-body-secondary small" data-testid="pod-outputs-empty">{{ $t(onlyShot && runs.length ? 'outputs.noRunsShot' : 'outputs.noRuns', { shot }) }}</div>
    <div v-for="r in shown" :key="r.prompt_id" class="mb-4" data-testid="pod-outputs-run" :data-prompt="r.prompt_id">
      <div class="d-flex align-items-baseline gap-2 flex-wrap mb-2 small" data-testid="pod-outputs-run-title">
        <template v-if="r.workflow"><span class="fw-semibold font-monospace" data-testid="pod-outputs-workflow" :title="r.workflow">{{ runName(r) }}</span><span class="text-body-secondary font-monospace" :title="r.workflow">{{ folderOf(r.workflow) }}</span></template>
        <template v-else-if="r.guess"><span class="fw-semibold font-monospace" data-testid="pod-outputs-workflow" :title="$t('outputs.guessTitle')">≈ {{ r.guess }}</span><span class="text-body-secondary">{{ $t('outputs.guessed') }}</span></template>
        <span v-else class="fw-semibold text-body-secondary" data-testid="pod-outputs-workflow">{{ $t('outputs.unnamed') }}</span>
        <span class="text-body-secondary ms-auto">{{ $t('outputs.run', { when: new Date(r.started_at).toLocaleString(), s: r.duration_s ?? '?' }) }} · <span class="font-monospace">{{ r.prompt_id.slice(0, 8) }}</span></span>
      </div>
      <OutputsGallery :files="r.files" :base="pod.web_ui_url || ''" :zip-name="`${runName(r) || pod.name}-${r.prompt_id.slice(0, 8)}.zip`" />
    </div>
  </BModal>
</template>

<script setup>
/** PodOutputsModal: every file the pod's finished runs produced (from ComfyUI's history), run by run, in the reusable OutputsGallery (viewer, download). */
import { computed, ref } from 'vue'
import OutputsGallery from './OutputsGallery.vue'
import { core } from '../api/bridge'
import { viewUrl, runName, runsForShot } from '../utils/outputs'
import { errorText } from '../stores/toast'
const folderOf = (p) => p.split('/').slice(0, -1).join('/')
const props = defineProps({ pod: { type: Object, required: true }, runs: { type: Array, default: () => [] } })
defineEmits(['close', 'refresh'])
const canZip = !!core?.files?.downloadZip, zipping = ref(false)
// The pod's Shot (the card's field) narrows the list to that shot's runs; "All Shots", or no shot, shows every run. A checkbox turns it off.
const shot = computed(() => (props.pod.shot && props.pod.shot !== 'All Shots' ? props.pod.shot : ''))
const onlyShot = ref(true)
const shown = computed(() => (shot.value && onlyShot.value ? runsForShot(props.runs, shot.value) : props.runs))
const hidden = computed(() => props.runs.length - shown.value.length)
/** Every run's files in one zip, a folder per run. */
async function zipAll() {
  zipping.value = true
  try { await core.files.downloadZip(shown.value.flatMap((r) => r.files.map((f) => ({ url: viewUrl(props.pod.web_ui_url || '', f, { web: true }), name: `${(runName(r) || String(r.started_at).replace(/[:T]/g, '-').slice(0, 19)).replace(/[^\w.-]+/g, '_')}-${r.prompt_id.slice(0, 8)}/${[f.subfolder, f.filename].filter(Boolean).join('/')}` }))), `${props.pod.name}-outputs.zip`) } catch (e) { alert(errorText(e)) } finally { zipping.value = false }
}
</script>
