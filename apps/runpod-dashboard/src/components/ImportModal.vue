<template>
  <BModal :model-value="ui.importOpen" :title="$t('import.title')" size="lg" lazy scrollable ok-only :ok-title="$t('connect.done')" ok-variant="outline-light" data-testid="import-modal" @show="onShow" @update:model-value="ui.importOpen = $event">
    <div v-if="ui.importPod" class="small text-body-secondary mb-2" data-testid="import-sync-note">{{ $t('import.syncNote', { name: ui.importPod.name }) }}</div>

    <!-- Asked only when Panama is configured; without it the modal is the folder import, as before. -->
    <div v-if="source === ''" data-testid="import-source-picker">
      <p class="text-body-secondary small">{{ $t('panama.pick') }}</p>
      <BRow class="g-3">
        <BCol md="6">
          <button type="button" class="card h-100 w-100 text-start p-3" data-testid="import-source-folder" @click="ui.importSource = 'folder'">
            <div class="fw-semibold mb-1"><i class="fa-solid fa-file-zipper me-2"></i>{{ $t('panama.sourceFolder') }}</div>
            <div class="small text-body-secondary">{{ $t('panama.sourceFolderHint') }}</div>
          </button>
        </BCol>
        <BCol md="6">
          <button type="button" class="card h-100 w-100 text-start p-3" data-testid="import-source-panama" @click="ui.importSource = 'panama'">
            <div class="fw-semibold mb-1"><i class="fa-brands fa-aws me-2"></i>{{ $t('panama.sourcePanama') }}</div>
            <div class="small text-body-secondary">{{ $t('panama.sourcePanamaHint', { bucket: panama.status?.bucket }) }}</div>
          </button>
        </BCol>
      </BRow>
    </div>
    <template v-else>
      <a v-if="configured" href="#" class="small d-inline-block mb-2" data-testid="import-source-change" @click.prevent="ui.importSource = ''"><i class="fa-solid fa-arrow-left me-1"></i>{{ $t('panama.change') }}</a>
      <PanamaPane v-if="source === 'panama'" />
      <ImportPane v-else :active="ui.importOpen" />
    </template>
  </BModal>
</template>

<script setup>
/**
 * ImportModal — Import Shot Pack (docs/ADR-008): a package folder into ComfyUI-Shared through an adapter. Its own modal,
 * opened by the pod card's primary button (`ui.importOpen`). When the Panama bucket is configured (an AWS profile, docs/ADR-015) it
 * first asks where the package comes from: a folder on this PC, or a round in the Panama S3 bucket; the pane inside does the work.
 */
import { computed } from 'vue'
import { useUiStore } from '../stores/ui'
import { usePanamaStore } from '../stores/panama'
import ImportPane from './ImportPane.vue'
import PanamaPane from './PanamaPane.vue'

const ui = useUiStore()
const panama = usePanamaStore()
const configured = computed(() => !!panama.status?.configured)
/** Not configured: straight to the folder import. Configured: ask until a source is chosen. */
const source = computed(() => (configured.value ? ui.importSource : 'folder'))
const onShow = async () => { ui.importShown++; ui.importSource = ''; await panama.loadStatus() }
</script>
