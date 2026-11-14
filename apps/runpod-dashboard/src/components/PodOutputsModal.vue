<template>
  <BModal :model-value="true" :title="$t('outputs.title', { name: pod.name })" size="xl" scrollable lazy no-footer data-testid="pod-outputs-modal" @update:model-value="(v) => !v && $emit('close')">
    <div class="d-flex align-items-center mb-2">
      <span class="small text-body-secondary">{{ $t('outputs.buttonTitle') }}</span>
      <BButton variant="outline-light" size="sm" class="ms-auto" data-testid="pod-outputs-refresh" @click="$emit('refresh')"><i class="fa-solid fa-rotate me-1"></i>{{ $t('outputs.refresh') }}</BButton>
    </div>
    <div v-if="!runs.length" class="text-body-secondary small" data-testid="pod-outputs-empty">{{ $t('outputs.noRuns') }}</div>
    <div v-for="r in runs" :key="r.prompt_id" class="mb-4" data-testid="pod-outputs-run" :data-prompt="r.prompt_id">
      <div class="small text-body-secondary mb-2">{{ $t('outputs.run', { when: new Date(r.started_at).toLocaleString(), s: r.duration_s ?? '?' }) }} · <span class="font-monospace">{{ r.prompt_id.slice(0, 8) }}</span></div>
      <OutputsGallery :files="r.files" :base="pod.web_ui_url || ''" />
    </div>
  </BModal>
</template>

<script setup>
/** PodOutputsModal: every file the pod's finished runs produced (from ComfyUI's history), run by run, in the reusable OutputsGallery (viewer, download). */
import OutputsGallery from './OutputsGallery.vue'
defineProps({ pod: { type: Object, required: true }, runs: { type: Array, default: () => [] } })
defineEmits(['close', 'refresh'])
</script>
