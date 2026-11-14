<template>
  <BModal :model-value="show" :title="$t('importRound.cardAll')" size="xl" scrollable lazy ok-only :ok-title="$t('panama.filesClose')" ok-variant="outline-light" data-testid="choose-card-modal" @update:model-value="(v) => !v && $emit('close')">
    <div class="d-flex align-items-center gap-2 mb-2">
      <span class="small text-body-secondary">{{ $t('importRound.chooseCardHelp') }}</span>
      <BButton variant="outline-light" size="sm" class="py-0 ms-auto" :title="$t('form.datacenterRefresh')" :disabled="loading" data-testid="import-round-dc-refresh" @click="$emit('refresh')"><i class="fa-solid fa-rotate" :class="{ 'fa-spin': loading }"></i></BButton>
    </div>
    <DatacenterTable testid="import-round-dc" :list="list" :model-value="datacenter" :selected-card="card" :card-label="cardLabel" gpu-testid="import-round-dc-gpu" @update:model-value="$emit('update:datacenter', $event)" @pick="$emit('pick', $event)" @auto="$emit('auto')" />
  </BModal>
</template>

<script setup>
/** ChooseCardModal: the Create Pod card and datacenter table (DatacenterTable) in a window of its own, opened from Import Round's step 3. A card at a datacenter is one click; the parent decides what it sets (every shot's card, the volume). */
import DatacenterTable from './DatacenterTable.vue'
defineProps({ show: { type: Boolean, default: false }, list: { type: Array, default: () => [] }, loading: { type: Boolean, default: false }, datacenter: { type: String, default: '' }, card: { type: String, default: '' }, cardLabel: { type: String, default: '' } })
defineEmits(['close', 'refresh', 'pick', 'auto', 'update:datacenter'])
</script>
