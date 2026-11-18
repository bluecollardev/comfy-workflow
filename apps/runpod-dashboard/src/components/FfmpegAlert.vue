<template>
  <BAlert :model-value="true" variant="warning" class="small py-2 mb-2" data-testid="pod-outputs-render-no-ffmpeg" :data-kind="problem.kind">
    <div class="fw-semibold">{{ problem.kind === 'broken' ? $t('outputs.render.noFfmpeg.broken') : $t('outputs.render.noFfmpeg.title') }}</div>
    <div data-testid="pod-outputs-render-no-ffmpeg-text">{{ problem.kind === 'broken' ? problem.reason : problem.reason || $t('outputs.render.noFfmpeg.advice') }}</div>
    <div v-if="problem.kind === 'missing'" class="d-flex align-items-center gap-2 mt-2">
      <code class="px-2 py-1 bg-dark rounded font-monospace" data-testid="pod-outputs-render-brew-command">{{ problem.hint }}</code>
      <BButton variant="outline-secondary" size="sm" data-testid="pod-outputs-render-copy-brew" @click="copy"><i class="fa-regular fa-copy me-1"></i>{{ copied ? $t('outputs.render.noFfmpeg.copied') : $t('outputs.render.noFfmpeg.copy') }}</BButton>
    </div>
    <BButton variant="outline-secondary" size="sm" class="mt-2" :disabled="busy" data-testid="pod-outputs-render-check-again" @click="$emit('check')"><BSpinner v-if="busy" small class="me-1" /><i v-else class="fa-solid fa-rotate me-1"></i>{{ $t('outputs.render.noFfmpeg.check') }}</BButton>
  </BAlert>
</template>

<script setup>
/** FfmpegAlert: the loud warning when ffmpeg is missing (or broken) on this PC and nothing else can render: the advice, the Homebrew command with a Copy button, and Check again (the parent re-plans, so it clears without a restart). */
import { ref } from 'vue'
import { BREW_COMMAND } from '../utils/renders'
defineProps({ problem: { type: Object, required: true }, busy: { type: Boolean, default: false } })
defineEmits(['check'])
const copied = ref(false)
async function copy() { try { await navigator.clipboard.writeText(BREW_COMMAND); copied.value = true; setTimeout(() => (copied.value = false), 2000) } catch { copied.value = false } }
</script>
