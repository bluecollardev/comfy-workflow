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
      Graphs, scripts and the older node packs name binc-PC's paths. A pod carries the data on a
      volume and makes those paths resolve with symlinks at start. This is where that mapping lives:
      saved by the API, not hardcoded in the app. Defaults come from the scan in
      <code>shared/shapes/mount-points.json</code>; the full story is <code>docs/MOUNT-POINTS.md</code>.
    </p>

    <div v-if="loading" class="text-center text-body-secondary py-3"><BSpinner small /></div>

    <template v-else-if="cfg">
      <BRow class="g-3 mb-3">
        <BCol md="5">
          <BFormGroup label="Network volume ID" label-for="cfg-volume" description="A persistent RunPod volume carrying CANALV2/, ComfyUI-Shared/ and plates/. Empty: the pod gets only its own disk and nothing below resolves.">
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
        <h6 class="mb-0">Links <span class="text-body-secondary fw-normal">path in the pod → where it lives on the volume</span></h6>
        <BButton size="sm" variant="outline-light" @click="cfg.links.push({ path: '', target: cfg.mount_path + '/', required: false, mode: 'rw', what: '' })">
          <i class="fa-solid fa-plus me-1"></i>Add link
        </BButton>
      </div>
      <table class="table table-sm align-middle mb-3">
        <thead class="small text-body-secondary">
          <tr><th style="width: 38%">Path the code names</th><th style="width: 38%">Target on the volume</th><th>Required</th><th>Mode</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="(l, i) in cfg.links" :key="i">
            <td>
              <BFormInput v-model.trim="l.path" size="sm" class="font-monospace" placeholder="/home/binc/…" />
              <small v-if="l.what" class="text-body-secondary">{{ l.what }}</small>
            </td>
            <td><BFormInput v-model.trim="l.target" size="sm" class="font-monospace" :placeholder="cfg.mount_path + '/…'" /></td>
            <td><BFormCheckbox v-model="l.required" switch size="sm" /></td>
            <td><BFormSelect v-model="l.mode" size="sm" :options="['rw', 'ro']" style="width: 5rem" /></td>
            <td class="text-end"><BButton variant="outline-light" size="sm" aria-label="Remove link" @click="cfg.links.splice(i, 1)"><i class="fa-solid fa-xmark"></i></BButton></td>
          </tr>
        </tbody>
      </table>

      <div class="d-flex align-items-center justify-content-between mb-2">
        <h6 class="mb-0">Environment <span class="text-body-secondary fw-normal">added to every pod that applies these mounts</span></h6>
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

      <details class="mb-3">
        <summary class="small text-body-secondary">What a new pod receives</summary>
        <pre class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="white-space: pre-wrap">{{ previewText }}</pre>
      </details>

      <details v-if="catalog.mounts?.length" class="mb-2">
        <summary class="small text-body-secondary">Where these defaults come from: the scan of the project tree</summary>
        <table class="table table-sm small mt-2 mb-0">
          <thead><tr><th>What</th><th>On binc-PC</th><th>Mentions</th><th>In the pod</th></tr></thead>
          <tbody>
            <tr v-for="m in catalog.mounts" :key="m.name">
              <td>{{ m.what }}</td>
              <td class="font-monospace">{{ m.binc_pc }}</td>
              <td>{{ m.mentions }}</td>
              <td class="font-monospace">{{ m.container || 'not mounted' }}</td>
            </tr>
          </tbody>
        </table>
      </details>

      <BAlert :model-value="!!error" variant="danger" class="mt-2 mb-0">{{ error }}</BAlert>
    </template>

    <template #footer>
      <small class="text-body-secondary me-auto">{{ stored ? 'Saved in ' + store : 'Defaults (nothing saved yet)' }}</small>
      <BButton variant="outline-danger" size="sm" :disabled="saving || !stored" @click="reset">Reset to defaults</BButton>
      <BButton variant="outline-light" size="sm" @click="ui.configOpen = false">Close</BButton>
      <BButton variant="primary" size="sm" :disabled="saving" @click="save"><BSpinner v-if="saving" small class="me-1" />Save</BButton>
    </template>
  </BModal>
</template>

<script setup>
/**
 * ConfigModal — the gear icon in the navbar. Edits the mount configuration the API keeps
 * (GET/PUT/DELETE /api/mounts): network volume, mount path, the binc-PC path → volume path
 * links the pod's entrypoint turns into symlinks (COMFY_LINKS), and extra env.
 * Nothing here is hardcoded in the app: defaults come from shared/shapes/mount-points.json.
 */
import { computed, ref } from 'vue'
import { ui } from '../stores/ui'
import { mountsAPI } from '../api/mounts'

const loading = ref(false)
const saving = ref(false)
const error = ref(null)
const cfg = ref(null)
const envRows = ref([])
const catalog = ref({})
const stored = ref(false)
const store = ref('')

function take(payload) {
  cfg.value = payload.config
  envRows.value = Object.entries(payload.config.env || {}).map(([key, value]) => ({ key, value }))
  catalog.value = payload.catalog || {}
  stored.value = payload.stored
  store.value = payload.store
}

async function load() {
  loading.value = true; error.value = null
  try { take(await mountsAPI.get()) } catch (e) { error.value = e.response?.data?.detail || e.message } finally { loading.value = false }
}

function body() {
  const env = {}
  for (const r of envRows.value) if (r.key) env[r.key] = r.value
  return { ...cfg.value, links: cfg.value.links.filter((l) => l.path && l.target), env }
}

const previewText = computed(() => {
  if (!cfg.value) return ''
  const b = body()
  const lines = []
  if (b.network_volume_id) lines.push(`network volume ${b.network_volume_id} mounted at ${b.mount_path}${b.data_center_id ? ' in ' + b.data_center_id : ''}`)
  else lines.push('no network volume: per-pod disk only')
  for (const [k, v] of Object.entries(b.env)) lines.push(`${k}=${v}`)
  if (b.links.length) lines.push('COMFY_LINKS=' + b.links.map((l) => `${l.path}=${l.target}`).join(';'))
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
