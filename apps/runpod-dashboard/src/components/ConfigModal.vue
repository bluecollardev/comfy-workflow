<template>
  <BModal
    :model-value="ui.configOpen"
    title="Configuration"
    size="xl"
    scrollable
    @update:model-value="ui.configOpen = $event"
    @show="load"
  >
    <p class="text-body-secondary small mb-3">
      This app runs on one PC. Map the three folders every run needs, wherever they are on this
      PC. A runtime here uses them where they are; a pod carries them on its volume and links the
      paths the project's own files name onto them, so graphs and scripts run unchanged. The
      full story: <code>docs/MOUNT-POINTS.md</code>.
    </p>

    <div v-if="loading" class="text-center text-body-secondary py-3"><BSpinner small /></div>

    <template v-else-if="cfg">
      <h6 class="mb-2">RunPod <span class="text-body-secondary fw-normal small">the account the app creates pods in</span></h6>
      <BRow class="g-3 mb-3">
        <BCol md="8">
          <BFormGroup label="API key" label-for="cfg-key" :description="keyInfo.runpod_api_key_set ? `Stored (${keyInfo.runpod_api_key_hint}); enter a new one to replace it. Kept in ${keyInfo.source}.` : 'Not set. From runpod.io, Settings, API Keys; stored on this PC only, never shown again.'">
            <BFormInput id="cfg-key" v-model.trim="newKey" type="password" autocomplete="off" placeholder="rpa_…" class="font-monospace" />
          </BFormGroup>
        </BCol>
      </BRow>

      <h6 class="mb-2">Pod volume <span class="text-body-secondary fw-normal small">the network volume that carries the three folders when a pod runs them</span></h6>
      <BRow class="g-3 mb-3">
        <BCol md="5">
          <BFormGroup label="Network volume ID" label-for="cfg-volume" description="Empty: the pod gets only its own disk and nothing above resolves.">
            <BFormInput id="cfg-volume" v-model.trim="cfg.network_volume_id" placeholder="e.g. 7h2k…" class="font-monospace" />
          </BFormGroup>
        </BCol>
        <BCol md="3">
          <BFormGroup label="Mount path" label-for="cfg-mount" description="Where the volume appears in the pod.">
            <BFormInput id="cfg-mount" v-model.trim="cfg.mount_path" class="font-monospace" />
          </BFormGroup>
        </BCol>
        <BCol md="4">
          <BFormGroup label="Datacenter" label-for="cfg-dc" description="Must match the volume's datacenter. Empty: RunPod chooses.">
            <BFormInput id="cfg-dc" v-model.trim="cfg.data_center_id" placeholder="e.g. EU-RO-1" class="font-monospace" />
          </BFormGroup>
        </BCol>
        <BCol md="8">
          <BFormGroup label="Image" label-for="cfg-image" description="What every new pod boots: ours, with the packs and the entrypoint that makes the links. It must be pushed to a registry first; a bare local name is refused at pod creation.">
            <BFormInput id="cfg-image" v-model.trim="cfg.image" placeholder="registry/name:tag" class="font-monospace" />
          </BFormGroup>
        </BCol>
        <BCol md="4">
          <BFormGroup label="Idle stop (minutes)" label-for="cfg-idle" description="Stop a pod after this long with nothing queued. 0 = never.">
            <BFormInput id="cfg-idle" v-model.number="cfg.idle_stop_minutes" type="number" min="0" />
          </BFormGroup>
        </BCol>
      </BRow>

      <div class="d-flex align-items-center justify-content-between mb-2">
        <h6 class="mb-0">Folders on this PC <span class="text-body-secondary fw-normal small">the three every run uses, then any of your own; the exact links a pod makes are in the pod preview below. Mode <code>{{ mode }}</code> (<code>COMFY_MODE</code>); {{ requireSource === 'prod' ? 'every folder is required in prod' : requireSource === 'env' ? 'required folders set by COMFY_REQUIRE' : 'the switches say which are required in dev' }}</span></h6>
        <BButton size="sm" variant="outline-light" @click="cfg.custom.push({ name: '', local: '', container: '', link: '', mode: 'rw' })"><i class="fa-solid fa-plus me-1"></i>Add folder</BButton>
      </div>
      <table class="table table-sm align-middle mb-3">
        <thead class="small text-body-secondary">
          <tr><th style="width: 22%">What</th><th style="width: 48%">Folder on this PC</th><th>On a pod</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="f in required" :key="f.key">
            <td>
              <div class="fw-semibold">{{ label(f) }}</div>
              <BFormCheckbox v-model="cfg.required[f.key]" switch size="sm" :disabled="requireSource !== 'config'" :title="requireSource === 'prod' ? 'prod mode: every folder is required' : requireSource === 'env' ? 'set by COMFY_REQUIRE' : 'dev mode: your choice'">
                <small>{{ (requireSource === 'config' ? cfg.required[f.key] : f.required) ? 'required' : 'optional' }}</small>
              </BFormCheckbox>
              <small class="text-body-secondary">{{ f.what }}</small>
            </td>
            <td>
              <div class="d-flex gap-2">
                <BFormInput v-model.trim="cfg.folders[f.key]" size="sm" class="font-monospace" placeholder="not mapped" :state="folderState(f, cfg.folders[f.key])" />
                <BButton size="sm" variant="outline-light" class="text-nowrap" @click="browse(f.key, label(f), cfg.folders[f.key])"><i class="fa-regular fa-folder-open me-1"></i>Browse</BButton>
              </div>
              <small v-if="cfg.folders[f.key] && f.local === cfg.folders[f.key] && !f.exists" class="text-danger">This folder does not exist on this PC.</small>
              <small v-else-if="f.mirror && f.key !== 'plates' && f.local === cfg.folders[f.key]" class="text-warning">This is Binc's mirror, read-only by rule, and a run writes here. Map a folder of your own{{ f.key === 'comfy-shared' ? ', e.g. ~/ComfyUI-Shared' : ' or a copy of the tree' }}.</small>
              <small v-else-if="f.declared" class="text-body-secondary">On a pod, linked from {{ f.declared.source }}.</small>
              <small v-else-if="f.key === 'project' && cfg.folders.project && f.local === cfg.folders.project && f.exists" class="text-warning">The tree's job files and structure page name no root; a pod cannot link what its graphs name.</small>
              <small v-else-if="f.key !== 'project' && cfg.folders.project" class="text-body-secondary">The tree names no path for it; nothing is linked on a pod.</small>
            </td>
            <td class="font-monospace small">{{ f.container }}<br /><span class="text-body-secondary">{{ f.env_key }}</span></td>
            <td></td>
          </tr>
          <tr v-for="(c, i) in cfg.custom" :key="'custom-' + i">
            <td>
              <BFormInput v-model.trim="c.name" size="sm" placeholder="name" :state="c.name ? (/^[^/\s]+$/.test(c.name) && !required.some((f) => f.key === c.name) ? null : false) : false" />
              <small class="text-body-secondary">your own folder</small>
            </td>
            <td>
              <div class="d-flex gap-2">
                <BFormInput v-model.trim="c.local" size="sm" class="font-monospace" placeholder="not mapped" :state="folderState(customRow(c), c.local)" />
                <BButton size="sm" variant="outline-light" class="text-nowrap" @click="browse('custom:' + i, c.name || 'folder', c.local, 'custom.' + (c.name || i))"><i class="fa-regular fa-folder-open me-1"></i>Browse</BButton>
              </div>
              <div class="d-flex gap-2 align-items-center mt-1">
                <small class="text-body-secondary text-nowrap">Path the code names</small>
                <BFormInput v-model.trim="c.link" size="sm" class="font-monospace" placeholder="optional: a pod links it onto the pod path" />
              </div>
            </td>
            <td>
              <BFormInput v-model.trim="c.container" size="sm" class="font-monospace" :placeholder="(cfg.mount_path || '/workspace') + '/' + (c.name || 'name')" />
              <BFormSelect v-model="c.mode" size="sm" :options="['rw', 'ro']" class="mt-1" style="width: 5rem" />
            </td>
            <td class="text-end"><BButton variant="outline-light" size="sm" aria-label="Remove folder" @click="cfg.custom.splice(i, 1)"><i class="fa-solid fa-xmark"></i></BButton></td>
          </tr>
        </tbody>
      </table>

      <div class="d-flex align-items-center justify-content-between mb-2">
        <h6 class="mb-0">Environment <span class="text-body-secondary fw-normal">extra variables for every pod that applies these mounts</span></h6>
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

      <BFormCheckbox v-model="cfg.apply_by_default" switch class="mb-2">
        Apply to new pods by default <span class="text-body-secondary">(the pod form can switch it off per pod)</span>
      </BFormCheckbox>
      <BFormCheckbox v-model="cfg.dry_run" switch class="mb-3">
        No-spend mode <span class="text-body-secondary">(pods are simulated: nothing reaches RunPod, nothing bills; for testing the app)</span>
      </BFormCheckbox>

      <details class="mb-2">
        <summary class="small text-body-secondary">What a runtime on this PC receives (as saved)</summary>
        <pre class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="white-space: pre-wrap">{{ localText }}</pre>
      </details>
      <details class="mb-3">
        <summary class="small text-body-secondary">What a new pod receives (as saved)</summary>
        <pre class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="white-space: pre-wrap">{{ previewText }}</pre>
      </details>

      <BAlert :model-value="!!error" variant="danger" class="mt-2 mb-0">{{ error }}</BAlert>
    </template>

    <template #footer>
      <small class="text-body-secondary me-auto">{{ stored ? 'Saved in ' + store : 'Nothing saved yet' }}</small>
      <BButton variant="outline-danger" size="sm" :disabled="saving || !stored" @click="reset">Clear</BButton>
      <BButton variant="outline-light" size="sm" @click="ui.configOpen = false">Close</BButton>
      <BButton variant="primary" size="sm" :disabled="saving" @click="save"><BSpinner v-if="saving" small class="me-1" />Save</BButton>
    </template>

    <FolderPicker v-model="picker.open" :title="picker.title" :start="picker.start" :memory-key="picker.memory" @choose="picked" />
  </BModal>
</template>

<script setup>
/**
 * ConfigModal — the gear icon in the navbar. Maps the three folders on this PC (project tree,
 * plates, ComfyUI-Shared) that the API keeps (GET/PUT/DELETE /api/mounts), plus the pod volume
 * and extra env. Everything a runtime receives is derived by the API from the mapping and from
 * what the project tree declares about itself; nothing about a machine is typed here.
 */
import { computed, reactive, ref } from 'vue'
import { useUiStore } from '../stores/ui'
import { useMountsStore } from '../stores/mounts'
import { settingsAPI } from '../api/settings'
import FolderPicker from './FolderPicker.vue'

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
const newKey = ref('')

const LABELS = { project: 'Project tree', plates: 'Plates', 'comfy-shared': 'ComfyUI-Shared' }
const label = (f) => LABELS[f.key] || f.key
const required = computed(() => folders.value.filter((f) => !f.custom))
// The API's derived row for a custom folder (exists, declared), matched by name.
const customRow = (c) => folders.value.find((f) => f.custom && f.key === c.name) || { local: '', exists: false }

function take(payload) {
  cfg.value = payload.config
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

async function load() {
  loading.value = true; error.value = null
  const payload = await mounts.load()
  if (payload) take(payload); else error.value = mounts.error
  try { keyInfo.value = await settingsAPI.get() } catch { /* a backend without settings: the key comes from the environment */ }
  newKey.value = ''
  loading.value = false
}

function folderState(f, v) {
  if (!v) return null
  if (!v.startsWith('/')) return false
  return f.local === v ? f.exists : null   // the API checked this exact path; anything else is unknown until saved
}

function browse(key, name, start, memory = key) {
  picker.key = key; picker.title = `Choose the ${name.toLowerCase()} folder`; picker.start = start || ''
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
  return e.length ? e.map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join('\n') : 'nothing mapped yet'
})

const previewText = computed(() => {
  const p = preview.value
  const lines = []
  if (p.network_volume_id) lines.push(`network volume ${p.network_volume_id} mounted at ${p.volume_mount_path}${p.data_center_id ? ' in ' + p.data_center_id : ''}`)
  else lines.push('no network volume: per-pod disk only')
  for (const [k, v] of Object.entries(p.env || {})) lines.push(`${k}=${v}`)
  return lines.join('\n')
})

async function save() {
  saving.value = true; error.value = null
  if (newKey.value) {
    try { keyInfo.value = await settingsAPI.set({ runpod_api_key: newKey.value }); newKey.value = '' }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
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
