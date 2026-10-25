<template>
  <BModal :model-value="ui.importOpen" :title="$t('import.title')" size="lg" lazy scrollable ok-only :ok-title="$t('connect.done')" ok-variant="outline-light" data-testid="import-modal" @show="ui.importShown++" @update:model-value="ui.importOpen = $event">
    <div v-if="ui.importPod" class="small text-body-secondary mb-2" data-testid="import-sync-note">{{ $t('import.syncNote', { name: ui.importPod.name }) }}</div>
    <ImportPane :active="ui.importOpen" />
  </BModal>
</template>

<script setup>
/**
 * ImportModal — Import Shot Pack (docs/ADR-008): a package folder into ComfyUI-Shared through an adapter. Its own modal,
 * opened by the pod card's primary button (`ui.importOpen`); the pane inside does the work.
 */
import { useUiStore } from '../stores/ui'
import ImportPane from './ImportPane.vue'

const ui = useUiStore()
</script>
