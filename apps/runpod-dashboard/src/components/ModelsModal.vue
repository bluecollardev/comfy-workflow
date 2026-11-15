<template>
  <BModal :model-value="ui.modelsOpen" :title="$t('models.title')" size="xl" scrollable lazy ok-only :ok-title="$t('models.done')" ok-variant="outline-light" data-testid="models-modal" @update:model-value="ui.modelsOpen = $event" @show="open" @hidden="stop">
    <p class="small text-body-secondary mb-2">{{ $t('models.intro') }}</p>
    <BAlert v-if="error" :model-value="true" variant="danger" class="small py-2" data-testid="models-error">{{ error }}</BAlert>

    <div class="row g-2 align-items-end mb-3">
      <div class="col-md-7 small" data-testid="models-target">
        <template v-if="target">
          <i class="fa-solid fa-hard-drive me-1"></i>{{ $t('models.target', { name: target.name, dc: target.datacenter }) }}
          <span class="text-body-secondary">{{ target.is_shared ? $t('models.targetShared') : $t('models.targetDefault') }}</span>
        </template>
        <span v-else class="text-warning">{{ $t('models.targetNone') }}</span>
      </div>
      <div class="col-md-5">
        <label class="small mb-1" for="mdl-shared">{{ $t('models.sharedPick') }}</label>
        <BFormSelect id="mdl-shared" :model-value="volumes.shared?.id || ''" :options="sharedOptions" size="sm" :disabled="volumes.busyId !== null" data-testid="models-shared-select" @update:model-value="pickShared" />
      </div>
    </div>

    <form class="d-flex gap-2 mb-3" data-testid="models-search-form" @submit.prevent="search">
      <BFormInput v-model.trim="query" size="sm" :placeholder="$t('models.searchPlaceholder')" :aria-label="$t('models.searchLabel')" data-testid="models-search" />
      <BButton type="submit" size="sm" variant="primary" class="text-nowrap" :disabled="query.length < 2 || searching" data-testid="models-search-go"><BSpinner v-if="searching" small class="me-1" /><i v-else class="fa-brands fa-hugging-face me-1"></i>{{ $t('models.search') }}</BButton>
    </form>

    <div v-if="results" class="list-group mb-3" data-testid="models-results">
      <div v-if="!results.length" class="list-group-item small text-body-secondary" data-testid="models-no-results">{{ $t('models.noResults') }}</div>
      <button v-for="r in results" :key="r.id" type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-2" :class="{ active: repo === r.id }" data-testid="models-result" :data-repo="r.id" @click="openRepo(r.id)">
        <span class="font-monospace flex-grow-1">{{ r.id }}</span>
        <BBadge v-if="r.gated" variant="warning" :title="$t('models.gatedTitle')">{{ $t('models.gated') }}</BBadge>
        <small class="text-body-secondary text-nowrap">{{ $t('models.repoFacts', { downloads: r.downloads, likes: r.likes, updated: r.updated || '?' }) }}</small>
      </button>
    </div>

    <div v-if="repo" class="mb-3" data-testid="models-repo">
      <h6 class="mb-2">{{ $t('models.files', { repo }) }}</h6>
      <div v-if="loadingFiles" class="small text-body-secondary"><BSpinner small class="me-2" />{{ $t('models.loadingFiles') }}</div>
      <div v-else-if="!files.length" class="small text-body-secondary" data-testid="models-no-files">{{ $t('models.noFiles') }}</div>
      <table v-else class="table table-sm align-middle mb-2" data-testid="models-files">
        <tbody>
          <tr v-for="f in files" :key="f.path" data-testid="models-file" :data-path="f.path">
            <td style="width: 2rem"><input v-model="chosen[f.path]" type="checkbox" class="form-check-input" :disabled="busy" :aria-label="f.path" data-testid="models-file-check" /></td>
            <td class="font-monospace small text-break">{{ f.path }}<BBadge v-if="f.locked" variant="warning" class="ms-2" data-testid="models-file-locked" :title="$t('models.gatedTitle')">{{ $t('models.locked') }}</BBadge></td>
            <td class="text-nowrap small text-body-secondary" data-testid="models-file-size">{{ fmt(f.bytes) }}</td>
            <td style="width: 12rem"><BFormSelect v-model="folders[f.path]" :options="FOLDERS" size="sm" :disabled="busy" :aria-label="$t('models.folder')" data-testid="models-file-folder" /></td>
          </tr>
        </tbody>
      </table>
      <div v-if="files.length" class="d-flex align-items-center gap-3">
        <span class="small text-body-secondary" data-testid="models-selected">{{ $t('models.selected', { n: picked.length, size: fmt(pickedBytes) }) }}</span>
        <BButton size="sm" variant="primary" :disabled="!picked.length || !target || busy || lockedPicked" data-testid="models-load" @click="load"><i class="fa-solid fa-cloud-arrow-down me-1"></i>{{ $t('models.load') }}</BButton>
        <BButton size="sm" variant="outline-light" :disabled="!picked.length" data-testid="models-want" @click="want"><i class="fa-solid fa-bookmark me-1"></i>{{ $t('models.want') }}</BButton>
        <span v-if="lockedPicked" class="small text-warning" data-testid="models-locked-note">{{ $t('models.lockedNote') }}</span>
        <span v-else class="small text-body-secondary">{{ $t('models.billed') }}</span>
      </div>
    </div>

    <div v-if="job" class="small p-2 border rounded mb-3" data-testid="models-job" :data-state="job.state">
      <template v-if="job.state === 'done'"><i class="fa-solid fa-check text-success me-1"></i>{{ $t('models.jobDone', { files: (job.fetched || []).join(', ') || '—' }) }}</template>
      <template v-else-if="['failed', 'cancelled'].includes(job.state)"><i class="fa-solid fa-triangle-exclamation text-danger me-1"></i>{{ $t('models.jobFailed', { why: job.error || job.state }) }}</template>
      <template v-else>
        <BSpinner small class="me-2" />{{ $t('models.jobWorking', { state: job.state, pod: job.pod_name || '…' }) }}
        <BButton size="sm" variant="outline-light" class="ms-2" data-testid="models-cancel" @click="cancel">{{ $t('models.cancel') }}</BButton>
      </template>
      <pre v-if="job.lines?.length" class="mb-0 mt-1 small text-body-secondary" data-testid="models-job-lines">{{ job.lines.slice(-6).join('\n') }}</pre>
    </div>

    <h6 class="mb-1" data-testid="wanted-heading">{{ $t('wanted.title', { n: wanted.rows.length }) }}</h6>
    <p class="small text-body-secondary mb-2">{{ $t('wanted.intro') }}</p>
    <div class="d-flex flex-wrap gap-2 mb-2" data-testid="wanted-actions">
      <BButton size="sm" variant="outline-light" :disabled="!target || wantedBusy" data-testid="wanted-save" @click="saveInstalled"><i class="fa-solid fa-floppy-disk me-1"></i>{{ $t('wanted.save') }}</BButton>
      <BButton size="sm" variant="outline-light" :disabled="wantedBusy" data-testid="wanted-binc" @click="addBinc"><i class="fa-solid fa-list me-1"></i>{{ $t('wanted.binc') }}</BButton>
      <BButton size="sm" variant="primary" :disabled="!target || busy || wantedBusy || !wanted.loadable" data-testid="wanted-load" @click="loadMissing"><i class="fa-solid fa-cloud-arrow-down me-1"></i>{{ $t('wanted.load', { n: wanted.loadable, size: fmt(wanted.loadableBytes) }) }}</BButton>
      <BButton size="sm" variant="outline-danger" :disabled="!wanted.rows.length || wantedBusy" data-testid="wanted-clear" @click="clearAll"><i class="fa-solid fa-trash me-1"></i>{{ $t('wanted.clear') }}</BButton>
    </div>
    <div v-if="pasteOpen" class="mb-2" data-testid="wanted-paste">
      <p class="small text-warning mb-1">{{ $t('wanted.pasteWhy') }}</p>
      <BFormTextarea v-model="pasted" rows="4" class="font-monospace small mb-1" :placeholder="$t('wanted.pastePlaceholder')" data-testid="wanted-paste-text" />
      <BButton size="sm" variant="outline-light" :disabled="!pasted.trim()" data-testid="wanted-paste-add" @click="addPasted">{{ $t('wanted.pasteAdd') }}</BButton>
    </div>
    <BAlert v-if="wantedNote" :model-value="true" variant="info" class="small py-2" data-testid="wanted-note">{{ wantedNote }}</BAlert>
    <BAlert v-if="wanted.warning" :model-value="true" variant="warning" class="small py-2" data-testid="wanted-warning">{{ wanted.warning }}</BAlert>
    <div v-if="!wanted.rows.length" class="small text-body-secondary mb-3" data-testid="wanted-empty">{{ $t('wanted.empty') }}</div>
    <table v-else class="table table-sm align-middle mb-3" data-testid="wanted-table">
      <tbody>
        <tr v-for="r in wanted.rows" :key="r.key" data-testid="wanted-row" :data-state="r.state" :data-name="r.name">
          <td class="font-monospace small text-break">{{ r.folder }}/{{ r.name }}<div v-if="r.note" class="text-body-secondary">{{ r.note }}</div></td>
          <td class="small text-body-secondary text-break">{{ r.repo || $t('wanted.noRepo') }}</td>
          <td class="small text-nowrap text-body-secondary">{{ r.bytes ? fmt(r.bytes) : '' }}</td>
          <td class="text-nowrap"><BBadge :variant="r.state === 'present' ? 'success' : r.state === 'missing' ? 'warning' : 'secondary'" data-testid="wanted-state">{{ $t(`wanted.state_${r.state}`) }}</BBadge></td>
          <td class="text-end"><BButton size="sm" variant="outline-light" :aria-label="$t('wanted.remove')" data-testid="wanted-remove" @click="removeOne(r)"><i class="fa-solid fa-xmark"></i></BButton></td>
        </tr>
      </tbody>
    </table>

    <h6 class="mb-2">{{ $t('models.onVolume') }}</h6>
    <div class="small" data-testid="models-on-volume">
      <span v-if="onVolume === null" class="text-body-secondary" data-testid="models-on-volume-unknown">{{ $t('models.onVolumeUnknown') }}</span>
      <span v-else-if="!onVolume.length" class="text-body-secondary">{{ $t('models.onVolumeNone') }}</span>
      <template v-else>
        <div v-for="f in onVolume" :key="f.path" class="d-flex justify-content-between" data-testid="models-on-volume-file"><span class="font-monospace">{{ f.path }}</span><span class="text-body-secondary">{{ fmt(f.bytes) }}</span></div>
      </template>
    </div>
  </BModal>
</template>

<script setup>
/**
 * ModelsModal (ADR-042 section 9): search Hugging Face, open a repo to see its weight files with exact sizes, choose files and the folder of
 * models/ each goes to, and load them onto the Shared volume (the Default Configuration's volume until one is Shared) by a short pod.
 * The core re-reads every file from Hugging Face, so the window sends only repo, path, revision and folder. No approval is asked for.
 */
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { modelsAPI } from '../api/models'
import { wantedAPI } from '../api/wanted'
import { volumesAPI } from '../api/volumes'
import { useUiStore } from '../stores/ui'
import { useVolumesStore } from '../stores/volumes'
import { useMountsStore } from '../stores/mounts'
import { errorText } from '../stores/toast'
import { fmtBytes as fmt } from '../utils/studioTree'
import { t } from '../i18n'
import { useConfirmStore } from '../stores/confirm'

const FOLDERS = ['diffusion_models', 'vae', 'vae_approx', 'checkpoints', 'loras', 'text_encoders', 'clip', 'clip_vision', 'controlnet', 'upscale_models', 'latent_upscale_models', 'model_patches', 'unet', 'embeddings', 'depthanything', 'sam2', 'SEEDVR2']
const TERMINAL = ['done', 'failed', 'cancelled']
const ui = useUiStore()
const volumes = useVolumesStore()
const mounts = useMountsStore()
const error = ref(''), query = ref(''), searching = ref(false), results = ref(null)
const repo = ref(''), files = ref([]), loadingFiles = ref(false)
const chosen = reactive({}), folders = reactive({})
const job = ref(null), onVolume = ref(null)
// the wanted list with each row's state on the target volume; `warning` when that volume is too small
const wanted = reactive({ rows: [], loadable: 0, loadableBytes: 0, warning: '' })
const wantedBusy = ref(false), wantedNote = ref(''), pasteOpen = ref(false), pasted = ref('')
let timer = null

/** Where the files go: the Shared volume, else the Default Configuration's volume. */
const target = computed(() => volumes.shared || volumes.volumes.find((v) => v.id === mounts.config?.network_volume_id) || volumes.volumes.find((v) => v.is_default) || null)
const sharedOptions = computed(() => [{ value: '', text: t('models.sharedNone') }, ...volumes.volumes.map((v) => ({ value: v.id, text: `${v.name} (${v.datacenter})` }))])
const picked = computed(() => files.value.filter((f) => chosen[f.path]))
const lockedPicked = computed(() => picked.value.some((f) => f.locked))
const pickedBytes = computed(() => picked.value.reduce((n, f) => n + (f.bytes || 0), 0))
const busy = computed(() => !!job.value && !TERMINAL.includes(job.value.state))

async function open() {
  error.value = ''
  await volumes.load()
  mounts.load?.()
  refreshOnVolume()
  refreshWanted()
}
async function pickShared(id) {
  if (id) { const v = volumes.volumes.find((x) => x.id === id); if (v) await volumes.setShared(v) } else await volumes.setShared(null)
  refreshOnVolume()
  refreshWanted()
}
async function search() {
  error.value = ''; searching.value = true; results.value = null
  try { results.value = (await modelsAPI.search(query.value)) || [] } catch (e) { error.value = errorText(e) } finally { searching.value = false }
}
async function openRepo(id) {
  error.value = ''; repo.value = id; files.value = []; loadingFiles.value = true
  for (const k of Object.keys(chosen)) delete chosen[k]
  try {
    files.value = (await modelsAPI.files(id)) || []
    for (const f of files.value) folders[f.path] = f.folder || 'diffusion_models'
  } catch (e) { error.value = errorText(e); repo.value = '' } finally { loadingFiles.value = false }
}
async function load() {
  error.value = ''
  if (!target.value) return
  try {
    job.value = await modelsAPI.fetch(target.value.id, picked.value.map((f) => ({ repo: repo.value, path: f.path, revision: 'main', folder: folders[f.path] })))
    track()
  } catch (e) { error.value = errorText(e) }
}
function track() {
  stop()
  timer = setInterval(async () => {
    try {
      job.value = await volumesAPI.job(job.value.id)
      if (TERMINAL.includes(job.value.state)) { stop(); refreshOnVolume(); refreshWanted() }
    } catch (e) { stop(); error.value = errorText(e) }
  }, 1500)
}
async function cancel() { try { job.value = await volumesAPI.cancel(job.value.id) } catch (e) { error.value = errorText(e) } }
/** What models/ already holds, when the core can say (null: it cannot without listing the volume). */
async function refreshOnVolume() {
  onVolume.value = null
  if (!target.value) return
  try {
    const r = await modelsAPI.status(target.value.id)
    const list = Array.isArray(r) ? r : r?.files || r?.items || null
    onVolume.value = list ? list.map((f) => ({ path: f.path || [f.folder, f.name].filter(Boolean).join('/'), bytes: f.bytes ?? f.size ?? 0 })) : null
  } catch { onVolume.value = null }
}
/** The wanted list against the target volume: the core says present, missing or unknown (the volume cannot be listed) for each row. */
async function refreshWanted() {
  let r
  try { r = target.value ? await wantedAPI.status(target.value.id) : null } catch { r = null }
  if (!r) { try { const l = await wantedAPI.list(); r = { rows: (Array.isArray(l) ? l : l?.models || []).map((e) => ({ ...e, key: `${e.repo}|${e.repo ? e.path : e.name}|${e.folder}`, state: 'unknown', loadable: !!e.repo })), short_by_bytes: 0 } } catch (e) { error.value = errorText(e); return } }
  wanted.rows = r.rows || []
  const todo = wanted.rows.filter((x) => x.state !== 'present' && x.loadable)
  wanted.loadable = todo.length; wanted.loadableBytes = todo.reduce((n, x) => n + (x.bytes || 0), 0)
  wanted.warning = r.short_by_bytes > 0 ? t('wanted.tooSmall', { vol: r.volume_gb, need: Math.ceil(((r.present_bytes || 0) + (r.missing_bytes || 0)) / 1e9) }) : ''
}
async function wantedDo(fn, note) {
  error.value = ''; wantedNote.value = ''; wantedBusy.value = true
  try { const r = await fn(); if (note) wantedNote.value = note(r); await refreshWanted(); return r } catch (e) { error.value = errorText(e); return null } finally { wantedBusy.value = false }
}
const want = () => wantedDo(() => wantedAPI.add(picked.value.map((f) => ({ folder: folders[f.path], repo: repo.value, path: f.path, bytes: f.bytes, sha256: f.sha256 }))), (r) => t('wanted.added', { n: r.added, u: r.updated }))
const saveInstalled = () => wantedDo(() => wantedAPI.saveInstalled(target.value.id), (r) => t('wanted.added', { n: r.added, u: r.updated }))
async function addBinc() {
  const r = await wantedDo(() => wantedAPI.addList({ volume_id: target.value?.id || '' }), (x) => t('wanted.added', { n: x.added, u: x.updated }) + (x.skipped?.length ? ' ' + t('wanted.skipped', { n: x.skipped.length }) : ''))
  if (!r && /paste the CSV/.test(error.value)) pasteOpen.value = true   // the volume cannot be read over S3 from here: take the text instead
}
async function addPasted() {
  const r = await wantedDo(() => wantedAPI.addList({ csv: pasted.value }), (x) => t('wanted.added', { n: x.added, u: x.updated }) + (x.skipped?.length ? ' ' + t('wanted.skipped', { n: x.skipped.length }) : ''))
  if (r) { pasteOpen.value = false; pasted.value = '' }
}
const removeOne = (r) => wantedDo(() => wantedAPI.remove([r.key], false))
const confirm = useConfirmStore()
const clearAll = async () => {
  if (!(await confirm.ask(t('wanted.confirmClear', { n: wanted.rows.length }), { okLabel: t('wanted.clear') }))) return   // the user says yes first
  await wantedDo(() => wantedAPI.remove([], true))
}
/** Load what the volume lacks: the first job is shown here; the core starts the others (20 files each) as each finishes. */
async function loadMissing() {
  const r = await wantedDo(() => wantedAPI.load(target.value.id), (x) => t('wanted.started', { files: x.files, size: fmt(x.bytes), jobs: x.jobs }))
  if (r) { if (r.warning) wanted.warning = r.warning; job.value = r.job; track() }
}
const stop = () => { if (timer) { clearInterval(timer); timer = null } }
onBeforeUnmount(stop)
</script>
