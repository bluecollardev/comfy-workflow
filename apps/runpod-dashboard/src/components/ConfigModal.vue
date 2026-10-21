<template>
  <BModal
    :model-value="forPod ? modelValue : ui.configOpen"
    :no-close-on-backdrop="gated" :no-close-on-esc="gated" :hide-header-close="gated"
    :title="forPod ? $t('config.podTitle', { name: podName }) : $t('config.title')"
    size="xl"
    scrollable
    @update:model-value="forPod ? emit('update:modelValue', $event) : (ui.configOpen = $event)"
    @show="load"
  >
    <p class="text-body-secondary small mb-3" :data-testid="forPod ? 'config-modal-pod' : 'config-modal'">{{ forPod ? $t('config.podIntro') : $t('config.intro') }}</p>

    <div v-if="loading" class="text-center text-body-secondary py-3"><BSpinner small /></div>

    <template v-else-if="cfg">
      <BAlert v-if="gated" :model-value="true" variant="warning" class="mb-3" data-testid="cfg-key-gate">
        <i class="fa-solid fa-key me-2"></i>{{ $t('config.keyGate') }}
      </BAlert>
      <fieldset v-if="!forPod" class="cfg-section">
      <legend data-testid="section-runpod">{{ $t('config.runpod') }} <span class="text-body-secondary fw-normal small">{{ $t('config.runpodHint') }}</span></legend>
      <BRow class="g-3">
        <BCol md="8">
          <BFormGroup :label="$t('config.apiKey')" label-for="cfg-key" data-testid="cfg-key-group" :description="keyInfo.runpod_api_key_set ? $t('config.apiKeyStored', { hint: keyInfo.runpod_api_key_hint, source: keyInfo.source }) : $t('config.apiKeyUnset')">
            <BFormInput id="cfg-key" v-model.trim="newKey" type="password" autocomplete="off" placeholder="rpa_…" class="font-monospace" data-testid="cfg-key" />
          </BFormGroup>
        </BCol>
      </BRow>
      </fieldset>

      <template v-if="!gated">
      <fieldset class="cfg-section">
      <legend data-testid="section-volume">{{ $t('config.volume') }} <span class="text-body-secondary fw-normal small">{{ $t('config.volumeHint') }}</span></legend>
      <BRow class="g-3">
        <BCol cols="12">
          <BFormGroup :label="$t('config.datacenter')" label-for="cfg-dc" :description="$t('config.datacenterHelp')">
            <BFormSelect id="cfg-dc" v-model="cfg.data_center_id" :options="dcOptions" class="font-monospace" data-testid="cfg-dc" />
            <div v-if="cfg.data_center_id" class="mt-2" data-testid="cfg-dc-cards">
              <table v-if="dcCards.length" class="table table-sm table-borderless small mb-1 w-auto">
                <thead class="text-body-secondary"><tr><th>{{ $t('config.cardsCard') }}</th><th class="text-end">{{ $t('config.cardsVram') }}</th><th class="text-end">{{ $t('config.cardsPrice') }}</th><th>{{ $t('config.cardsStock') }}</th></tr></thead>
                <tbody><tr v-for="c in dcCards" :key="c.key" data-testid="cfg-dc-card"><td>{{ c.name }}</td><td class="text-end">{{ c.vram }} GB</td><td class="text-end">${{ c.price }}/h</td><td>{{ c.stock }}</td></tr></tbody>
              </table>
              <div v-else class="form-text mt-0">{{ $t('config.cardsNone', { dc: cfg.data_center_id }) }}</div>
              <div v-if="dcEntry?.s3" class="form-text mt-0">{{ $t('config.cardsS3') }}</div>
            </div>
          </BFormGroup>
        </BCol>
        <BCol md="8">
          <BFormGroup :label="$t('config.volumeId')" label-for="cfg-volume" :description="$t('config.volumeIdHelp')">
            <BFormSelect id="cfg-volume" v-model="cfg.network_volume_id" :options="volumeOptions" class="font-monospace" data-testid="cfg-volume" @change="onVolumePick" />
            <div v-if="!volumesHere.length" class="mt-2" data-testid="cfg-volume-none">
              <span class="text-body-secondary small me-2">{{ cfg.data_center_id ? $t('config.volumesNoneIn', { dc: cfg.data_center_id }) : $t('config.volumesNone') }}</span>
              <BButton size="sm" variant="outline-light" data-testid="cfg-volume-add" @click="ui.volumesOpen = true"><i class="fa-solid fa-plus me-1"></i>{{ $t('config.volumeAdd') }}</BButton>
            </div>
            <div v-if="cfg.network_volume_id" class="form-text" data-testid="cfg-volume-info">
              <span v-if="volume === undefined">{{ $t('config.volumeLooking') }}</span>
              <span v-else-if="volume === null" class="text-warning">{{ $t('config.volumeMissing') }}</span>
              <span v-else>{{ $t('config.volumeInfo', { name: volume.name, size: volume.size_gb, dc: volume.datacenter, cost: volume.cost_per_month }) }}<span v-if="volume.s3"> · {{ $t('config.volumeS3') }}</span></span>
            </div>
          </BFormGroup>
        </BCol>
        <BCol md="4">
          <BFormGroup :label="$t('config.mountPath')" label-for="cfg-mount" :description="$t('config.mountPathHelp')">
            <BFormInput id="cfg-mount" v-model.trim="cfg.mount_path" class="font-monospace" data-testid="cfg-mount" />
          </BFormGroup>
        </BCol>
        <BCol md="8">
          <BFormGroup :label="$t('config.image')" label-for="cfg-image" :description="$t('config.imageHelp')">
            <BFormInput id="cfg-image" v-model.trim="cfg.image" placeholder="registry/name:tag" class="font-monospace" data-testid="cfg-image" />
          </BFormGroup>
          <BFormGroup :label="$t('config.registryAuth')" label-for="cfg-registry-auth" :description="$t('config.registryAuthHelp')">
            <BFormInput id="cfg-registry-auth" v-model.trim="cfg.registry_auth_id" class="font-monospace" data-testid="cfg-registry-auth" />
          </BFormGroup>
        </BCol>
        <BCol md="4">
          <BFormGroup :label="$t('config.idle')" label-for="cfg-idle" :description="$t('config.idleHelp')">
            <BFormInput id="cfg-idle" v-model.number="cfg.idle_stop_minutes" type="number" min="0" data-testid="cfg-idle" />
          </BFormGroup>
        </BCol>
      </BRow>
      </fieldset>

      <fieldset class="cfg-section">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <legend class="mb-0" data-testid="section-folders">{{ $t('config.folders') }} <span class="text-body-secondary fw-normal small">{{ $t('config.foldersHint', { mode, rule: $t(requireSource === 'prod' ? 'config.ruleProd' : requireSource === 'env' ? 'config.ruleEnv' : 'config.ruleConfig') }) }}</span><code class="d-none" data-testid="config-mode">{{ mode }}</code></legend>
        <BButton size="sm" variant="outline-light" class="flex-shrink-0 text-nowrap ms-3" data-testid="add-folder" @click="cfg.custom.push({ name: '', local: '', container: '', link: '', mode: 'rw' })"><i class="fa-solid fa-plus me-1"></i>{{ $t('config.addFolder') }}</BButton>
      </div>
      <table class="table table-sm align-middle mb-0">
        <thead class="small text-body-secondary">
          <tr><th style="width: 22%">{{ $t('config.colWhat') }}</th><th style="width: 48%">{{ $t('config.colLocal') }}</th><th>{{ $t('config.colPod') }}</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="f in required" :key="f.key" :data-testid="'folder-row-' + f.key">
            <td>
              <div class="fw-semibold">{{ label(f) }}</div>
              <BFormCheckbox v-model="cfg.required[f.key]" switch size="sm" :disabled="requireSource !== 'config'" data-testid="folder-required" :title="$t(requireSource === 'prod' ? 'config.requiredProd' : requireSource === 'env' ? 'config.requiredEnv' : 'config.requiredConfig')">
                <small data-testid="folder-required-text">{{ $t((requireSource === 'config' ? cfg.required[f.key] : f.required) ? 'config.required' : 'config.optional') }}</small>
              </BFormCheckbox>
              <small class="text-body-secondary">{{ f.what }}</small>
            </td>
            <td>
              <div class="d-flex gap-2">
                <BFormInput v-model.trim="cfg.folders[f.key]" size="sm" class="font-monospace" :placeholder="$t('config.notMapped')" :state="folderState(f, cfg.folders[f.key])" data-testid="folder-local" />
                <BButton size="sm" variant="outline-light" class="text-nowrap" data-testid="folder-browse" @click="browse(f.key, label(f), cfg.folders[f.key])"><i class="fa-regular fa-folder-open me-1"></i>{{ $t('config.browse') }}</BButton>
              </div>
              <small v-if="cfg.folders[f.key] && f.local === cfg.folders[f.key] && !f.exists" class="text-danger">{{ $t('config.missing') }}</small>
              <small v-else-if="f.mirror && f.key !== 'plates' && f.local === cfg.folders[f.key]" class="text-warning">{{ $t('config.mirror', { hint: $t(f.key === 'comfy-shared' ? 'config.mirrorShared' : 'config.mirrorTree') }) }}</small>
              <small v-else-if="f.declared" class="text-body-secondary" data-testid="folder-note">{{ $t('config.linkedFrom', { source: f.declared.source }) }}</small>
              <small v-else-if="f.key === 'project' && cfg.folders.project && f.local === cfg.folders.project && f.exists" class="text-warning">{{ $t('config.noRoot') }}</small>
              <small v-else-if="f.key !== 'project' && cfg.folders.project" class="text-body-secondary">{{ $t('config.noDeclared') }}</small>
            </td>
            <td class="font-monospace small" data-testid="folder-container">{{ f.container }}<br /><span class="text-body-secondary" data-testid="folder-env">{{ f.env_key }}</span></td>
            <td></td>
          </tr>
          <tr v-for="(c, i) in cfg.custom" :key="'custom-' + i" :data-testid="'custom-row-' + i">
            <td>
              <BFormInput v-model.trim="c.name" size="sm" :placeholder="$t('config.customName')" data-testid="custom-name" :state="c.name ? (/^[^/\s]+$/.test(c.name) && !required.some((f) => f.key === c.name) ? null : false) : false" />
              <small class="text-body-secondary">{{ $t('config.customOwn') }}</small>
            </td>
            <td>
              <div class="d-flex gap-2">
                <BFormInput v-model.trim="c.local" size="sm" class="font-monospace" :placeholder="$t('config.notMapped')" :state="folderState(customRow(c), c.local)" data-testid="custom-local" />
                <BButton size="sm" variant="outline-light" class="text-nowrap" @click="browse('custom:' + i, c.name || 'folder', c.local, 'custom.' + (c.name || i))"><i class="fa-regular fa-folder-open me-1"></i>Browse</BButton>
              </div>
              <div class="d-flex gap-2 align-items-center mt-1">
                <small class="text-body-secondary text-nowrap">{{ $t('config.customLink') }}</small>
                <BFormInput v-model.trim="c.link" size="sm" class="font-monospace" :placeholder="$t('config.customLinkHelp')" data-testid="custom-link" />
              </div>
            </td>
            <td>
              <BFormInput v-model.trim="c.container" size="sm" class="font-monospace" :placeholder="(cfg.mount_path || '/workspace') + '/' + (c.name || 'name')" data-testid="custom-container" />
              <BFormSelect v-model="c.mode" size="sm" :options="['rw', 'ro']" class="mt-1" style="width: 5rem" />
            </td>
            <td class="text-end"><BButton variant="outline-light" size="sm" :aria-label="$t('config.removeFolder')" data-testid="custom-remove" @click="cfg.custom.splice(i, 1)"><i class="fa-solid fa-xmark"></i></BButton></td>
          </tr>
        </tbody>
      </table>
      </fieldset>

      <fieldset class="cfg-section">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <legend class="mb-0">Environment <span class="text-body-secondary fw-normal">extra variables for every pod that applies these mounts</span></legend>
        <BButton size="sm" variant="outline-light" @click="envRows.push({ key: '', value: '' })"><i class="fa-solid fa-plus me-1"></i>Add variable</BButton>
      </div>
      <table class="table table-sm align-middle mb-3" v-if="envRows.length">
        <tbody>
          <tr v-for="(row, i) in envRows" :key="i">
            <td style="width: 35%"><BFormInput v-model.trim="row.key" size="sm" class="font-monospace" placeholder="NAME" /></td>
            <td><BFormInput v-model="row.value" size="sm" class="font-monospace" placeholder="value" /></td>
            <td class="text-end"><BButton variant="outline-light" size="sm" aria-label="Remove variable" @click="envRows.splice(i, 1)"><i class="fa-solid fa-xmark"></i></BButton></td>
          </tr>
        </tbody>
      </table>
      </fieldset>

      <fieldset class="cfg-section">
        <legend>{{ $t('config.options') }}</legend>
      <BFormCheckbox v-if="!forPod" v-model="cfg.apply_by_default" switch class="mb-2" data-testid="cfg-apply-default">
        {{ $t('config.applyDefault') }} <span class="text-body-secondary">{{ $t('config.applyDefaultHint') }}</span>
      </BFormCheckbox>
      <BFormCheckbox v-if="!forPod" v-model="cfg.dry_run" switch class="mb-3" data-testid="cfg-dry-run">
        {{ $t('config.dryRun') }} <span class="text-body-secondary">{{ $t('config.dryRunHint') }}</span>
      </BFormCheckbox>

      <details class="mb-2">
        <summary class="small text-body-secondary">{{ $t('config.previewLocal') }}</summary>
        <pre class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="white-space: pre-wrap">{{ localText }}</pre>
      </details>
      <details class="mb-3">
        <summary class="small text-body-secondary" data-testid="preview-pod-toggle">{{ $t('config.previewPod') }}</summary>
        <pre class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="white-space: pre-wrap" data-testid="preview-pod">{{ previewText }}</pre>
      </details>
      </fieldset>

      <BAlert :model-value="!!error" variant="danger" class="mt-2 mb-0" data-testid="config-error">{{ error }}</BAlert>
      </template>
    </template>

    <template #footer>
      <template v-if="forPod">
        <small class="text-body-secondary me-auto">{{ initial ? $t('config.podOwn') : $t('config.podFromDefault') }}</small>
        <BButton variant="outline-danger" size="sm" :disabled="saving || !initial" data-testid="config-use-defaults" @click="useDefaults">{{ $t('config.useDefaults') }}</BButton>
        <BButton variant="outline-light" size="sm" data-testid="config-close" @click="emit('update:modelValue', false)">{{ $t('config.close') }}</BButton>
        <BButton variant="primary" size="sm" :disabled="saving" data-testid="config-apply" @click="apply"><BSpinner v-if="saving" small class="me-1" />{{ $t('config.apply') }}</BButton>
      </template>
      <template v-else>
        <small class="text-body-secondary me-auto">{{ stored ? $t('config.savedIn', { store }) : $t('config.nothingSaved') }}</small>
        <BButton v-if="!gated" variant="outline-danger" size="sm" :disabled="saving || !stored" data-testid="config-clear" @click="reset">{{ $t('config.clear') }}</BButton>
        <BButton v-if="!gated" variant="outline-light" size="sm" data-testid="config-close" @click="ui.configOpen = false">{{ $t('config.close') }}</BButton>
        <BButton variant="primary" size="sm" :disabled="saving || (gated && !newKey)" data-testid="config-save" @click="save"><BSpinner v-if="saving" small class="me-1" />{{ gated ? $t('config.saveKey') : $t('config.save') }}</BButton>
      </template>
    </template>

    <FolderPicker v-model="picker.open" :title="picker.title" :start="picker.start" :memory-key="picker.memory" @choose="picked" />
  </BModal>
</template>

<script setup>
import { podsAPI } from '../api/pods'
import { datacenterOptions } from '../utils/datacenters'
import { volumesAPI } from '../api/volumes'
/**
 * ConfigModal — two uses of one panel.
 *
 * Default (no props): the gear icon in the navbar, the Default Configuration. Maps the three folders
 * on this PC (project tree, plates, ComfyUI-Shared) that the API keeps (GET/PUT/DELETE /api/mounts),
 * plus the pod volume, image and extra env. Everything a runtime receives is derived by the API from
 * the mapping and from what the project tree declares about itself; nothing about a machine is typed.
 *
 * For one pod (`mode="pod"`, v-model open, `initial`, `podName`): the same fields, started from the
 * pod's own configuration or from the default, never saved as the default. Apply emits the validated
 * configuration (the API previews it); Use defaults emits null. The pod form sends it with the
 * request; the card stores it for Recreate. The RunPod key, "apply by default" and no-spend mode
 * are app-wide and stay out of it.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useUiStore } from '../stores/ui'
import { useMountsStore } from '../stores/mounts'
import { mountsAPI } from '../api/mounts'
import { settingsAPI } from '../api/settings'
import { useSettingsStore } from '../stores/settings'
import { t } from '../i18n'
import FolderPicker from './FolderPicker.vue'

const props = defineProps({
  mode: { type: String, default: 'default' },      // 'default' | 'pod'
  modelValue: { type: Boolean, default: false },    // pod mode: open
  initial: { type: Object, default: null },         // pod mode: the pod's own configuration, or null for the default
  podName: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'apply'])
const forPod = computed(() => props.mode === 'pod')

const ui = useUiStore()
const mounts = useMountsStore()
const loading = ref(false)
const saving = ref(false)
const error = ref(null)
const cfg = ref(null)
const folders = ref([])
const envRows = ref([])
const localEnv = ref({})
const preview = ref({})
const stored = ref(false)
const store = ref('')
const mode = ref('dev')
const require = ref([])
const requireSource = ref('config')
const picker = reactive({ open: false, key: '', title: '', start: '', memory: '' })
const keyInfo = ref({ runpod_api_key_set: false, runpod_api_key_hint: '', source: 'none' })
const settingsStore = useSettingsStore()
/** No key stored (and not no-spend mode): only the key field shows, and the panel cannot be dismissed. */
const gated = computed(() => !forPod.value && !keyInfo.value.runpod_api_key_set && !settingsStore.ready)
const newKey = ref('')

const label = (f) => (f.custom ? f.key : t(`config.folder.${f.key}`))
const required = computed(() => folders.value.filter((f) => !f.custom))
// The API's derived row for a custom folder (exists, declared), matched by name.
const customRow = (c) => folders.value.find((f) => f.custom && f.key === c.name) || { local: '', exists: false }

function take(payload) {
  cfg.value = JSON.parse(JSON.stringify(payload.config))   // a copy: unsaved edits must not leak into the store (the stats bar reads it)
  cfg.value.custom ||= []
  folders.value = payload.folders || []
  envRows.value = Object.entries(payload.config.env || {}).map(([key, value]) => ({ key, value }))
  localEnv.value = payload.local_env || {}
  preview.value = payload.preview || {}
  stored.value = payload.stored
  store.value = payload.store
  mode.value = payload.mode || 'dev'
  require.value = payload.require || []
  requireSource.value = payload.require_source || 'config'
  cfg.value.required ||= {}
}

/** The datacenter menu: RunPod's list with S3 support and our cards at the secure-cloud price; the saved id is kept even when the list lacks it. */
const dcList = ref([])
const dcEntry = computed(() => dcList.value.find((d) => d.value === cfg.value?.data_center_id) || null)
const dcCards = computed(() => dcEntry.value?.cards || [])   // read-only: what a volume pod can get there, at the secure-cloud price
const dcOptions = computed(() => datacenterOptions(dcList.value, { value: '', text: t('config.datacenterAny') }, cfg.value?.data_center_id))
/** The account's volumes as a menu: those in the chosen datacenter, or all of them while no datacenter is chosen
 *  (picking one then sets the datacenter, since a volume never leaves it). A saved id the list lacks stays selectable. */
const allVolumes = ref([])
const volumesHere = computed(() => allVolumes.value.filter((v) => !cfg.value?.data_center_id || v.datacenter === cfg.value.data_center_id))
const volumeOptions = computed(() => {
  const dc = cfg.value?.data_center_id
  const opts = [{ value: '', text: t('config.volumeNone') }, ...volumesHere.value.map((v) => ({ value: v.id, text: `${v.name} · ${v.size_gb} GB · ${v.id}${dc ? '' : ` · ${v.datacenter}`}` }))]
  const saved = cfg.value?.network_volume_id
  if (saved && !allVolumes.value.some((v) => v.id === saved)) opts.push({ value: saved, text: t('config.volumeUnknown', { id: saved }) })
  return opts
})
function onVolumePick() {
  const v = allVolumes.value.find((x) => x.id === cfg.value?.network_volume_id)
  if (v && cfg.value.data_center_id !== v.datacenter) cfg.value.data_center_id = v.datacenter
  loadVolume()
}
async function loadVolumes() { try { allVolumes.value = (await volumesAPI.list()) || [] } catch { /* the id can still be typed */ } }
watch(() => ui.volumesOpen, (open) => { if (!open) loadVolumes() })   // back from the Volumes modal: a new volume shows in the menu

/** The configured volume as RunPod has it, with its monthly cost; undefined while asking, null when RunPod has none. */
const volume = ref(undefined)
async function loadVolume() {
  const id = (cfg.value?.network_volume_id || '').trim()
  if (!id) { volume.value = undefined; return }
  volume.value = undefined
  try { volume.value = await podsAPI.volume(id) } catch (e) { volume.value = e.response?.status === 404 ? null : undefined }
}

async function loadDatacenters() {
  try { dcList.value = (await podsAPI.datacenters()).datacenters || [] } catch { /* the saved id stays selectable */ }
}

async function load() {
  loadDatacenters()
  loadVolumes()
  loading.value = true; error.value = null
  if (forPod.value) {
    // the pod's own configuration through the API's preview (its derived rows), else the default as saved
    try { take(props.initial ? await mountsAPI.preview(props.initial) : (await mounts.load()) || {}) }
    catch (e) { error.value = e.response?.data?.detail || e.message }
    if (!cfg.value) error.value ||= mounts.error
    loading.value = false
    return
  }
  const payload = await mounts.load()
  if (payload) take(payload); else error.value = mounts.error
  try { keyInfo.value = await settingsAPI.get() } catch { /* a backend without settings: the key comes from the environment */ }
  newKey.value = ''
  loadVolume()   // after the config is in, so the line names the configured volume
  loading.value = false
}

/** Pod mode: validate through the API's preview, hand the configuration to the owner, close. */
async function apply() {
  saving.value = true; error.value = null
  try {
    const payload = await mountsAPI.preview(body())
    emit('apply', payload.config)
    emit('update:modelValue', false)
  } catch (e) { error.value = e.response?.data?.detail || e.message }
  saving.value = false
}

function useDefaults() {
  emit('apply', null)
  emit('update:modelValue', false)
}

function folderState(f, v) {
  if (!v) return null
  if (!v.startsWith('/')) return false
  return f.local === v ? f.exists : null   // the API checked this exact path; anything else is unknown until saved
}

function browse(key, name, start, memory = key) {
  picker.key = key; picker.title = t('picker.title', { name: name.toLowerCase() }); picker.start = start || ''
  picker.memory = memory   // what the picker remembers the last folder under: the row's key, or a custom row's name
  picker.open = true
}

function picked(path) {
  if (picker.key.startsWith('custom:')) cfg.value.custom[Number(picker.key.slice(7))].local = path
  else cfg.value.folders[picker.key] = path
}

function body() {
  const env = {}
  for (const r of envRows.value) if (r.key) env[r.key] = r.value
  return { ...cfg.value, env }
}

const localText = computed(() => {
  const e = Object.entries(localEnv.value)
  return e.length ? e.map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join('\n') : t('config.nothingMapped')
})

const previewText = computed(() => {
  const p = preview.value
  const lines = []
  if (p.network_volume_id) lines.push(t('config.volumeLine', { id: p.network_volume_id, path: p.volume_mount_path }) + (p.data_center_id ? t('config.inDatacenter', { dc: p.data_center_id }) : ''))
  else lines.push(t('config.noVolume'))
  for (const [k, v] of Object.entries(p.env || {})) lines.push(`${k}=${v}`)
  return lines.join('\n')
})

async function save() {
  saving.value = true; error.value = null
  const wasGated = gated.value
  if (newKey.value) {
    try { keyInfo.value = await settingsAPI.set({ runpod_api_key: newKey.value }); newKey.value = ''; await settingsStore.load() }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
  if (wasGated) { saving.value = false; return }   // the key is in: the rest of the panel appears, nothing else to save yet
  const r = await mounts.save(body())
  saving.value = false
  if (!r.ok) { error.value = mounts.error; return }
  take(r.value)
  ui.configOpen = false
}

async function reset() {
  saving.value = true; error.value = null
  const r = await mounts.reset()
  saving.value = false
  if (r.ok) take(r.value); else error.value = mounts.error
}
</script>

<style scoped>
/* Each section of the panel in a bordered group with its heading on the border. */
.cfg-section {
  border: 1px solid var(--bs-border-color);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem 1rem;
  margin-bottom: 1rem;
  min-width: 0;
}
.cfg-section > legend,
.cfg-section > div > legend {
  float: none;
  width: auto;
  padding: 0 0.5rem;
  margin-bottom: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
}
.cfg-section > div > legend {
  margin-bottom: 0;
}
</style>
