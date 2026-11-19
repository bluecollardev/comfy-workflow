<template>
  <BModal :model-value="true" :title="$t('publish.modal.title')" size="xl" scrollable lazy no-footer data-testid="publish-modal" @update:model-value="(v) => !v && $emit('close')">
    <div v-if="store.old" class="alert alert-info" data-testid="publish-modal-restart">{{ $t('publish.restart') }}</div>
    <div v-else class="publish-destination border rounded p-2 mb-2 small" data-testid="publish-destination">
      <div class="d-flex align-items-center gap-2 mb-1"><span class="fw-semibold">{{ $t('publish.destination.title') }}</span>
        <BButton size="sm" variant="outline-light" class="ms-auto" data-testid="publish-edit-settings" @click="openSettings"><i class="fa-solid fa-gear me-1"></i>{{ $t('publish.modal.editSettings') }}</BButton></div>
      <div v-for="id in ['s3', 'slack']" :key="id" class="mb-1" :data-testid="`publish-target-${id}`">
        <label class="d-flex align-items-center gap-2 flex-wrap"><input v-model="targets" type="checkbox" :value="id" class="form-check-input mt-0" :disabled="!ready(id).ok" :data-testid="`publish-target-${id}-check`" />
          <strong>{{ $t(id === 's3' ? 'publish.destination.s3' : 'publish.destination.slack') }}</strong>
          <template v-if="id === 's3'"><code data-testid="publish-destination-s3">{{ s3Dest(store.settings.s3.bucket, store.settings.s3.prefix) || $t('publish.notConfigured') }}</code><span v-if="store.settings.s3.region" class="text-body-secondary">{{ $t('publish.destination.region', { region: store.settings.s3.region }) }}</span><span class="text-body-secondary" data-testid="publish-destination-creds">{{ $t(store.settings.s3.credentials === 'panama' ? 'publish.destination.panama' : 'publish.destination.keys') }}</span></template>
          <span v-else data-testid="publish-destination-slack">{{ store.settings.slack.ready ? $t('publish.destination.slackLine', { channel: store.settings.slack.channel, workspace: store.settings.slack.workspace_name || 'Slack' }) : $t('publish.destination.notConnected') }}</span>
          <span class="badge" :class="ready(id).ok ? 'text-bg-success' : 'text-bg-secondary'" :data-testid="`publish-destination-${id}-badge`">{{ ready(id).ok ? $t('publish.destination.ready') : $t('publish.notReady') }}</span></label>
        <div v-if="!ready(id).ok" class="d-flex align-items-center gap-2 ms-4"><span class="text-warning" :data-testid="`publish-target-${id}-reason`">{{ ready(id).reason }}</span>
          <BButton size="sm" variant="outline-light" :data-testid="`publish-target-${id}-settings`" @click="id === 'slack' ? openConnect() : openSettings()">{{ $t(id === 'slack' ? 'publish.modal.openConnect' : 'publish.modal.openSettings') }}</BButton></div>
      </div>
    </div>
    <ul v-if="!store.old" class="nav nav-tabs mb-3" role="tablist" data-testid="publish-tabs">
      <li class="nav-item"><button type="button" class="nav-link" :class="{ active: tab === 'files' }" data-testid="publish-tab-files" @click="tab = 'files'">{{ $t('publish.backfill.tabFiles') }}</button></li>
      <li class="nav-item"><button type="button" class="nav-link" :class="{ active: tab === 'backfill' }" data-testid="publish-tab-backfill" @click="tab = 'backfill'">{{ $t('publish.backfill.tabBackfill') }}</button></li>
    </ul>
    <PublishBackfill v-if="!store.old && tab === 'backfill'" v-model:targets="targets" />
    <BRow v-else-if="!store.old" class="g-3">
      <!-- what to publish -->
      <BCol lg="7" data-testid="publish-what">
        <div class="fw-semibold small mb-1">{{ $t('publish.modal.what') }}</div>
        <div class="d-flex align-items-center gap-2 mb-2 small" data-testid="publish-source-picker" role="group">
          <span class="fw-semibold">{{ $t('publish.source.title') }}</span>
          <div class="btn-group btn-group-sm">
            <button type="button" class="btn btn-outline-light" :class="{ active: source === 'local' }" data-testid="publish-source-local" @click="source = 'local'">{{ $t('publish.source.local', { n: selected.length }) }}</button>
            <button type="button" class="btn btn-outline-light" :class="{ active: source === 'volume' }" :title="$t('publish.source.volumeTip', { name: volumeName || '' })" data-testid="publish-source-volume" @click="chooseVolume">{{ $t('publish.source.volume', { n: volSelected.length }) }}</button>
          </div>
        </div>
        <div class="small border rounded p-2 mb-2" data-testid="publish-sources">
          <div class="fw-semibold">{{ $t('publish.sources.title') }}</div>
          <div class="font-monospace" data-testid="publish-sources-pc">{{ source === 'volume' ? $t('publish.source.volumeDir', { dir: `output/${vlisting?.dir || ''}`.replace(/\/$/, '') }) : $t('publish.sources.thisPc', { dir: `output/${listing?.dir || ''}`.replace(/\/$/, '') }) }}</div>
          <div data-testid="publish-sources-selected">{{ sourcesText }}</div>
          <div v-if="notLocalCount" class="text-warning" data-testid="publish-sources-not-local">{{ $t('publish.sources.notLocal', { n: notLocalCount }) }}</div>
          <div v-if="allSelected.length" class="text-body-secondary" data-testid="publish-sources-paths">
            <div v-for="it in selectedShown" :key="`${it.where}:${it.path}`" class="d-flex align-items-center gap-2" data-testid="publish-selected-item" :data-where="it.where">
              <span class="badge" :class="it.where === 'volume' ? 'text-bg-info' : 'text-bg-secondary'" data-testid="publish-selected-where" :data-where="it.where">{{ $t(it.where === 'volume' ? 'publish.source.whereVolume' : 'publish.source.whereLocal') }}</span>
              <span class="font-monospace text-truncate" data-testid="publish-sources-path">{{ it.path }}</span>
              <BButton variant="link" size="sm" class="p-0 text-danger ms-auto" data-testid="publish-selected-remove" :data-path="it.path" :data-where="it.where" @click="removeSelected(it)">{{ $t('publish.source.remove') }}</BButton>
            </div>
            <BButton v-if="allSelected.length > 5" variant="link" size="sm" class="p-0" data-testid="publish-sources-more" @click="pathsMore = !pathsMore">{{ pathsMore ? $t('publish.sources.less') : $t('publish.sources.more', { n: allSelected.length - 5 }) }}</BButton>
          </div>
        </div>
        <template v-if="source === 'local'">
          <div class="d-flex flex-wrap gap-1 mb-1 small align-items-center">
            <BButton size="sm" variant="outline-light" :disabled="!listing?.parent && listing?.dir === ''" data-testid="publish-up" @click="go(listing?.parent ?? '')"><i class="fa-solid fa-arrow-up"></i></BButton>
            <BButton size="sm" variant="link" class="p-0" data-testid="publish-crumb-root" @click="go('')">{{ $t('publish.modal.root') }}</BButton>
            <BButton size="sm" variant="outline-light" data-testid="publish-quick-deliver" @click="go('deliver')">{{ $t('publish.modal.deliver') }}</BButton>
            <BButton size="sm" variant="outline-light" data-testid="publish-quick-proxies" @click="go('.proxies')">{{ $t('publish.modal.proxies') }}</BButton>
          </div>
          <div class="small font-monospace text-body-secondary mb-1" data-testid="publish-dir">{{ $t('publish.modal.dir') }}: {{ listing?.dir || $t('publish.modal.root') }}</div>
          <BFormInput v-model="nameFilter" size="sm" class="mb-1" :placeholder="$t('publish.modal.filter')" data-testid="publish-filter" autocomplete="off" />
          <div class="list-group list-group-flush border rounded tree" data-testid="publish-tree">
            <div v-if="loadingDir" class="list-group-item small"><BSpinner small /></div>
            <div v-for="e in shownEntries" :key="e.path" class="list-group-item py-1 d-flex align-items-center gap-2 small flex-wrap" data-testid="publish-entry" :data-path="e.path" :data-dir="e.dir ? 'true' : 'false'">
              <input type="checkbox" class="form-check-input mt-0" :checked="selected.includes(e.path)" data-testid="publish-entry-check" :data-path="e.path" @change="toggle(e.path, $event.target.checked)" />
              <button v-if="e.dir" type="button" class="btn btn-link btn-sm p-0 font-monospace text-start" data-testid="publish-entry-open" @click="go(e.path)"><i class="fa-regular fa-folder me-1"></i>{{ e.name }}</button>
              <span v-else class="font-monospace text-truncate"><i class="fa-regular fa-file me-1"></i>{{ e.name }}</span>
              <span v-if="e.weight" class="badge text-bg-warning" data-testid="publish-entry-weight">{{ $t('publish.modal.weight') }}</span>
              <span v-if="!e.dir" class="ms-auto text-body-secondary">{{ formatBytes(e.bytes) }}</span>
              <span v-if="!e.dir && keyRows.has(e.path)" class="w-100 text-body-secondary font-monospace text-truncate" data-testid="publish-entry-key" :title="s3Key(store.settings.s3.prefix, e.path)">{{ $t('publish.sources.keyArrow', { key: s3Key(store.settings.s3.prefix, e.path) }) }}</span>
            </div>
            <div v-if="!loadingDir && !shownEntries.length" class="list-group-item small text-body-secondary" data-testid="publish-empty">{{ $t('publish.modal.empty') }}</div>
          </div>
          <div v-if="listing?.truncated" class="small text-warning" data-testid="publish-truncated">{{ $t('publish.modal.truncated', { n: listing.entries.length }) }}</div>
          <div class="d-flex align-items-center gap-2 mt-1"><BButton size="sm" variant="outline-light" :disabled="!listing" data-testid="publish-select-folder" @click="toggle(listing.dir, true)">{{ $t('publish.modal.selectFolder') }}</BButton><span class="small text-body-secondary" data-testid="publish-selected-count">{{ $t('publish.modal.selected', { n: selected.length }) }}</span></div>
        </template>
        <template v-else>
          <div v-if="volRestart" class="alert alert-info small" data-testid="publish-volume-restart">{{ $t('publish.source.volumeRestart') }}</div>
          <template v-else>
            <div class="d-flex flex-wrap gap-1 mb-1 small align-items-center">
              <BButton size="sm" variant="outline-light" :disabled="!vlisting?.dir" data-testid="publish-volume-up" @click="goVol(vlisting?.parent ?? '')"><i class="fa-solid fa-arrow-up"></i></BButton>
              <BButton size="sm" variant="link" class="p-0" data-testid="publish-volume-crumb-root" @click="goVol('')">{{ $t('publish.modal.root') }}</BButton>
              <label class="ms-auto mb-0"><input v-model="hideEmptyV" type="checkbox" class="form-check-input me-1" data-testid="publish-volume-hide-empty" />{{ $t('publish.source.hideEmpty') }}</label>
              <span v-if="hideEmptyV && vEmptyHidden" class="text-body-secondary" data-testid="publish-volume-empty-hidden">{{ $t('publish.source.emptyHidden', { n: vEmptyHidden }) }}</span>
            </div>
            <div class="small font-monospace text-body-secondary mb-1" data-testid="publish-volume-dir">{{ $t('publish.modal.dir') }}: {{ vlisting?.dir || $t('publish.modal.root') }}</div>
            <BFormInput v-model="vFilter" size="sm" class="mb-1" :placeholder="$t('publish.modal.filter')" data-testid="publish-volume-filter" autocomplete="off" />
            <div class="list-group list-group-flush border rounded tree" data-testid="publish-volume-tree">
              <div v-if="loadingVol" class="list-group-item small"><BSpinner small /></div>
              <div v-for="e in vShown" :key="e.path" class="list-group-item py-1 d-flex align-items-center gap-2 small flex-wrap" :class="{ 'opacity-50': e.empty }" data-testid="publish-volume-entry" :data-path="e.path" :data-dir="e.dir ? 'true' : 'false'">
                <input type="checkbox" class="form-check-input mt-0" :checked="volSelected.includes(e.path)" data-testid="publish-volume-entry-check" :data-path="e.path" @change="toggleVol(e.path, $event.target.checked)" />
                <button v-if="e.dir" type="button" class="btn btn-link btn-sm p-0 font-monospace text-start" data-testid="publish-volume-entry-open" @click="goVol(e.path)"><i class="fa-regular fa-folder me-1"></i>{{ e.name }}</button>
                <span v-else class="font-monospace text-truncate"><i class="fa-regular fa-file me-1"></i>{{ e.name }}</span>
                <span v-if="e.empty" class="badge text-bg-secondary" data-testid="publish-volume-empty-tag">{{ $t('publish.source.emptyTag') }}</span>
                <span v-if="e.weight" class="badge text-bg-warning" data-testid="publish-volume-weight">{{ $t('publish.modal.weight') }}</span>
                <span v-if="!e.dir" class="ms-auto text-body-secondary">{{ formatBytes(e.bytes) }}</span>
                <span v-else class="ms-auto d-flex align-items-center gap-1">
                  <span v-if="vsize[e.path]?.busy"><BSpinner small /> <BButton variant="link" size="sm" class="p-0" data-testid="publish-volume-measure-cancel" :data-path="e.path" @click="cancelMeasure(e.path)">{{ $t('publish.source.cancel') }}</BButton></span>
                  <span v-else-if="vsize[e.path]?.bytes != null" class="text-body-secondary" data-testid="publish-volume-size" :data-path="e.path">{{ $t('publish.source.sizeOf', { files: vsize[e.path].files, size: formatBytes(vsize[e.path].bytes) }) }}</span>
                  <BButton v-else variant="link" size="sm" class="p-0" data-testid="publish-volume-measure" :data-path="e.path" @click="measureVol(e.path)">{{ $t('publish.source.measure') }}</BButton>
                </span>
              </div>
              <div v-if="!loadingVol && !vShown.length" class="list-group-item small text-body-secondary" data-testid="publish-volume-none">{{ $t('publish.source.nothingHere') }}</div>
            </div>
            <div class="d-flex align-items-center gap-2 mt-1"><BButton size="sm" variant="outline-light" :disabled="!vlisting" data-testid="publish-volume-select-folder" @click="toggleVol(vlisting.dir, true)">{{ $t('publish.modal.selectFolder') }}</BButton><span class="small text-body-secondary" data-testid="publish-volume-selected-count">{{ $t('publish.modal.selected', { n: volSelected.length }) }}</span></div>
          </template>
        </template>
      </BCol>
      <!-- plan -->
      <BCol lg="5" data-testid="publish-plan-col">
        <div class="mb-3" data-testid="publish-files-dest">
          <div class="fw-semibold small mb-1">{{ $t('publish.backfill.destination') }}</div>
          <label class="small mb-0" for="pf-prefix">{{ $t('publish.backfill.prefix') }}</label>
          <BFormInput id="pf-prefix" :model-value="store.settings.s3.prefix" readonly size="sm" class="font-monospace" data-testid="publish-files-prefix" />
          <div class="small font-monospace mt-1" data-testid="publish-files-destline">{{ $t(store.settings.s3.credentials === 'panama' ? 'publish.backfill.destLine' : 'publish.backfill.destLinePlain', { dest: filesDest }) }}</div>
          <div class="small text-body-secondary" data-testid="publish-files-asis">{{ $t('publish.backfill.asIs') }}</div>
          <div class="small text-body-secondary" data-testid="publish-files-prefix-hint">{{ $t('publish.modal.prefixInSettings') }} <BButton variant="link" size="sm" class="p-0 align-baseline" data-testid="publish-files-open-settings" @click="openSettings">{{ $t('publish.modal.openSettings') }}</BButton></div>
        </div>
        <div class="fw-semibold small mb-1">{{ $t('publish.modal.plan') }}</div>
        <div v-if="!selected.length" class="small text-body-secondary" data-testid="publish-plan-none">{{ $t('publish.modal.nothing') }}</div>
        <div v-else-if="planning && !plan" class="small"><BSpinner small class="me-1" />{{ $t('publish.modal.planning') }}</div>
        <template v-else-if="plan">
          <div v-for="(b, i) in plan.blockers" :key="i" class="alert alert-danger py-1 px-2 small mb-1" data-testid="publish-blocker">{{ b }}</div>
          <div v-if="plan.s3" class="small font-monospace" data-testid="publish-dest">{{ $t('publish.modal.dest', { dest: plan.s3.dest }) }}<template v-if="store.settings.s3.credentials === 'panama'"> {{ $t('publish.modal.panamaBucket') }}</template></div>
          <div class="small" data-testid="publish-counts">{{ $t('publish.modal.count', { files: plan.files, size: formatBytes(plan.total_bytes) }) }}</div>
          <div v-if="skippedCount" class="small text-body-secondary" data-testid="publish-skipped">{{ $t('publish.modal.skipped', { n: skippedCount }) }}</div>
          <div v-if="plan.refused.length" class="small mt-1" data-testid="publish-refused"><div class="fw-semibold text-warning">{{ $t('publish.modal.refused') }}</div>
            <div v-for="r in plan.refused" :key="r.path" class="text-warning" data-testid="publish-refused-item" :data-path="r.path"><span class="font-monospace">{{ r.path }}</span>: {{ r.reason }}<span v-if="/pull|not on this pc/i.test(r.reason)" class="text-body-secondary" data-testid="publish-not-local"> · {{ $t('publish.modal.notLocal') }}</span></div></div>
        </template>
        <div v-if="targets.includes('slack')" class="mt-2">
          <label class="small mb-0" for="pub-message">{{ $t('publish.modal.message') }}</label>
          <textarea id="pub-message" v-model="message" class="form-control form-control-sm font-monospace" rows="3" data-testid="publish-message"></textarea>
          <div v-if="plan?.slack" class="small text-body-secondary mt-1" data-testid="publish-slack-preview"><span class="fw-semibold">{{ $t('publish.modal.preview') }}:</span> {{ plan.slack.preview }}</div>
        </div>
        <hr />
        <label class="small mb-0" for="pub-approved">{{ $t('publish.modal.approvedBy') }}</label>
        <BFormInput id="pub-approved" v-model.trim="approvedBy" size="sm" data-testid="publish-approved-by" />
        <div v-if="!approvedBy" class="small text-warning" data-testid="publish-approved-hint">{{ $t('publish.modal.approvedHint') }}</div>
        <div v-if="confirmText" class="small mt-2" data-testid="publish-confirm">{{ confirmText }}</div>
        <BButton variant="primary" size="sm" class="mt-2" :disabled="!canPublish" data-testid="publish-run" @click="run"><i class="fa-solid fa-cloud-arrow-up me-1"></i>{{ $t('publish.modal.publish') }}</BButton>
        <div v-if="runError" class="text-danger small mt-1" data-testid="publish-run-error">{{ runError }}</div>
      </BCol>
    </BRow>
    <PublishJob v-if="job && tab === 'files' && !store.old" :job="job" />
  </BModal>
</template>

<script setup>
/**
 * PublishModal: publish outputs to S3 and Slack. What (the local output tree, pre-selected with the files of what the Outputs window shows), where (S3, Slack: each only when configured),
 * the plan from the core (destination, counts, what is already there, what is refused, blockers), a named yes, then the progress, the links with their expiry and the Slack state.
 * Publishing settings are edited in Default Configuration (Publishing): the button here opens them.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePublishStore } from '../stores/publish'
import PublishJob from './PublishJob.vue'
import PublishBackfill from './PublishBackfill.vue'
import { useUiStore } from '../stores/ui'
import { publishAPI, RESTART } from '../api/publish'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { formatBytes } from '../sync-progress'
import { expiryText, publishActive, targetState, channelName, s3Dest, s3Key } from '../utils/publish'

const props = defineProps({ preselect: { type: Array, default: () => [] }, volumeDir: { type: String, default: '' }, volumeName: { type: String, default: '' } })
defineEmits(['close'])
const store = usePublishStore(), ui = useUiStore()
const filesDest = computed(() => `${s3Dest(store.settings.s3.bucket, store.settings.s3.prefix)}<path>`)   // where a file lands: s3://bucket/prefix/<its path under output/>
const tab = ref('files')
const pathsMore = ref(false)
// Two sources, both kept: the Local PC (publish.local) and the Volume (publish.volume, streamed through this PC). Switching never clears the other.
const source = ref(store.old ? 'local' : 'volume')   // Lucas: the Source defaults to the Volume (the outputs live there); an older core has no volume listing, so Local PC
const volSelected = ref(props.volumeDir ? [props.volumeDir] : [])
const allSelected = computed(() => [...selected.value.map((path) => ({ where: 'local', path })), ...volSelected.value.map((path) => ({ where: 'volume', path }))])
const selectedShown = computed(() => (pathsMore.value ? allSelected.value : allSelected.value.slice(0, 5)))
const removeSelected = (it) => { if (it.where === 'volume') toggleVol(it.path, false); else toggle(it.path, false) }
const itemsOut = () => [...selected.value, ...volSelected.value.map((path) => ({ where: 'volume', path }))]
const streamed = computed(() => { const its = (plan.value?.items || []).filter((i) => i.source === 'volume'); return { files: plan.value?.streamed_files ?? its.length, bytes: plan.value?.streamed_bytes ?? its.reduce((n, i) => n + (i.bytes || 0), 0) } })
const sourcesText = computed(() => {
  if (!allSelected.value.length) return t('publish.sources.none')
  const its = plan.value?.items || [], local = its.filter((i) => i.source !== 'volume')
  if (volSelected.value.length && plan.value) return t('publish.sources.mixed', { local: local.length, streamed: streamed.value.files, size: formatBytes(streamed.value.bytes) })
  return t('publish.sources.selected', { files: plan.value ? its.length : selected.value.length, size: formatBytes(its.reduce((n, i) => n + (i.bytes || 0), 0)) })
})
/** Files in the selection the core says are not on this PC (pull first). */
const notLocalCount = computed(() => (plan.value?.refused || []).filter((r) => /pull|not on this pc|not on the local/i.test(r.reason)).length)
const keyRows = computed(() => new Set(shownEntries.value.filter((e) => !e.dir).slice(0, 5).map((e) => e.path)))   // where the first rows would land on S3
const listing = ref(null), loadingDir = ref(false), nameFilter = ref('')
const selected = ref([...props.preselect])
const targets = ref([]), message = ref('')
const approvedBy = ref((() => { try { return localStorage.getItem('runpod-manager.approved-by') || '' } catch { return '' } })())
const plan = ref(null), planning = ref(false), runError = ref(''), jobId = ref(''), copiedPath = ref('')
const ready = (id) => targetState(store.settings, id)
const shownEntries = computed(() => (listing.value?.entries || []).filter((e) => !nameFilter.value || e.name.toLowerCase().includes(nameFilter.value.toLowerCase())))
const skippedCount = computed(() => (plan.value?.items || []).filter((i) => i.skip).length)

let dirSeq = 0
async function go(dir) {
  const my = ++dirSeq
  loadingDir.value = true; nameFilter.value = ''
  try { const r = await publishAPI.local({ dir }); if (my === dirSeq) listing.value = r } catch (e) { if (my === dirSeq) listing.value = { dir, parent: null, entries: [], truncated: 0 }; runError.value = errorText(e) } finally { if (my === dirSeq) loadingDir.value = false }
}
// the Volume tree
const vlisting = ref(null), loadingVol = ref(false), vFilter = ref(''), hideEmptyV = ref(true), volRestart = ref(false), vsize = ref({})
const vEntries = computed(() => (vlisting.value?.entries || []).filter((e) => !vFilter.value || e.name.toLowerCase().includes(vFilter.value.toLowerCase())))
const vShown = computed(() => (hideEmptyV.value ? vEntries.value.filter((e) => !e.empty) : vEntries.value))
const vEmptyHidden = computed(() => vEntries.value.filter((e) => e.empty).length)
let vSeq = 0
async function goVol(dir) {
  const my = ++vSeq
  loadingVol.value = true; vFilter.value = ''
  try { const r = await publishAPI.volume({ dir }); if (my === vSeq) { vlisting.value = r; volRestart.value = false } } catch (e) { if (my === vSeq) { vlisting.value = { dir, parent: null, entries: [], truncated: 0 }; if (errorText(e) === RESTART) volRestart.value = true; else runError.value = errorText(e) } } finally { if (my === vSeq) loadingVol.value = false }
}
const chooseVolume = () => { source.value = 'volume'; if (!vlisting.value) goVol(props.volumeDir || '') }
const toggleVol = (path, on) => { volSelected.value = on ? (volSelected.value.includes(path) ? volSelected.value : [...volSelected.value, path]) : volSelected.value.filter((p) => p !== path) }
let measureGen = 0
async function measureVol(path) {
  const my = ++measureGen
  vsize.value = { ...vsize.value, [path]: { busy: true, my } }
  try { const r = await publishAPI.volumeSize({ path }); if (vsize.value[path]?.my === my) vsize.value = { ...vsize.value, [path]: { files: r.files, bytes: r.bytes } } } catch { if (vsize.value[path]?.my === my) { const { [path]: _g, ...rest } = vsize.value; vsize.value = rest } }
}
const cancelMeasure = (path) => { const { [path]: _g, ...rest } = vsize.value; vsize.value = rest }   // the answer, when it comes, is dropped
const toggle = (path, on) => { selected.value = on ? (selected.value.includes(path) ? selected.value : [...selected.value, path]) : selected.value.filter((p) => p !== path) }

onMounted(async () => {
  await store.loadSettings()
  targets.value = (store.settings.defaults.targets || []).filter((id) => ready(id).ok)
  message.value = store.settings.defaults.message || ''
  store.watch()
  if (!store.old) { go(''); if (source.value === 'volume') goVol(props.volumeDir || '') }
})
watch(() => ui.configOpen, async (open) => { if (!open) { const before = [...targets.value]; await store.loadSettings(); targets.value = before.filter((id) => ready(id).ok) } })   // back from the settings: what is ready now
const openSettings = () => { ui.configFocus = 'publishing'; ui.configOpen = true }
const openConnect = () => { ui.connectTab = 'slack'; ui.connectOpen = true }
watch(() => ui.connectOpen, async (open) => { if (!open) { const before = [...targets.value]; await store.loadSettings(); targets.value = before.filter((id) => ready(id).ok) } })   // back from Connect > Slack

let planTimer = null, planSeq = 0
async function replan() {
  const my = ++planSeq
  if (!allSelected.value.length) { plan.value = null; planning.value = false; return }
  planning.value = true
  try { const p = await publishAPI.plan({ items: itemsOut(), targets: [...targets.value], ...(targets.value.includes('slack') ? { message: message.value } : {}) }); if (my === planSeq) plan.value = p } catch (e) { if (my === planSeq) plan.value = { ok: false, blockers: [errorText(e)], items: [], total_bytes: 0, files: 0, s3: null, slack: null, refused: [] } } finally { if (my === planSeq) planning.value = false }
}
watch([selected, volSelected, targets, message], () => { clearTimeout(planTimer); planTimer = setTimeout(replan, 300) }, { deep: true })
onBeforeUnmount(() => { clearTimeout(planTimer); planSeq++ })

const canPublish = computed(() => !!plan.value && plan.value.ok && !plan.value.blockers.length && (plan.value.files > 0 || targets.value.includes('slack')) && targets.value.length > 0 && !!approvedBy.value && !active.value)
const channel = computed(() => plan.value?.slack?.channel ? plan.value.slack.channel : channelName(store.settings.slack.channel))
const confirmText = computed(() => {
  if (!plan.value || !targets.value.length) return ''
  const dest = plan.value.s3?.dest || s3Dest(store.settings.s3.bucket, store.settings.s3.prefix), size = formatBytes(plan.value.total_bytes), workspace = store.settings.slack.workspace_name || 'Slack'
  const s3 = targets.value.includes('s3'), slack = targets.value.includes('slack')
  const tail = streamed.value.files ? ` ${t('publish.modal.streamed', { n: streamed.value.files, size: formatBytes(streamed.value.bytes) })}` : ''
  const base = s3 && slack ? t('publish.modal.confirm', { files: plan.value.files, size, dest, channel: channel.value, workspace }) : s3 ? t('publish.modal.confirmS3', { files: plan.value.files, size, dest }) : t('publish.modal.confirmSlack', { channel: channel.value, workspace })
  return base + tail
})
async function run() {
  runError.value = ''
  try {
    try { localStorage.setItem('runpod-manager.approved-by', approvedBy.value) } catch { /* storage blocked */ }
    const r = await store.run({ items: itemsOut(), targets: [...targets.value], approved_by: approvedBy.value, ...(targets.value.includes('slack') ? { message: message.value } : {}) })
    jobId.value = r.job_id
  } catch (e) { runError.value = errorText(e) }
}
const job = computed(() => (jobId.value ? store.job(jobId.value) : null))
const active = computed(() => publishActive(job.value))
const percent = computed(() => (job.value?.state === 'done' || job.value?.state === 'done_with_warning' ? 100 : job.value?.bytes_total ? Math.round((100 * (job.value.bytes_done || 0)) / job.value.bytes_total) : job.value?.files_total ? Math.round((100 * (job.value.files_done || 0)) / job.value.files_total) : 0))
async function copy(l) { try { await navigator.clipboard.writeText(l.url); copiedPath.value = l.path; setTimeout(() => { if (copiedPath.value === l.path) copiedPath.value = '' }, 2000) } catch { copiedPath.value = '' } }
</script>

<style scoped>
.tree { max-height: 45vh; overflow: auto; }
/* the destination stays on screen while the body scrolls (the backfill table is long) */
.publish-destination { position: sticky; top: 0; z-index: 5; background: var(--bs-body-bg); }
</style>
