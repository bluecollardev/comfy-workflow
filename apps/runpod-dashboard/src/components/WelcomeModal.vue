<template>
  <BModal :model-value="ui.welcomeOpen" :title="$t('configio.welcomeTitle')" centered no-close-on-backdrop hide-footer data-testid="welcome-modal" @update:model-value="(v) => { if (!v) choose('scratch') }">
    <p data-testid="welcome-body">{{ $t('configio.welcomeBody') }}</p>
    <div class="d-grid gap-2">
      <BButton variant="primary" data-testid="welcome-import" @click="choose('import')"><i class="fa-solid fa-file-import me-2"></i>{{ $t('configio.welcomeImport') }}</BButton>
      <BButton variant="outline-light" data-testid="welcome-scratch" @click="choose('scratch')">{{ $t('configio.welcomeScratch') }}</BButton>
    </div>
    <p class="small text-body-secondary mt-3 mb-0">{{ $t('configio.welcomeNote') }}</p>
  </BModal>
</template>

<script setup>
/**
 * WelcomeModal — shown once, on a new installation (no RunPod key and no saved configuration), in front of Default Configuration (docs/ADR-023). One choice: load a
 * configuration file exported from another computer (Default Configuration opens scrolled to the import form), or set up from scratch (it opens as it always did, on the key).
 * Either answer is remembered in this browser, so it does not come back.
 */
import { useUiStore } from '../stores/ui'

const ui = useUiStore()
function choose(what) {
  try { localStorage.setItem('runpod-manager.welcome', 'seen') } catch { /* storage blocked: it may ask again next time */ }
  ui.welcomeOpen = false
  ui.configFocus = what === 'import' ? 'import' : ''
  ui.configOpen = true
}
</script>
