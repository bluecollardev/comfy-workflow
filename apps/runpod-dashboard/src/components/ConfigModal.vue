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
      </BRow>

      <div class="d-flex align-items-center justify-content-between mb-2">
        <h6 class="mb-0">Folders on this PC <span class="text-body-secondary fw-normal small">the three every run needs, then any of your own</span></h6>
        <BButton size="sm" variant="outline-light" @click="cfg.custom.push({ name: '', local: '', container: '', link: '', mode: 'rw' })"><i class="fa-solid fa-plus me-1"></i>Add folder</BButton>
      </div>
      <table class="table table-sm align-middle mb-3">
        <thead class="small text-body-secondary">
          <tr><th style="width: 22%">What</th><th style="width: 48%">Folder on this PC</th><th>On a pod</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="f in required" :key="f.key">
            <td>
              <div class="fw-semibold">{{ label(f) }} <BBadge variant="secondary" class="fw-normal">required</BBadge></div>
              <small class="text-body-secondary">{{ f.what }}</small>
            </td>
            <td>
              <div class="d-flex gap-2">
                <BFormInput v-model.trim="cfg.folders[f.key]" size="sm" class="font-monospace" placeholder="not mapped" :state="folderState(f, cfg.folders[f.key])" />
                <BButton size="sm" variant="outline-light" class="text-nowrap" @click="browse(f.key, label(f), cfg.folders[f.key])"><i class="fa-regular fa-folder-open me-1"></i>Browse</BButton>
              </div>
              <small v-if="cfg.folders[f.key] && f.local === cfg.folders[f.key] && !f.exists" class="text-danger">This folder does not exist on this PC.</small>
              <small v-else-if="f.declared" class="text-body-secondary">The project names it <code>{{ f.declared.path }}</code> ({{ f.declared.source }}); a pod links that onto <code>{{ f.container }}</code>.</small>
              <small v-else-if="f.key === 'project' && cfg.folders.project && f.local === cfg.folders.project && f.exists" class="text-warning">No root line in the tree's job files or structure page; a pod cannot link what the graphs name.</small>
              <small v-else-if="f.key !== 'project' && cfg.folders.project" class="text-body-secondary">Not declared by the project tree; nothing is linked for it on a pod.</small>
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
                <BButton size="sm" variant="outline-light" class="text-nowrap" @click="browse('custom:' + i, c.name || 'folder', c.local)"><i class="fa-regular fa-folder-open me-1"></i>Browse</BButton>
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

      <BFormCheckbox v-model="cfg.apply_by_default" switch class="mb-3">
        Apply to new pods by default <span class="text-body-secondary">(the pod form can switch it off per pod)</span>
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

    <FolderPicker v-model="picker.open" :title="picker.title" :start="picker.start" @choose="picked" />
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
import { ui } from '../stores/ui'
import { mountsAPI } from '../api/mounts'
import FolderPicker from './FolderPicker.vue'

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
const picker = reactive({ open: false, key: '', title: '', start: '' })

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
}

async function load() {
  loading.value = true; error.value = null
  try { take(await mountsAPI.get()) } catch (e) { error.value = e.response?.data?.detail || e.message } finally { loading.value = false }
}

function folderState(f, v) {
  if (!v) return null
  if (!v.startsWith('/')) return false
  return f.local === v ? f.exists : null   // the API checked this exact path; anything else is unknown until saved
}

function browse(key, name, start) {
  picker.key = key; picker.title = `Choose the ${name.toLowerCase()} folder`; picker.start = start || ''
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
  try { take(await mountsAPI.save(body())); ui.mountsVersion++ } catch (e) { error.value = e.response?.data?.detail || e.message } finally { saving.value = false }
}

async function reset() {
  saving.value = true; error.value = null
  try { take(await mountsAPI.reset()); ui.mountsVersion++ } catch (e) { error.value = e.response?.data?.detail || e.message } finally { saving.value = false }
}
</script>
