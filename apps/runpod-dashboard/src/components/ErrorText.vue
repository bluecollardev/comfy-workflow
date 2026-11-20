<template>
  <span data-testid="error-text" :data-long="long ? 'true' : 'false'">
    <span data-testid="error-text-short">{{ short }}</span>
    <BButton v-if="long" variant="link" size="sm" class="p-0 ms-1 align-baseline" data-testid="error-text-open" @click.stop="shown = true">{{ $t('errorText.more') }}</BButton>
    <BModal v-if="long" v-model="shown" :title="title || $t('errorText.title')" size="lg" scrollable ok-only :ok-title="$t('errorText.close')" ok-variant="outline-light" data-testid="error-text-modal">
      <pre class="small mb-2 text-wrap" style="white-space: pre-wrap; word-break: break-word" data-testid="error-text-full">{{ text }}</pre>
      <BButton size="sm" variant="outline-light" data-testid="error-text-copy" @click="copy"><i class="fa-solid fa-copy me-1"></i>{{ copied ? $t('errorText.copied') : $t('errorText.copy') }}</BButton>
    </BModal>
  </span>
</template>

<script setup>
/** A long error cut to a line, with a link that opens the whole text (and copies it) in a window. */
import { computed, ref } from 'vue'
const props = defineProps({ text: { type: String, default: '' }, max: { type: Number, default: 140 }, title: { type: String, default: '' } })
const shown = ref(false), copied = ref(false)
const long = computed(() => props.text.length > props.max)
const short = computed(() => (long.value ? `${props.text.slice(0, props.max).trimEnd()}…` : props.text))
async function copy() { try { await navigator.clipboard.writeText(props.text); copied.value = true; setTimeout(() => { copied.value = false }, 2000) } catch { copied.value = false } }
</script>
