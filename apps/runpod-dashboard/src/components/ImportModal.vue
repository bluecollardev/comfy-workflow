<template>
  <BModal :model-value="ui.importOpen" :title="$t('import.title')" size="lg" lazy scrollable ok-only :ok-title="$t('connect.done')" ok-variant="outline-light" data-testid="import-modal" @show="onShow" @update:model-value="ui.importOpen = $event">
    <div v-if="ui.importPod" class="small text-body-secondary mb-2" data-testid="import-sync-note">{{ $t('import.syncNote', { name: ui.importPod.name }) }}</div>

    <!-- Always asked first: one Import Shot Pack button, then where the package comes from. -->
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
          <button type="button" class="card h-100 w-100 text-start p-3" :disabled="!configured" :class="{ 'opacity-50': !configured }" data-testid="import-source-panama" @click="ui.importSource = 'panama'">
            <div class="fw-semibold mb-1"><i class="fa-brands fa-aws me-2"></i>{{ $t('panama.sourcePanama') }}</div>
            <div class="small text-body-secondary">{{ $t('panama.sourcePanamaHint', { bucket: panama.status?.bucket || 'the BH bucket' }) }}</div>
          </button>
          <div v-if="!configured" class="small mt-1" data-testid="import-source-panama-setup">
            <span class="text-body-secondary">{{ $t('panama.notConfigured') }}</span>
            <a href="#" class="ms-1 fw-semibold" @click.prevent="setUp">{{ $t('panama.setUp') }}</a>
          </div>
        </BCol>
      </BRow>
    </div>
    <template v-else>
      <a href="#" class="small d-inline-block mb-2" data-testid="import-source-change" @click.prevent="ui.importSource = ''"><i class="fa-solid fa-arrow-left me-1"></i>{{ $t('panama.change') }}</a>
      <PanamaPane v-if="source === 'panama'" />
      <ImportPane v-else :active="ui.importOpen" />
    </template>
  </BModal>
</template>

<script setup>
/**
 * ImportModal — Import Shot Pack (docs/ADR-008): a package folder into ComfyUI-Shared through an adapter. Its own modal,
 * opened by the pod card's single Import Shot Pack button (`ui.importOpen`). It always asks first where the package comes from: a folder or zip on
 * this PC, or a round in the Panama S3 bucket (disabled until the bucket is configured, docs/ADR-015, ADR-016); the pane inside does the work.
 */
import { computed } from 'vue'
import { useUiStore } from '../stores/ui'
import { usePanamaStore } from '../stores/panama'
import ImportPane from './ImportPane.vue'
import PanamaPane from './PanamaPane.vue'

const ui = useUiStore()
const panama = usePanamaStore()
const configured = computed(() => !!panama.status?.configured)
/** The source chosen on the picker: '' (asking), 'folder' or 'panama' (only reachable when configured). */
const source = computed(() => (ui.importSource === 'panama' && !configured.value ? '' : ui.importSource))
/** The Panama card is disabled until the bucket keys (or an AWS profile) exist: this opens Default Configuration where they are entered. */
const setUp = () => { ui.importOpen = false; ui.configOpen = true }
const onShow = async () => {
  ui.importShown++
  ui.importSource = ''   // always start on the picker
  await panama.loadStatus()
}
</script>
