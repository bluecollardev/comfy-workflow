<template>
  <BModal :model-value="ui.historyOpen" :title="$t('history.title')" size="xl" lazy ok-only :ok-title="$t('history.done')" ok-variant="outline-light" data-testid="history-modal" @update:model-value="ui.historyOpen = $event" @show="load()">
    <p class="text-body-secondary small">{{ $t('history.intro') }}</p>
    <div class="d-flex justify-content-end mb-2">
      <BDropdown size="sm" variant="outline-light" right data-testid="history-export" :disabled="exporting">
        <template #button-content><i class="fa-solid fa-file-export me-1"></i>{{ $t('history.export') }}</template>
        <BDropdownItem data-testid="history-export-json" @click="doExport('json', undefined)">{{ $t('history.exportJson') }}</BDropdownItem>
        <BDropdownItem data-testid="history-export-csv-events" @click="doExport('csv', 'events')">{{ $t('history.exportCsvEvents') }}</BDropdownItem>
        <BDropdownItem data-testid="history-export-csv-spend" @click="doExport('csv', 'spend')">{{ $t('history.exportCsvSpend') }}</BDropdownItem>
      </BDropdown>
    </div>
    <BAlert v-if="error" :model-value="true" variant="danger" class="mb-3" data-testid="history-error">{{ $t('history.loadError', { error }) }}</BAlert>
    <BTabs v-model:index="tabIndex" content-class="pt-3">
      <BTab :title="$t('history.tabPods')" active data-testid="history-tab-pods">
        <div v-if="loading" class="text-body-secondary"><BSpinner small class="me-2" />{{ $t('history.loading') }}</div>
        <div v-else-if="!podEvents.length" class="text-body-secondary" data-testid="history-pods-empty">{{ $t('history.noPods') }}</div>
        <table v-else class="table table-sm align-middle" data-testid="history-pods">
          <thead><tr><th>{{ $t('history.time') }}</th><th>{{ $t('history.action') }}</th><th>{{ $t('history.pod') }}</th><th>{{ $t('history.card') }}</th><th>{{ $t('history.datacenter') }}</th></tr></thead>
          <tbody>
            <tr v-for="(e, i) in podEvents" :key="i" data-testid="history-pod-row">
              <td class="text-nowrap">{{ when(e.ts) }}</td>
              <td><BBadge :variant="ACTION[e.action] || 'secondary'" data-testid="history-action">{{ e.action }}</BBadge></td>
              <td>{{ e.name }}</td>
              <td>{{ e.gpu || '' }}</td>
              <td>{{ e.datacenter || '' }}</td>
            </tr>
          </tbody>
        </table>
      </BTab>

      <BTab :title="$t('history.tabSpend')" data-testid="history-tab-spend">
        <div v-if="!spend || (!spend.sessions.length && !spend.total)" class="text-body-secondary" data-testid="history-spend-empty">{{ $t('history.noSpend') }}</div>
        <template v-else>
          <div class="d-flex align-items-baseline gap-3 mb-3">
            <span class="text-body-secondary">{{ $t('history.total') }}</span>
            <span class="fs-4 fw-semibold" data-testid="history-total">{{ money(spend.total) }}</span>
            <BBadge :variant="spend.running_now ? 'success' : 'secondary'" data-testid="history-running-now">{{ spend.running_now ? $t('history.runningNow', { n: spend.running_now }) : $t('history.noneRunning') }}</BBadge>
          </div>
          <h6>{{ $t('history.sessions') }}</h6>
          <table class="table table-sm align-middle" data-testid="history-sessions">
            <thead><tr><th>{{ $t('history.session') }}</th><th>{{ $t('history.from') }}</th><th>{{ $t('history.to') }}</th><th class="text-end">{{ $t('history.hours') }}</th><th class="text-end">{{ $t('history.cost') }}</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in spend.sessions" :key="i" data-testid="history-session">
                <td>{{ s.name }}<small class="text-body-secondary"> · {{ s.gpu }} · {{ s.datacenter }}</small></td>
                <td class="text-nowrap">{{ when(s.from) }}</td>
                <td class="text-nowrap">{{ s.to ? when(s.to) : $t('history.stillRunning') }}</td>
                <td class="text-end">{{ Number(s.hours).toFixed(2) }}</td>
                <td class="text-end">{{ money(s.cost) }}</td>
              </tr>
            </tbody>
          </table>
          <h6>{{ $t('history.byDay') }}</h6>
          <table class="table table-sm align-middle" data-testid="history-by-day">
            <thead><tr><th>{{ $t('history.day') }}</th><th class="text-end">{{ $t('history.hours') }}</th><th class="text-end">{{ $t('history.cost') }}</th></tr></thead>
            <tbody>
              <tr v-for="d in spend.by_day" :key="d.day" data-testid="history-day"><td>{{ d.day }}</td><td class="text-end">{{ d.hours != null ? Number(d.hours).toFixed(2) : '' }}</td><td class="text-end">{{ money(d.cost) }}</td></tr>
            </tbody>
          </table>
          <p class="small text-body-secondary mb-0" data-testid="history-note">{{ spend.note }}</p>
        </template>
      </BTab>

      <BTab :title="$t('history.tabJobs')" data-testid="history-tab-jobs">
        <div v-if="!jobEvents.length" class="text-body-secondary" data-testid="history-jobs-empty">{{ $t('history.noJobs') }}</div>
        <table v-else class="table table-sm align-middle" data-testid="history-jobs">
          <thead><tr><th>{{ $t('history.time') }}</th><th>{{ $t('history.jobKind') }}</th><th>{{ $t('history.what') }}</th><th>{{ $t('history.pod') }}</th><th>{{ $t('history.state') }}</th><th>{{ $t('history.size') }}</th><th>{{ $t('history.error') }}</th></tr></thead>
          <tbody>
            <tr v-for="(e, i) in jobEvents" :key="i" data-testid="history-job-row">
              <td class="text-nowrap">{{ when(e.ts) }}</td>
              <td>{{ e.job }}</td>
              <td>{{ e.what }}</td>
              <td>{{ e.pod_name || '' }}</td>
              <td><BBadge :variant="STATE[e.state] || 'secondary'" data-testid="history-state">{{ e.state }}</BBadge></td>
              <td class="text-nowrap">{{ e.files != null ? $t('history.files', { n: e.files }) : '' }}<span v-if="e.bytes != null"> · {{ size(e.bytes) }}</span></td>
              <td class="text-danger-emphasis">{{ e.error || '' }}</td>
            </tr>
          </tbody>
        </table>
      </BTab>

      <BTab :title="$t('history.tabRuns')" data-testid="history-tab-runs">
        <div v-if="!runningPods.length" class="text-body-secondary" data-testid="history-runs-nopods">{{ $t('history.noRunningPods') }}</div>
        <template v-else>
          <div class="d-flex gap-2 align-items-end mb-3">
            <BFormGroup :label="$t('history.runsPod')" label-for="history-run-pod" class="mb-0 flex-grow-1">
              <BFormSelect id="history-run-pod" v-model="runPod" :options="runningPods.map((p) => ({ value: p.id, text: p.name }))" data-testid="history-run-pod" @update:model-value="loadRuns" />
            </BFormGroup>
            <BButton variant="primary" :disabled="runsLoading" data-testid="history-runs-refresh" @click="loadRuns"><i class="fa-solid fa-rotate me-1" :class="{ 'fa-spin': runsLoading }"></i>{{ $t('history.refresh') }}</BButton>
          </div>
          <BAlert v-if="runsError" :model-value="true" variant="danger" data-testid="history-runs-error">{{ $t('history.runsError', { error: runsError }) }}</BAlert>
          <div v-else-if="runs && !runs.length" class="text-body-secondary" data-testid="history-runs-empty">{{ $t('history.noRuns') }}</div>
          <table v-else-if="runs" class="table table-sm align-middle" data-testid="history-runs">
            <thead><tr><th>{{ $t('history.prompt') }}</th><th>{{ $t('history.status') }}</th><th>{{ $t('history.started') }}</th><th>{{ $t('history.duration') }}</th><th>{{ $t('history.outputs') }}</th></tr></thead>
            <tbody>
              <tr v-for="r in runs" :key="r.prompt_id" data-testid="history-run">
                <td><code>{{ String(r.prompt_id).slice(0, 8) }}</code></td>
                <td><BBadge :variant="RUN[r.status] || 'secondary'" data-testid="history-run-status">{{ r.status }}</BBadge><div v-if="r.error" class="small text-danger-emphasis">{{ r.error }}</div></td>
                <td class="text-nowrap">{{ when(r.started_at) }}</td>
                <td>{{ r.duration_s != null ? `${Number(r.duration_s).toFixed(1)} s` : '' }}</td>
                <td><div v-for="(o, i) in r.outputs || []" :key="i" class="small"><code>{{ o.subfolder ? `${o.subfolder}/` : '' }}{{ o.filename }}</code></div></td>
              </tr>
            </tbody>
          </table>
        </template>
      </BTab>
    </BTabs>
  </BModal>
</template>

<script setup>
/**
 * HistoryModal — what happened: pod events, spend, jobs (pull/sync/remove) and the ComfyUI runs of a running pod.
 * The first three come from the core's history store; the runs are read live from the chosen pod.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useUiStore } from '../stores/ui'
import { usePodsStore } from '../stores/pods'
import { historyAPI, onHistoryChange } from '../api/history'
import { saveTextFile } from '../api/configio'

const ui = useUiStore()
const pods = usePodsStore()
const ACTION = { created: 'success', started: 'success', stopped: 'secondary', recreated: 'info', renamed: 'info', deleted: 'danger' }
const STATE = { done: 'success', failed: 'danger', cancelled: 'secondary' }
const RUN = { success: 'success', error: 'danger', running: 'primary', pending: 'secondary' }

const tabIndex = ref(0)
watch(tabIndex, (i) => { if (i === 3) loadRuns() })
const events = ref([])
const spend = ref(null)
const loading = ref(false)
const error = ref('')
const runPod = ref('')
const runs = ref(null)
const runsLoading = ref(false)
const runsError = ref('')

const podEvents = computed(() => events.value.filter((e) => e.kind === 'pod'))
const jobEvents = computed(() => events.value.filter((e) => e.kind === 'job'))
const runningPods = computed(() => pods.pods.filter((p) => p.status === 'running'))

const msg = (e) => e?.response?.data?.detail || e?.message || String(e)
const when = (ts) => (ts ? new Date(ts).toLocaleString() : '')
const money = (n) => `$${Number(n || 0).toFixed(2)}`
const size = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`)

/** Updates by itself while the window is open: the app pushes each change (a poll where it cannot). The ComfyUI runs live on the pod, so that tab asks again every 5 seconds. */
let stopWatch = null, runsTimer = null
const live = () => { if (!stopWatch) stopWatch = onHistoryChange(() => load(true)) }
const unlive = () => { stopWatch?.(); stopWatch = null }
watch(() => ui.historyOpen, (open) => { if (open) live(); else unlive() }, { immediate: true })
watch([() => ui.historyOpen, tabIndex, runPod], () => { clearInterval(runsTimer); runsTimer = null; if (ui.historyOpen && tabIndex.value === 3 && runPod.value) runsTimer = setInterval(() => loadRuns(true), 5000) })
onBeforeUnmount(() => { unlive(); clearInterval(runsTimer) })
async function load(quiet = false) {
  if (!quiet) loading.value = true
  error.value = ''
  try {
    const [ev, sp] = await Promise.all([historyAPI.list(undefined, 500), historyAPI.spend()])
    events.value = ev || []; spend.value = sp
  } catch (e) { error.value = msg(e) } finally { loading.value = false }
  if (!runPod.value || !runningPods.value.some((p) => p.id === runPod.value)) runPod.value = runningPods.value[0]?.id || ''
}
const exporting = ref(false)
async function doExport(format, what) {
  exporting.value = true; error.value = ''
  try { const f = await historyAPI.export(format, what); await saveTextFile(f.name, f.text) } catch (e) { error.value = msg(e) } finally { exporting.value = false }
}
async function loadRuns(quiet = false) {
  if (!quiet) runs.value = null
  runsError.value = ''
  if (!runPod.value) runPod.value = runningPods.value[0]?.id || ''
  if (!runPod.value) return
  if (!quiet) runsLoading.value = true
  try { runs.value = (await historyAPI.runs(runPod.value)) || [] } catch (e) { runsError.value = msg(e) } finally { runsLoading.value = false }
}
</script>
