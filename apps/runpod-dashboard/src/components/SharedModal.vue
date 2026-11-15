<template>
  <BModal :model-value="ui.sharedOpen" :title="$t('shared.title')" size="md" lazy no-footer data-testid="shared-modal" @update:model-value="ui.sharedOpen = $event">
    <p class="small text-body-secondary mb-3">{{ $t('shared.intro') }}</p>
    <div class="row g-3">
      <div class="col-sm-6">
        <button type="button" class="card h-100 w-100 text-start p-3" data-testid="shared-volumes" @click="go('volumes')">
          <div class="fw-semibold mb-1"><i class="fa-solid fa-hard-drive me-2"></i>{{ $t('shared.volumes') }}</div>
          <div class="small text-body-secondary">{{ $t('shared.volumesHelp') }}</div>
        </button>
      </div>
      <div class="col-sm-6">
        <button type="button" class="card h-100 w-100 text-start p-3" data-testid="shared-models" @click="go('models')">
          <div class="fw-semibold mb-1"><i class="fa-solid fa-cubes me-2"></i>{{ $t('shared.models') }}</div>
          <div class="small text-body-secondary">{{ $t('shared.modelsHelp') }}</div>
        </button>
      </div>
    </div>
  </BModal>
</template>

<script setup>
/** SharedModal: the Shared button's chooser. Volumes (the account's network volumes) and Models (Hugging Face onto the Shared volume) each have their own window (ADR-042 section 9). */
import { useUiStore } from '../stores/ui'

const ui = useUiStore()
function go(which) {
  ui.sharedOpen = false
  if (which === 'volumes') ui.volumesOpen = true; else ui.modelsOpen = true
}
</script>
