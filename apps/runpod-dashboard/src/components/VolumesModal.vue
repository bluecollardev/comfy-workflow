<template>
  <BModal :model-value="ui.volumesOpen" :title="$t('volumes.title')" size="lg" lazy ok-only :ok-title="$t('volumes.done')" ok-variant="outline-light" @update:model-value="ui.volumesOpen = $event" @show="open">
    <p class="text-body-secondary small">{{ $t('volumes.intro') }}</p>

    <BAlert v-if="store.error" :model-value="true" variant="danger" dismissible class="mb-3" data-testid="volumes-error" @update:model-value="store.error = null">{{ store.error }}</BAlert>

    <h6 class="mb-2">{{ $t('volumes.createTitle') }}</h6>
    <BRow class="g-2 align-items-end">
      <BCol md="4">
        <BFormGroup :label="$t('volumes.name')" label-for="vol-name" class="mb-0">
          <BFormInput id="vol-name" v-model.trim="draft.name" data-testid="volume-new-name" />
        </BFormGroup>
      </BCol>
      <BCol md="2">
        <BFormGroup :label="$t('volumes.size')" label-for="vol-size" class="mb-0">
          <BFormInput id="vol-size" v-model.number="draft.size_gb" type="number" min="10" max="4000" data-testid="volume-new-size" />
        </BFormGroup>
      </BCol>
      <BCol md="4">
        <BFormGroup :label="$t('volumes.datacenter')" label-for="vol-dc" class="mb-0">
          <BFormSelect id="vol-dc" v-model="draft.datacenter" :options="dcOptions" data-testid="volume-new-dc" />
        </BFormGroup>
      </BCol>
      <BCol md="2">
        <BButton variant="primary" class="w-100" :disabled="!draft.name || !draft.datacenter || store.busyId !== null" data-testid="volume-create" @click="create">{{ $t('volumes.create') }}</BButton>
      </BCol>
    </BRow>
    <div class="form-text mb-3">{{ $t('volumes.createHelp', { cost: (draft.size_gb * 0.07).toFixed(2) }) }}</div>
    <h6 class="mb-2">{{ $t('volumes.listTitle') }}</h6>
    <div class="list-group" data-testid="volumes-list">
      <div v-if="store.loading && !store.volumes.length" class="list-group-item text-body-secondary"><BSpinner small class="me-2" />{{ $t('volumes.loading') }}</div>
      <div v-for="v in store.volumes" :key="v.id" class="list-group-item" data-testid="volume" :data-id="v.id">
        <div class="d-flex align-items-start gap-3">
          <i class="fa-solid fa-hard-drive fs-5 text-body-secondary mt-1"></i>
          <div class="flex-grow-1 lh-sm overflow-hidden">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold" data-testid="volume-name">{{ v.name }}</span>
              <code class="small" data-testid="volume-id">{{ v.id }}</code>
              <BBadge v-if="v.is_default" variant="primary" text-indicator data-testid="volume-default">{{ $t('volumes.isDefault') }}</BBadge>
              <BBadge v-if="v.s3" variant="info" text-indicator :title="$t('volumes.s3Title')" data-testid="volume-s3">S3</BBadge>
            </div>
            <small class="text-body-secondary d-block" data-testid="volume-facts">{{ $t('volumes.facts', { size: v.size_gb, dc: v.datacenter, cost: v.cost_per_month.toFixed(2) }) }}</small>
            <div class="small mt-1" data-testid="volume-pods">
              <template v-if="v.pods.length">
                <span class="text-body-secondary me-1">{{ $t('volumes.attachedTo') }}</span>
                <BBadge v-for="p in v.pods" :key="p.id" :variant="p.status === 'running' ? 'success' : p.status === 'starting' ? 'warning' : 'secondary'" class="me-1 fw-normal" :title="p.via === 'config' ? $t('volumes.viaConfig') : $t('volumes.viaRunpod', { status: p.status })" data-testid="volume-pod" :data-pod="p.id">
                  {{ p.name }} · {{ p.status }}<span v-if="p.via === 'config'"> · {{ $t('volumes.configOnly') }}</span>
                </BBadge>
              </template>
              <span v-else class="text-body-secondary">{{ $t('volumes.noPods') }}</span>
            </div>
          </div>
          <div class="vol-side d-flex flex-wrap gap-1 justify-content-end align-items-start flex-shrink-0">   <!-- icon buttons: the name is the tooltip and the accessible label -->
            <template v-if="resizing === v.id">
              <BFormInput v-model.number="resizeTo" type="number" :min="v.size_gb + 1" max="4000" size="sm" style="width: 6rem" data-testid="volume-resize-input" @keydown.enter.prevent="doResize(v)" @keydown.esc.prevent="resizing = null" />
              <BButton size="sm" class="text-nowrap" variant="primary" data-testid="volume-resize-save" @click="doResize(v)">{{ $t('volumes.grow') }}</BButton>
              <BButton size="sm" variant="outline-light" @click="resizing = null">{{ $t('picker.cancel') }}</BButton>
            </template>
            <template v-else>
              <BButton v-if="!v.is_default" size="sm" class="vol-icon" variant="outline-light" :disabled="store.busyId === v.id" :title="$t('volumes.useAsDefault')" :aria-label="$t('volumes.useAsDefault')" data-testid="volume-use-default" @click="store.useAsDefault(v)"><i class="fa-regular fa-star"></i></BButton>
              <BButton size="sm" class="vol-icon" variant="outline-light" :disabled="store.busyId === v.id" :title="$t('volumes.browse')" :aria-label="$t('volumes.browse')" data-testid="volume-browse" @click="browsing = v"><i class="fa-solid fa-folder-tree"></i></BButton>
              <BButton size="sm" class="vol-icon" variant="outline-light" :disabled="store.busyId === v.id" :title="$t('volumes.clone')" :aria-label="$t('volumes.clone')" data-testid="volume-clone" @click="cloning = v"><i class="fa-solid fa-clone"></i></BButton>
              <BButton size="sm" class="vol-icon" variant="outline-light" :disabled="store.busyId === v.id" :title="$t('volumes.resize')" :aria-label="$t('volumes.resize')" data-testid="volume-resize" @click="resizing = v.id; resizeTo = v.size_gb + 20"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></BButton>
              <BButton size="sm" class="vol-icon" variant="outline-danger" :disabled="store.busyId === v.id" :title="$t('volumes.erase')" :aria-label="$t('volumes.erase')" data-testid="volume-erase" @click="erasing = v"><i class="fa-solid fa-eraser"></i></BButton>
              <BButton size="sm" class="vol-icon" variant="outline-danger" :disabled="store.busyId === v.id || v.pods.some((p) => p.via === 'runpod')" :title="v.pods.some((p) => p.via === 'runpod') ? $t('volumes.deleteBlocked') : $t('volumes.delete')" :aria-label="$t('volumes.delete')" data-testid="volume-delete" @click="confirmRemove(v)"><i class="fa-solid fa-trash"></i></BButton>
            </template>
          </div>
        </div>
      </div>
      <div v-if="!store.loading && !store.volumes.length" class="list-group-item text-body-secondary" data-testid="volumes-empty">{{ $t('volumes.none') }}</div>
    </div>

  </BModal>
  <VolumeFilesModal :volume="browsing" @close="browsing = null" />
  <CloneVolumeModal :volume="cloning" @close="cloning = null" />
  <EraseVolumeModal :volume="erasing" @close="erasing = null" @erased="store.load()" />
</template>

<script setup>
/**
 * VolumesModal — the account's network volumes: name, id, size, datacenter (S3 marked), monthly cost,
 * which pods are attached (RunPod) or name it in their own configuration, and which one the Default
 * Configuration uses. Use as default, grow, delete (refused while a pod is attached), create.
 */
import { computed, reactive, ref } from 'vue'
import VolumeFilesModal from './VolumeFilesModal.vue'
import EraseVolumeModal from './EraseVolumeModal.vue'
import CloneVolumeModal from './CloneVolumeModal.vue'
import { useUiStore } from '../stores/ui'
import { useVolumesStore } from '../stores/volumes'
import { useConfirmStore } from '../stores/confirm'
import { podsAPI } from '../api/pods'
import { volumeDatacenterOptions } from '../utils/datacenters'
import { t } from '../i18n'

const ui = useUiStore()
const store = useVolumesStore()
const confirm = useConfirmStore()
const draft = reactive({ name: '', size_gb: 100, datacenter: '' })
const resizing = ref(null)
const browsing = ref(null), erasing = ref(null), cloning = ref(null)   // the volume whose files are open, or whose Erase is
const resizeTo = ref(0)
const dcList = ref([])
const dcOptions = computed(() => volumeDatacenterOptions(dcList.value, { value: '', text: t('volumes.pickDatacenter') }))

async function open() {
  store.load()
  try { dcList.value = (await podsAPI.datacenters()).datacenters || [] } catch { /* the menu stays empty; the id can still be typed in Default Configuration */ }
  if (ui.volumeDc) { draft.datacenter = ui.volumeDc; ui.volumeDc = '' }   // chosen on the pod form
}
async function create() {
  const r = await store.create({ name: draft.name, size_gb: Number(draft.size_gb), datacenter: draft.datacenter })
  if (r.ok) { draft.name = ''; draft.size_gb = 100 }
}
async function doResize(v) {
  const r = await store.resize(v, Number(resizeTo.value))
  if (r.ok) resizing.value = null
}
async function confirmRemove(v) {
  if (await confirm.ask(t('volumes.confirmDelete', { name: v.name, size: v.size_gb }), { okLabel: t('volumes.delete') })) store.remove(v)
}
</script>

<style scoped>
.vol-icon { width: 2rem; padding-left: 0; padding-right: 0; }   /* the same square for every action */
.vol-side { max-width: 16rem; }
</style>
