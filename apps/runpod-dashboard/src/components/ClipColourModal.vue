<template>
  <BModal :model-value="open" :title="$t('outputs.render.colourModalTitle', { name })" lazy ok-only :ok-title="$t('outputs.render.colourDone')" ok-variant="outline-light" data-testid="clip-colour-modal" @update:model-value="(v) => { if (!v) $emit('close') }">
    <div v-if="header" class="small text-body-secondary mb-2" data-testid="clip-colour-header">{{ $t('edl.headerSays', { t: header }) }}</div>
    <label class="small mb-1 d-block" for="clip-colour-select">{{ $t('edl.colour') }}</label>
    <select id="clip-colour-select" class="form-select form-select-sm" :value="modelValue" data-testid="pod-outputs-render-colour-in" :data-name="name" @change="$emit('update:modelValue', $event.target.value)">
      <option value="">{{ emptyLabel }}</option>
      <option v-for="c in colours" :key="c" :value="c">{{ $t(`edl.colours.${c}`) }}</option>
    </select>
    <div v-if="assumption" class="small text-body-secondary mt-2" data-testid="clip-colour-assumption">{{ assumption }}</div>
    <div v-if="suggested" class="small text-body-secondary mt-1" data-testid="pod-outputs-render-colour-suggested">{{ $t('edl.colourSuggested', { name: suggested }) }}</div>
    <div class="small text-body-secondary mt-2" data-testid="pod-outputs-render-colour-hint">{{ $t('edl.colourHint') }}</div>
    <BButton variant="link" size="sm" class="p-0 mt-2" :disabled="!modelValue" data-testid="clip-colour-reset" @click="$emit('update:modelValue', '')">{{ $t('outputs.render.colourReset') }}</BButton>
  </BModal>
</template>

<script setup>
/**
 * ClipColourModal: the colour of ONE sequence's frames. Its own choice wins over "Same colour for all", which wins over the default the core derives from the DPX header;
 * the first option says which of those applies when the choice is empty. Opened by the palette icon on a Generate row.
 */
defineProps({ open: { type: Boolean, default: false }, name: { type: String, default: '' }, header: { type: String, default: '' }, modelValue: { type: String, default: '' }, colours: { type: Array, default: () => [] }, emptyLabel: { type: String, default: '' }, assumption: { type: String, default: '' }, suggested: { type: String, default: '' } })
defineEmits(['update:modelValue', 'close'])
</script>
