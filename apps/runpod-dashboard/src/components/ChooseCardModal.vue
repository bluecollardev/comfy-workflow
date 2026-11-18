<template>
  <BModal :model-value="show" :title="$t('importRound.cardAll')" size="xl" scrollable lazy ok-only :ok-title="$t('importRound.cardsDone')" ok-variant="success" data-testid="choose-card-modal" @update:model-value="(v) => !v && $emit('close')">
    <div class="d-flex align-items-center gap-2 mb-2">
      <span class="small text-body-secondary">{{ $t('importRound.chooseCardHelp') }}</span>
      <BButton variant="outline-light" size="sm" class="py-0 ms-auto" :title="$t('form.datacenterRefresh')" :disabled="loading" data-testid="import-round-dc-refresh" @click="$emit('refresh')"><i class="fa-solid fa-rotate" :class="{ 'fa-spin': loading }"></i></BButton>
    </div>
    <DatacenterTable testid="import-round-dc" :list="list" :model-value="datacenter" :multi="true" :selected-cards="cards.map((c) => c.key)" :selected-card="cards[0]?.key || ''" :card-label="cardLabel" gpu-testid="import-round-dc-gpu" @update:model-value="$emit('update:datacenter', $event)" @pick="$emit('pick', $event)" @auto="$emit('auto')" />
  </BModal>
</template>

<script setup>
/** ChooseCardModal: the Create Pod card and datacenter table (DatacenterTable) in a window of its own, opened from Import Round's step 3. Several cards of ONE datacenter can be ticked (ranked in the order they were clicked: the first free one is used; a card at another datacenter replaces the selection); Done closes the window; the parent decides what it sets (every shot's card, the volume). */
import DatacenterTable from './DatacenterTable.vue'
defineProps({ show: { type: Boolean, default: false }, list: { type: Array, default: () => [] }, loading: { type: Boolean, default: false }, datacenter: { type: String, default: '' }, cards: { type: Array, default: () => [] }, /* [{ key, name, vram }] in click order */ cardLabel: { type: String, default: '' } })
defineEmits(['close', 'refresh', 'pick', 'auto', 'update:datacenter'])
</script>
