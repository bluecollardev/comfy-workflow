<template>
  <BModal :model-value="c.open" :title="c.title || $t('confirm.title')" centered no-footer data-testid="confirm-modal" @update:model-value="(v) => !v && c.answer(false)">
    <p class="mb-3" data-testid="confirm-message" style="white-space: pre-line">{{ c.message }}</p>
    <div class="d-flex justify-content-end gap-2">
      <BButton variant="outline-light" size="sm" data-testid="confirm-cancel" @click="c.answer(false)">{{ $t('picker.cancel') }}</BButton>
      <BButton :variant="c.danger ? 'danger' : 'primary'" size="sm" data-testid="confirm-ok" @click="c.answer(true)">{{ c.okLabel || $t('confirm.ok') }}</BButton>
    </div>
  </BModal>
</template>

<script setup>
/** The one confirmation window (stores/confirm.js): pod and round deletes, moves, the Queue's cancels and purge, a volume's delete. */
import { useConfirmStore } from '../stores/confirm'
const c = useConfirmStore()
</script>
