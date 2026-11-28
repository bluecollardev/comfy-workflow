<template>
  <BModal :model-value="ui.volumesOpen" :title="$t('volumes.title')" size="xl" lazy scrollable @update:model-value="setOpen" @show="open" @hidden="stopUsage">
    <p class="text-body-secondary small">{{ $t('volumes.intro') }}</p>

    <BAlert v-if="store.error" :model-value="true" variant="danger" dismissible class="mb-3" data-testid="volumes-error" @update:model-value="store.error = null">{{ store.error }}</BAlert>

    <h6 class="mb-2">{{ $t('volumes.createTitle') }}</h6>
    <div class="d-flex flex-wrap gap-3 mb-2" data-testid="volume-new-type">
      <label class="small"><input v-model="createType" type="radio" value="volume" class="form-check-input me-1" data-testid="volume-new-type-volume" />{{ $t('volumes.typeVolume') }}</label>
      <label class="small"><input v-model="createType" type="radio" value="wasabi" class="form-check-input me-1" data-testid="volume-new-type-wasabi" />{{ $t('volumes.typeWasabi') }}</label>
      <label class="small"><input v-model="createType" type="radio" value="s3" class="form-check-input me-1" data-testid="volume-new-type-s3" />{{ $t('volumes.typeS3') }}</label>
    </div>
    <StorageAddForm v-if="createType !== 'volume'" :type="createType" hide-type :help="$t('volumes.linkHelp')" @saved="storageAdded" @cancel="createType = 'volume'" @error="(m) => { store.error = m }" />
    <template v-else>
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
    </template>
    <h6 class="mb-2">{{ $t('volumes.listTitle') }}</h6>
    <div class="list-group" data-testid="volumes-list">
      <div v-if="store.loading && !store.volumes.length" class="list-group-item text-body-secondary"><BSpinner small class="me-2" />{{ $t('volumes.loading') }}</div>
      <div v-if="!store.loading && !store.volumes.length" class="list-group-item text-body-secondary" data-testid="volumes-empty">{{ $t('volumes.none') }}</div>
      <template v-for="r in rows" :key="r.key">
      <template v-if="r.kind === 'volume'"><div v-for="v in [r.item]" :key="v.id" class="list-group-item" :class="{ 'vol-over': overId === v.id && dragId !== v.id, 'opacity-50': dragId === v.id }" data-testid="volume" :data-id="v.id" @dragover="dragOver($event, v.id)" @drop.prevent="dropRow(v.id)">
        <div class="d-flex align-items-start gap-3">
          <span class="text-body-secondary mt-1" style="cursor: grab" draggable="true" role="button" :title="$t('volumes.dragHandle')" :aria-label="$t('volumes.dragHandle')" data-testid="volume-drag-handle" @dragstart="dragStart($event, v.id)" @dragend="dragEnd"><i class="fa-solid fa-grip-vertical"></i></span>
          <i class="fa-solid fa-hard-drive fs-5 text-body-secondary mt-1"></i>
          <div class="flex-grow-1 lh-sm overflow-hidden">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold" data-testid="volume-name">{{ v.name }}</span>
              <code class="small" data-testid="volume-id">{{ v.id }}</code>
              <BBadge v-if="v.is_default" variant="primary" text-indicator data-testid="volume-default">{{ $t('volumes.isDefault') }}</BBadge>
              <BBadge v-if="v.is_shared" variant="success" :title="$t('volumes.sharedBadgeTitle')" data-testid="volume-shared-badge"><i class="fa-solid fa-share-nodes me-1"></i>{{ $t('volumes.sharedBadge') }}</BBadge>
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
              <span v-if="!v.is_default" v-tip="$t('volumes.useAsDefault')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-light" :disabled="store.busyId === v.id" :aria-label="$t('volumes.useAsDefault')" data-testid="volume-use-default" @click="store.useAsDefault(v)"><i class="fa-regular fa-star"></i></BButton></span>
              <span v-tip="v.is_shared ? $t('volumes.notShared') : $t('volumes.makeShared')" class="tipwrap"><BButton size="sm" class="vol-icon" :variant="v.is_shared ? 'success' : 'outline-light'" :disabled="store.busyId === v.id" :aria-label="v.is_shared ? $t('volumes.notShared') : $t('volumes.makeShared')" data-testid="volume-set-shared" @click="store.setShared(v.is_shared ? null : v)"><i class="fa-solid fa-share-nodes"></i></BButton></span>
              <BButton size="sm" variant="outline-light" class="text-nowrap px-2" :disabled="store.busyId === v.id" :title="$t('volumes.syncTitle')" :aria-label="$t('volumes.sync')" data-testid="volume-sync-btn" @click="ui.syncFor = { volumeId: v.id, volumeName: v.name }"><i class="fa-solid fa-arrows-rotate"></i></BButton>
              <span v-tip="$t('volumes.browse')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-light" :disabled="store.busyId === v.id" :aria-label="$t('volumes.browse')" data-testid="volume-browse" :title="$t('volumes.browse')" @click="browsing = v"><i class="fa-solid fa-folder-open"></i></BButton></span>
              <span v-tip="$t('volumes.clone')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-light" :disabled="store.busyId === v.id" :aria-label="$t('volumes.clone')" data-testid="volume-clone" @click="cloning = v"><i class="fa-solid fa-clone"></i></BButton></span>
              <span v-tip="$t('volumes.resize')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-light" :disabled="store.busyId === v.id" :aria-label="$t('volumes.resize')" data-testid="volume-resize" @click="resizing = v.id; resizeTo = v.size_gb + 20"><i class="fa-solid fa-up-right-and-down-left-from-center"></i></BButton></span>
              <span v-tip="$t('volumes.erase')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-danger" :disabled="store.busyId === v.id" :aria-label="$t('volumes.erase')" data-testid="volume-erase" @click="erasing = v"><i class="fa-solid fa-eraser"></i></BButton></span>
              <span v-tip="deleteReason(v) || $t('volumes.delete')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-danger" :disabled="store.busyId === v.id || !!deleteReason(v)" :aria-label="deleteReason(v) || $t('volumes.delete')" data-testid="volume-delete" @click="confirmRemove(v)"><i class="fa-solid fa-trash"></i></BButton></span>
            </template>
          </div>
        </div>
        <VolumeSyncRules v-if="volForms[v.id]" :volume="v" :volumes="store.volumes" :storages="sendStorages" :settings="volAuto[v.id] || null" :rules="rules" :form="volForms[v.id]" @changed="refreshRules" />
      </div>
      </template>
      <template v-if="r.kind === 'storage'"><div v-for="s in [r.item]" :key="s.id" class="list-group-item" :class="{ 'vol-over': overId === s.id && dragId !== s.id, 'opacity-50': dragId === s.id }" data-testid="volume-storage" :data-id="s.id" @dragover="dragOver($event, s.id)" @drop.prevent="dropRow(s.id)">   <!-- an S3-compatible storage adapter: laid out like a volume row, read-only here -->
        <div class="d-flex align-items-start gap-3">
          <span class="text-body-secondary mt-1" style="cursor: grab" draggable="true" role="button" :title="$t('storage.dragHandle')" :aria-label="$t('storage.dragHandle')" data-testid="storage-row-drag-handle" @dragstart="dragStart($event, s.id)" @dragend="dragEnd"><i class="fa-solid fa-grip-vertical"></i></span>
          <i class="fa-solid fa-bucket fs-5 text-body-secondary mt-1"></i>
          <div class="flex-grow-1 lh-sm overflow-hidden">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold" data-testid="volume-storage-name">{{ s.name }}</span>
              <code v-if="s.bucket" class="small" data-testid="volume-storage-facts">{{ s.bucket }}</code>
              <small v-else class="text-body-secondary" data-testid="volume-storage-facts">{{ $t('volumes.storageNoBucket') }}</small>
              <BBadge variant="info" :title="$t('volumes.storageBadgeTitle')" data-testid="volume-storage-badge"><i class="fa-solid fa-bucket me-1"></i>{{ $t('volumes.storageBadge') }}</BBadge>
              <BBadge v-if="s.default" variant="primary" data-testid="volume-storage-default">{{ $t('storage.defaultBadge') }}</BBadge>
              <BBadge variant="info" text-indicator data-testid="volume-storage-kind">{{ s.kind === 'wasabi' ? $t('volumes.storageKindWasabi') : $t('volumes.storageKindS3') }}</BBadge>
              <BBadge :variant="s.enabled ? 'success' : 'secondary'" text-indicator data-testid="volume-storage-enabled">{{ s.enabled ? $t('volumes.storageOn') : $t('volumes.storageOff') }}</BBadge>
              <BBadge :variant="s.ready ? 'success' : 'warning'" :title="s.problem || ''" data-testid="volume-storage-ready">{{ s.ready ? $t('volumes.storageReady') : $t('volumes.storageNotReady', { problem: s.problem || '' }) }}</BBadge>
            </div>
            <small v-if="s.bucket" class="text-body-secondary d-block" :title="usageTitle(s)" data-testid="volume-storage-size">{{ sizeLine(s) }}</small>
            <div class="small mt-1" data-testid="volume-storage-usedby">
              <span class="text-body-secondary me-1">{{ $t('volumes.usedBy') }}</span>
              <template v-if="usedEvents(s.id).length"><BBadge v-for="e in usedEvents(s.id)" :key="e" variant="secondary" class="me-1 fw-normal" data-testid="volume-storage-event" :data-event="e">{{ $t(`storage.event.${e}`) }}</BBadge></template>
              <span v-else class="text-body-secondary">{{ $t('volumes.usedByNone') }}</span>
            </div>
          </div>
          <div class="vol-side d-flex flex-wrap gap-1 justify-content-end align-items-start flex-shrink-0">
            <span v-tip="$t('volumes.bhExplore')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-light" :disabled="!s.ready" :aria-label="$t('volumes.bhExplore')" :title="$t('volumes.bhExplore')" data-testid="volume-storage-explore" @click="exploreStorage = s"><i class="fa-solid fa-folder-open"></i></BButton></span>
            <span v-tip="storageSyncReason(s) || $t('volumes.syncStorageTitle')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-light" :disabled="!!storageSyncReason(s)" :title="storageSyncReason(s) || $t('volumes.syncStorageTitle')" :aria-label="$t('volumes.sync')" data-testid="storage-sync-btn" @click="syncBucket(s)"><i class="fa-solid fa-arrows-rotate"></i></BButton></span>
            <span v-tip="$t('volumes.storageEraseNotBuilt')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-danger" disabled :aria-label="$t('volumes.erase')" :title="$t('volumes.storageEraseNotBuilt')" data-testid="storage-erase-btn"><i class="fa-solid fa-eraser"></i></BButton></span>
            <span v-tip="storageDeleteReason(s) || $t('volumes.storageDeleteTitle')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-danger" :disabled="busyStorage === s.id || !!storageDeleteReason(s)" :aria-label="$t('volumes.delete')" :title="storageDeleteReason(s) || $t('volumes.storageDeleteTitle')" data-testid="storage-delete-btn" @click="confirmUnlink(s)"><i class="fa-solid fa-trash"></i></BButton></span>
          </div>
        </div>
      </div>
      </template>
      <div v-if="r.kind === 'local'" class="list-group-item" :class="{ 'vol-over': overId === 'local' && dragId !== 'local', 'opacity-50': dragId === 'local' }" data-testid="volume-local" @dragover="dragOver($event, 'local')" @drop.prevent="dropRow('local')">   <!-- the built-in volume: this PC's ComfyUI-Shared folder, always one, never created or deleted here -->
        <div class="d-flex align-items-start gap-3">
          <span class="text-body-secondary mt-1" style="cursor: grab" draggable="true" role="button" :title="$t('volumes.dragHandle')" :aria-label="$t('volumes.dragHandle')" data-testid="local-drag-handle" @dragstart="dragStart($event, 'local')" @dragend="dragEnd"><i class="fa-solid fa-grip-vertical"></i></span>
          <i class="fa-solid fa-computer fs-5 text-body-secondary mt-1"></i>
          <div class="flex-grow-1 lh-sm overflow-hidden">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold" data-testid="volume-local-name">{{ $t('volumes.localTitle') }}</span>
              <code class="small" data-testid="volume-local-id">{{ $t('volumes.localId') }}</code>
              <BBadge variant="info" text-indicator data-testid="volume-local-badge">{{ $t('volumes.localBadge') }}</BBadge>
              <BBadge variant="secondary" class="fw-normal" data-testid="volume-local-builtin">{{ $t('storage.builtin') }}</BBadge>
            </div>
            <small class="text-body-secondary d-block text-break" data-testid="volume-local-facts">{{ local.path ? $t('volumes.localFacts', { path: local.path }) + (local.free != null ? ' · ' + $t('volumes.localFree', { size: sizeOf(local.free) }) : '') : $t('volumes.localNotMapped') }}</small>
          </div>
          <span v-tip="$t('volumes.bhExplore')" class="tipwrap flex-shrink-0"><BButton size="sm" class="vol-icon" variant="outline-light" :disabled="!local.path" :aria-label="$t('volumes.bhExplore')" :title="$t('volumes.bhExplore')" data-testid="volume-local-explore" @click="exploreLocal = true"><i class="fa-solid fa-folder-open"></i></BButton></span>
        </div>
        <LocalSyncRules :volumes="store.volumes" :auto="volAuto" :forms="volForms" :rules="rules" :storages="storages" :storage-reason="storageSyncReason" @pull="syncBucket" @changed="refreshRules" />
      </div>
      <div v-if="r.kind === 'bh'" class="list-group-item" :class="{ 'vol-over': overId === 'bh' && dragId !== 'bh', 'opacity-50': dragId === 'bh' }" data-testid="volume-bh" @dragover="dragOver($event, 'bh')" @drop.prevent="dropRow('bh')">   <!-- the BH exchange bucket: not a RunPod volume, read-only -->
        <div class="d-flex align-items-start gap-3">
          <span class="text-body-secondary mt-1" style="cursor: grab" draggable="true" role="button" :title="$t('volumes.dragHandle')" :aria-label="$t('volumes.dragHandle')" data-testid="bh-drag-handle" @dragstart="dragStart($event, 'bh')" @dragend="dragEnd"><i class="fa-solid fa-grip-vertical"></i></span>
          <i class="fa-solid fa-bucket fs-5 text-body-secondary mt-1"></i>
          <div class="flex-grow-1 lh-sm overflow-hidden">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold" data-testid="volume-bh-name">{{ $t('volumes.bhTitle') }}</span>
              <BBadge :variant="bh.configured ? 'success' : 'warning'" data-testid="volume-bh-keys">{{ bh.configured ? $t('volumes.bhKeysSet', { via: bh.via }) : $t('volumes.bhKeysMissing', { profile: bh.profile }) }}</BBadge>
            </div>
            <small class="text-body-secondary d-block" data-testid="volume-bh-facts">{{ $t('volumes.bhFacts', { bucket: bh.bucket, region: bh.region, dest: 'returns/BKK/' }) }}</small>
          </div>
          <div class="vol-side d-flex flex-wrap gap-1 justify-content-end align-items-start flex-shrink-0">
            <span v-tip="$t('volumes.bhExplore')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-light" :disabled="!bh.configured" :aria-label="$t('volumes.bhExplore')" :title="$t('volumes.bhExplore')" data-testid="volume-bh-explore" @click="exploring = true"><i class="fa-solid fa-folder-open"></i></BButton></span>
            <span v-tip="bhSyncReason || $t('volumes.syncBhTitle')" class="tipwrap"><BButton size="sm" class="vol-icon" variant="outline-light" :disabled="!!bhSyncReason" :title="bhSyncReason || $t('volumes.syncBhTitle')" :aria-label="$t('volumes.sync')" data-testid="bh-sync-btn" @click="syncBucket({ id: 'panama-s3', name: $t('syncTargets.bhBucket') })"><i class="fa-solid fa-arrows-rotate"></i></BButton></span>
          </div>
        </div>
        <BhPublishing />
      </div>
      </template>
    </div>

    <template #footer>
      <div class="d-flex align-items-center gap-2 w-100">
        <span v-if="windowSave.failed.value" class="small text-danger" data-testid="volumes-save-error">{{ $t('volumes.saveFailed') }}</span>
        <span v-else-if="windowSave.dirty.value" class="small text-warning" data-testid="volumes-unsaved">{{ $t('volumes.unsaved') }}</span>
        <span v-else-if="windowSave.saved.value" class="small text-success" data-testid="volumes-saved"><i class="fa-solid fa-check me-1"></i>{{ $t('volumes.saved') }}</span>
        <BButton class="ms-auto" variant="success" :disabled="windowSave.saving.value || !windowSave.dirty.value" data-testid="volumes-save" @click="windowSave.saveAll()">{{ $t('volumes.save') }}</BButton>
        <BButton variant="outline-light" @click="setOpen(false)">{{ $t('volumes.done') }}</BButton>
      </div>
    </template>
  </BModal>
  <BucketExplorerModal :open="exploreLocal" bucket="ComfyUI-Shared" local @close="exploreLocal = false" />
  <BucketExplorerModal :open="exploring" :bucket="bh?.bucket || ''" @close="exploring = false" />
  <BucketExplorerModal :open="!!exploreStorage" :bucket="exploreStorage?.bucket || ''" :storage-id="exploreStorage?.id || ''" @close="exploreStorage = null" />
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
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import VolumeFilesModal from './VolumeFilesModal.vue'
import BucketExplorerModal from './BucketExplorerModal.vue'
import { mountsAPI } from '../api/mounts'
import StorageAddForm from './StorageAddForm.vue'
import BhPublishing from './BhPublishing.vue'
import VolumeSyncRules from './VolumeSyncRules.vue'
import LocalSyncRules from './LocalSyncRules.vue'
import { autosyncAPI } from '../api/autosync'
import { provideWindowSave } from '../utils/windowsave'
import { blankForm, fillForm, saveForm } from '../utils/volumeautosync'
import { syncrulesAPI } from '../api/syncrules'
import { panamaAPI } from '../api/panama'
import { storageAPI } from '../api/storage'
import { volumesAPI } from '../api/volumes'
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
const windowSave = provideWindowSave()   // the one Save in the footer
async function setOpen(v) {
  if (!v && windowSave.dirty.value && !(await confirm.ask(t('publish.discardConfirm'), { okLabel: t('config.close') }))) return
  ui.volumesOpen = v
}
const draft = reactive({ name: '', size_gb: 100, datacenter: '' })
const resizing = ref(null)
const browsing = ref(null), erasing = ref(null), cloning = ref(null)   // the volume whose files are open, or whose Erase is
const resizeTo = ref(0)
const local = reactive({ path: '', free: null }), exploreLocal = ref(false)   // the built-in This PC volume: the mapped ComfyUI-Shared folder and its disk's free space
const bh = ref(null), exploring = ref(false)   // the BH exchange bucket's status (keys set or not), and whether its explorer is open
const volAuto = reactive({})   // volume id -> its Auto Sync settings (volume level, docs/ADR-068); the This PC row reads them
// Each volume's Auto Sync form, one copy: its own row and the This PC row edit the same one.
const volForms = reactive({}), volBase = reactive({}), filled = new Map()
const snap = (f) => JSON.stringify([f.pull, f.push, f.approved_by])
function refill(id) { fillForm(volForms[id], volAuto[id]); volBase[id] = snap(volForms[id]) }
watch(() => store.volumes.map((v) => [v.id, volAuto[v.id]]), (list) => {
  for (const [id, settings] of list) {
    volForms[id] ||= blankForm()
    if (!filled.has(id) || filled.get(id) !== settings) { filled.set(id, settings); refill(id) }
  }
}, { immediate: true })
const changedVolumes = () => store.volumes.map((v) => v.id).filter((id) => volForms[id] && snap(volForms[id]) !== volBase[id])
windowSave.register(() => changedVolumes().length > 0, async () => {
  let ok = true
  for (const id of changedVolumes()) { const r = await saveForm(id, volForms[id]); if (r) { volAuto[id] = r } else ok = false }
  return ok
})
const sendStorages = computed(() => storages.value.filter((s) => s.ready && s.enabled !== false).map((s, i) => ({ s, i })).sort((a, b) => (b.s.default ? 1 : 0) - (a.s.default ? 1 : 0) || a.i - b.i).map((x) => x.s))   // the default storage first
watch(() => store.volumes.map((v) => v.id).join(','), () => { for (const v of store.volumes) if (!(v.id in volAuto)) { volAuto[v.id] = null; autosyncAPI.getVolume(v.id).then((r) => { volAuto[v.id] = r }).catch(() => { delete volAuto[v.id] }) } }, { immediate: true })
const bhOff = ref(false)   // the Panama bucket's adapter is switched off (Sync cannot read it)
const bhSyncReason = computed(() => (!bh.value?.configured ? t('volumes.syncBhNoKeys') : bhOff.value ? t('volumes.syncBhOff') : ''))
const storageSyncReason = (s) => (!s.ready ? t('volumes.syncNotReady', { problem: s.problem || '' }) : s.enabled === false ? t('volumes.syncStorageOff') : '')
/** Sync a bucket (docs/ADR-067): the window opens with it as From and This PC ticked; no volume. */
function syncBucket(s) { ui.syncFor = { volumeId: '', volumeName: s.name, source: { type: 'storage', id: s.id } } }
const storages = ref([]), exploreStorage = ref(null)   // the S3 storages (Wasabi, your own) listed beside the volumes; the one whose bucket is open
const createType = ref('volume')   // what the create form makes (a volume, or a Wasabi / S3 storage linked)
const usage = reactive({})   // per storage id: the last storage.usage answer (read-only listing of the bucket), polled every 2 s while it is still listing
const usageTimers = {}
let usageOpen = false
const sizeOf = (b) => { const gb = b / 1e9; return gb >= 1000 ? `${(gb / 1000).toFixed(2)} TB` : `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB` }
function sizeLine(s) {
  const u = usage[s.id], region = s.region || '?'
  if (!u) return t('volumes.storageSizeLoading', { region })
  if (u.state === 'listing') return t('volumes.storageSizeListing', { n: u.objects_so_far ?? 0, region })
  if (u.state === 'failed') return t('volumes.storageSizeUnknown', { error: u.error || '', region })
  const cost = u.price_per_tb_month == null ? '' : t('volumes.storageSizeCost', { cost: ((u.bytes / 1e12) * u.price_per_tb_month).toFixed(2) })
  return t('volumes.storageSize', { size: sizeOf(u.bytes), region }) + cost
}
const usageTitle = (s) => { const u = usage[s.id]; return u?.as_of ? t('volumes.storageAsOf', { time: new Date(u.as_of).toLocaleString() }) : '' }
function stopUsage() { usageOpen = false; for (const k of Object.keys(usageTimers)) { clearTimeout(usageTimers[k]); delete usageTimers[k] } }
function watchUsage(s) {
  if (!s.bucket || !s.ready || usageTimers[s.id] !== undefined) return
  usageTimers[s.id] = null
  const go = async () => {
    if (!usageOpen) return
    try { usage[s.id] = await storageAPI.usage(s.id) } catch (e) { usage[s.id] = { state: 'failed', error: e?.response?.data?.detail || e?.message || '' } }
    if (usageOpen && usage[s.id].state === 'listing') usageTimers[s.id] = setTimeout(go, 2000); else delete usageTimers[s.id]
  }
  usageTimers[s.id] = setTimeout(go, 0)
}
/** the events a storage receives from at least one volume, read from the per-event rules (docs/ADR-069), not from the storage's old `events` field */
const usedEvents = (id) => ['generated', 'approved', 'published'].filter((e) => Object.values(rules.value || {}).some((r) => (r?.[e] || []).some((d) => d.type === 'storage' && d.id === id)))
// Drag to order (docs: the storage cards' handle in the Storage tab works the same): volumes are kept in the configuration (so export and import carry them); storages go through storage.reorder, the Storage tab's own order.
// ONE order for every row (volumes, storages, 'local' = This PC, 'bh' = the BH bucket): the configuration's volume order (volumes.getOrder / setOrder). Default: volumes, storages, This PC, BH.
const rowOrder = ref([])
const rows = computed(() => {
  const all = [...store.volumes.map((v) => ({ key: `volume:${v.id}`, id: v.id, kind: 'volume', item: v })), ...storages.value.map((x) => ({ key: `storage:${x.id}`, id: x.id, kind: 'storage', item: x })), { key: 'local', id: 'local', kind: 'local' }, ...(bh.value ? [{ key: 'bh', id: 'bh', kind: 'bh' }] : [])]
  const pos = new Map(rowOrder.value.map((id, i) => [id, i]))
  return all.map((r, i) => ({ r, i })).sort((a, b) => (pos.has(a.r.id) ? pos.get(a.r.id) : 1e9) - (pos.has(b.r.id) ? pos.get(b.r.id) : 1e9) || a.i - b.i).map((x) => x.r)   // unlisted rows go after the listed ones in the default order; an id that is gone is ignored
})
const dragId = ref(''), overId = ref('')
let fromId = ''
function dragStart(e, id) {
  fromId = id
  setTimeout(() => { dragId.value = id }, 0)   // deferred: changing the page in dragstart makes Chromium cancel the drag
  try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); const row = e.target.closest('.list-group-item'); if (row && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 12, 12) } catch { /* a browser without it */ }
}
const dragEnd = () => { fromId = ''; dragId.value = overId.value = '' }
function dragOver(e, id) { if (fromId) { e.preventDefault(); overId.value = id } }
const moved = (ids, from, to) => { const a = ids.filter((x) => x !== from), i = a.indexOf(to), at = ids.indexOf(from) < ids.indexOf(to) ? i + 1 : i; a.splice(at, 0, from); return a }
function dropRow(id) {
  const from = fromId; dragEnd()
  if (!from || from === id) return
  rowOrder.value = moved(rows.value.map((r) => r.id), from, id)
  volumesAPI.setOrder(rowOrder.value).catch((e) => { store.error = e?.response?.data?.detail || e?.message || String(e) })
}
const rules = ref({})   // syncrules.all(): volume id | '*' -> { generated, approved, published }; every row reads this one state
async function refreshRules() {
  try { rules.value = (await syncrulesAPI.all()).rules || {} } catch { /* the rows keep what they had */ }
  try { setStorages((await storageAPI.list()).adapters) } catch { /* same */ }
}
function setStorages(list) {
  storages.value = list.filter((a) => a.id !== 'panama-s3' && a.id !== 'publish-s3'); storages.value.forEach(watchUsage) }
onBeforeUnmount(stopUsage)
async function storageAdded({ adapters, fresh }) {
  store.error = null; createType.value = 'volume'; setStorages(adapters)
  if (fresh) nextTick(() => document.querySelector(`[data-testid="volume-storage"][data-id="${fresh}"]`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }))
}
const dcList = ref([])
const dcOptions = computed(() => volumeDatacenterOptions(dcList.value, { value: '', text: t('volumes.pickDatacenter') }))

/** The mapped ComfyUI-Shared folder (Default Configuration > Folders) and the free space of the disk it is on (the mounted volumes the folder picker lists). */
async function loadLocal() {
  try {
    const cfg = (await mountsAPI.get())?.config || {}
    local.path = String(cfg.folders?.['comfy-shared'] || '').trim(); local.free = null
    if (local.path) { const vols = await mountsAPI.volumes().catch(() => []); const hit = vols.filter((v) => v.path && (local.path === v.path || local.path.startsWith(v.path.replace(/\/+$/, '') + '/'))).sort((a, b) => b.path.length - a.path.length)[0]; local.free = hit && hit.free_bytes != null ? hit.free_bytes : null }
  } catch { local.path = ''; local.free = null }
}
async function open() {
  windowSave.reset(); for (const id of Object.keys(volForms)) { refill(id); volForms[id].error = ''; volForms[id].saved = false }   // what was discarded on close is gone
  store.load(); loadLocal(); refreshRules()
  volumesAPI.getOrder().then((o) => { rowOrder.value = o }).catch(() => { /* the usual order */ })
  panamaAPI.status().then((s) => { bh.value = s }).catch(() => { bh.value = null })   // no entry when the status cannot be read
  // the Panama bucket (both of its roles) is the BH entry above; the others are listed here
  usageOpen = true
  storageAPI.list().then((r) => { bhOff.value = r.adapters.some((a) => a.id === 'panama-s3' && a.enabled === false); setStorages(r.adapters) }).catch(() => { storages.value = [] })
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
/** Why a volume cannot be deleted from here: it is the Shared one, or a pod is attached. */
const deleteReason = (v) => (v.is_shared ? t('volumes.deleteShared') : v.pods.some((p) => p.via === 'runpod') ? t('volumes.deleteBlocked') : '')
const busyStorage = ref('')
const storageDeleteReason = (s) => (s.default ? t('volumes.storageDeleteDefault') : '')
/** Delete a storage row: unlink it from the app only (the bucket is never touched); the default cannot be deleted (the core refuses it too). */
async function confirmUnlink(s) {
  if (!(await confirm.ask(t('volumes.storageConfirmDelete', { name: s.name }), { okLabel: t('volumes.delete') }))) return
  busyStorage.value = s.id; store.error = null
  try { setStorages((await storageAPI.remove(s.id)).adapters); refreshRules() } catch (e) { store.error = e?.response?.data?.detail || e?.message || String(e) } finally { busyStorage.value = '' }
}
async function confirmRemove(v) {
  if (await confirm.ask(t('volumes.confirmDelete', { name: v.name, size: v.size_gb }), { okLabel: t('volumes.delete') })) store.remove(v)
}
</script>

<style scoped>
.tipwrap { display: inline-block; }
.tipwrap > :disabled { pointer-events: none; }   /* a disabled button swallows hover: the wrapper gets it instead, so its tooltip (the reason) shows */   /* the tooltip sits on this wrapper: a disabled button gets no mouse events of its own */
.vol-over { box-shadow: inset 0 2px 0 var(--bs-primary); }
.vol-icon { width: 2rem; padding-left: 0; padding-right: 0; }   /* the same square for every action */
.vol-side { max-width: 16rem; }
</style>
