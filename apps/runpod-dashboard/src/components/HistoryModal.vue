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
          <thead><tr><th>{{ $t('history.time') }}</th><th>{{ $t('history.action') }}</th><th>{{ $t('history.pod') }}</th><th>{{ $t('history.card') }}</th><th>{{ $t('history.datacenter') }}</th><th>{{ $t('history.via') }}</th></tr></thead>
          <tbody>
            <tr v-for="(e, i) in podEvents" :key="i" data-testid="history-pod-row">
              <td class="text-nowrap">{{ when(e.ts) }}</td>
              <td><BBadge :variant="ACTION[e.action] || 'secondary'" data-testid="history-action">{{ e.action }}</BBadge></td>
              <td class="history-wrap">{{ e.name }}</td>
              <td>{{ e.gpu || '' }}</td>
              <td>{{ e.datacenter || '' }}</td>
              <td><BBadge v-if="e.source === 'mcp'" variant="info" :title="viaTitle(e)" data-testid="history-via-mcp">{{ $t('history.viaMcp') }}</BBadge><span v-else class="text-body-secondary small" data-testid="history-via-app">{{ $t('history.viaApp') }}</span></td>
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
                <td class="history-wrap">{{ s.name }}<small class="text-body-secondary"> · {{ s.gpu }} · {{ s.datacenter }}</small></td>
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
        <template v-else>
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2" data-testid="history-jobs-filters">
          <BFormSelect v-model="jobKind" size="sm" class="w-auto" :aria-label="$t('history.filterKind')" :options="jobKindOptions" data-testid="history-jobs-kind" />
          <BFormSelect v-model="jobState" size="sm" class="w-auto" :aria-label="$t('history.filterState')" :options="[{ value: '', text: $t('history.anyState') }, { value: 'done', text: $t('history.stateDone') }, { value: 'failed', text: $t('history.stateFailed') }, { value: 'cancelled', text: $t('history.stateCancelled') }]" data-testid="history-jobs-state" />
          <BFormSelect v-model="jobVia" size="sm" class="w-auto" :aria-label="$t('history.filterVia')" :options="[{ value: '', text: $t('history.anyVia') }, { value: 'app', text: $t('history.viaApp') }, { value: 'mcp', text: $t('history.viaMcp') }]" data-testid="history-jobs-via" />
          <div class="input-group input-group-sm w-auto">
            <input v-model="jobText" type="text" class="form-control" :placeholder="$t('history.filterText')" :aria-label="$t('history.filterText')" data-testid="history-jobs-text" @keydown.esc="jobText = ''" />
            <button v-if="jobText" type="button" class="btn btn-outline-secondary" :title="$t('history.filterClear')" :aria-label="$t('history.filterClear')" data-testid="history-jobs-text-clear" @click="jobText = ''"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <BFormCheckbox v-model="showConfig" switch class="small mb-0" data-testid="history-jobs-show-config">{{ $t('history.showConfig', { n: configCount }) }}</BFormCheckbox>
          <BButton v-if="jobsFiltered" size="sm" variant="outline-secondary" data-testid="history-jobs-clear" @click="clearJobFilters">{{ $t('history.clearFilters') }}</BButton>
          <span class="small text-body-secondary ms-auto" data-testid="history-jobs-count">{{ $t('history.filterCount', { n: shownJobs.length, of: jobEvents.length - (showConfig ? 0 : configCount) }) }}</span>
        </div>
        <div v-if="!shownJobs.length" class="text-body-secondary" data-testid="history-jobs-nomatch">{{ $t('history.noMatch') }}</div>
        <table v-else class="table table-sm align-middle" data-testid="history-jobs">
          <thead><tr><th>{{ $t('history.time') }}</th><th>{{ $t('history.jobKind') }}</th><th>{{ $t('history.what') }}</th><th>{{ $t('history.pod') }}</th><th>{{ $t('history.state') }}</th><th>{{ $t('history.size') }}</th><th>{{ $t('history.error') }}</th><th>{{ $t('history.via') }}</th></tr></thead>
          <tbody>
            <tr v-for="(e, i) in shownJobs" :key="i" :data-testid="e.kind === 'change' ? 'history-change-row' : 'history-job-row'">
              <td class="text-nowrap">{{ when(e.ts) }}</td>
              <td v-if="e.kind === 'change'"><BBadge variant="warning" data-testid="history-change-area">{{ $t(`history.area_${e.area}`) }}</BBadge></td>
              <td v-else>{{ e.job }}</td>
              <td v-if="e.kind === 'change'" class="history-wrap"><span data-testid="history-change-action">{{ e.action }}</span> {{ e.what }}<div v-if="e.detail" class="small text-body-secondary">{{ e.detail }}</div></td>
              <td v-else class="history-wrap">{{ e.what }}</td>
              <td class="history-wrap">{{ e.pod_name || '' }}</td>
              <td><BBadge :variant="STATE[e.state] || 'secondary'" data-testid="history-state">{{ e.state }}</BBadge></td>
              <td class="text-nowrap">{{ e.files != null ? $t('history.files', { n: e.files }) : '' }}<span v-if="e.bytes != null"> · {{ size(e.bytes) }}</span></td>
              <td class="text-danger-emphasis history-wrap">{{ e.error || '' }}</td>
              <td><BBadge v-if="e.source === 'mcp'" variant="info" :title="viaTitle(e)" data-testid="history-via-mcp">{{ $t('history.viaMcp') }}</BBadge><span v-else class="text-body-secondary small" data-testid="history-via-app">{{ $t('history.viaApp') }}</span></td>
            </tr>
          </tbody>
        </table>
        </template>
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
          <template v-else-if="runs"><div class="small text-body-secondary mb-2" data-testid="history-runs-total">{{ $t('history.runsTotal', { n: runs.length, min: runsMinutes, cost: runCost(runsCost) }) }}</div>
          <table class="table table-sm align-middle" data-testid="history-runs">
            <thead><tr><th>{{ $t('history.prompt') }}</th><th>{{ $t('history.status') }}</th><th>{{ $t('history.started') }}</th><th>{{ $t('history.duration') }}</th><th>{{ $t('history.outputs') }}</th><th class="text-end">{{ $t('history.cost') }}</th></tr></thead>
            <tbody>
              <template v-for="r in runs" :key="r.prompt_id">
                <tr role="button" class="history-run-row" data-testid="history-run" @click="toggleRun(r.prompt_id)">
                  <td><i class="fa-solid me-2 small text-body-secondary" :class="open.has(r.prompt_id) ? 'fa-chevron-down' : 'fa-chevron-right'"></i><code>{{ String(r.prompt_id).slice(0, 8) }}</code></td>
                  <td class="history-wrap"><BBadge :variant="RUN[r.status] || 'secondary'" data-testid="history-run-status">{{ r.status }}</BBadge><div v-if="r.error" class="small text-danger-emphasis">{{ r.error }}</div></td>
                  <td class="text-nowrap">{{ when(r.started_at) }}</td>
                  <td>{{ r.duration_s != null ? `${Number(r.duration_s).toFixed(1)} s` : '' }}</td>
                  <td class="history-wrap"><div v-for="(o, i) in r.outputs || []" :key="i" class="small"><code>{{ o.subfolder ? `${o.subfolder}/` : '' }}{{ o.filename }}</code></div></td>
                  <td class="text-end text-nowrap" :title="$t('history.costTitle')" data-testid="history-run-cost">{{ runCost(r.cost_estimate) }}</td>
                </tr>
                <tr v-if="open.has(r.prompt_id)" data-testid="history-run-detail">
                  <td colspan="6" class="bg-body-tertiary">
                    <div class="small mb-2" data-testid="history-run-detail-cost"><strong>{{ $t('history.runCost') }}</strong> {{ runCost(r.cost_estimate) }}</div>
                    <div v-if="r.error_detail" class="mb-3" data-testid="history-run-error-detail">
                      <div class="d-flex align-items-center gap-2 mb-1">
                        <strong class="text-danger-emphasis">{{ $t('history.runError') }}</strong>
                        <span data-testid="history-run-error-message">{{ r.error_detail.message }}</span>
                        <BButton v-if="r.error_detail.traceback?.length" size="sm" variant="secondary" class="ms-auto" data-testid="history-run-copy" @click="copy(r.error_detail.traceback.join('\n'))"><i class="fa-regular fa-copy me-1"></i>{{ $t('history.copy') }}</BButton>
                      </div>
                      <div class="small text-body-secondary">
                        <span v-if="r.error_detail.node_type || r.error_detail.node_id" class="me-3" data-testid="history-run-node">{{ $t('history.runNode', { type: r.error_detail.node_type || '?', id: r.error_detail.node_id ?? '?' }) }}</span>
                        <span v-if="r.error_detail.exception_type" data-testid="history-run-exception">{{ $t('history.runException', { type: r.error_detail.exception_type }) }}</span>
                      </div>
                      <pre v-if="r.error_detail.traceback?.length" class="history-mono border rounded p-2 mt-2 mb-0 small" style="max-height: 14rem; overflow: auto" data-testid="history-run-traceback">{{ r.error_detail.traceback.join('\n') }}</pre>
                    </div>
                    <div class="mb-2">
                      <strong>{{ $t('history.runMessages') }}</strong>
                      <div v-if="!r.messages?.length" class="small text-body-secondary" data-testid="history-run-no-messages">{{ $t('history.runNoMessages') }}</div>
                      <div v-for="(m, i) in r.messages || []" :key="i" class="d-flex align-items-baseline gap-2 small mt-1" data-testid="history-run-message">
                        <BBadge :variant="m.type === 'execution_error' ? 'danger' : m.type === 'execution_success' ? 'success' : 'secondary'">{{ m.type }}</BBadge>
                        <span class="text-nowrap text-body-secondary">{{ m.ts ? new Date(m.ts).toLocaleTimeString() : '' }}</span>
                        <code class="text-body-secondary text-truncate">{{ short(m.data) }}</code>
                      </div>
                    </div>
                    <div>
                      <strong>{{ $t('history.outputs') }}</strong>
                      <div v-if="!r.outputs?.length" class="small text-body-secondary">{{ $t('history.runNoOutputs') }}</div>
                      <div v-for="(o, i) in r.outputs || []" :key="i" class="small"><code>{{ o.subfolder ? `${o.subfolder}/` : '' }}{{ o.filename }}</code></div>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table></template>

          <div class="border rounded p-2" data-testid="history-comfy-log">
            <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
              <h6 class="mb-0">{{ $t('history.logTitle') }}</h6>
              <BBadge v-if="logErrors" variant="danger" data-testid="history-log-errors">{{ $t('history.logErrorCount', { n: logErrors }) }}</BBadge>
              <BFormSelect v-model="logLevel" size="sm" class="w-auto ms-auto" :aria-label="$t('history.logLevel')" :options="[{ value: 'all', text: $t('history.logAll') }, { value: 'warning', text: $t('history.logWarnings') }, { value: 'error', text: $t('history.logErrors') }]" data-testid="history-log-level" @update:model-value="loadLog()" />
              <BFormInput v-model="logText" size="sm" class="w-auto" :placeholder="$t('history.logFilter')" data-testid="history-log-text" />
              <BFormCheckbox v-model="logAuto" switch class="text-nowrap" data-testid="history-log-auto">{{ $t('history.logAuto') }}</BFormCheckbox>
              <BButton size="sm" variant="secondary" :disabled="logLoading" data-testid="history-log-refresh" @click="loadLog()"><i class="fa-solid fa-rotate me-1" :class="{ 'fa-spin': logLoading }"></i>{{ $t('history.refresh') }}</BButton>
              <BButton size="sm" variant="secondary" :disabled="!shownLog.length" data-testid="history-log-copy" @click="copy(shownLog.map(logLine).join('\n'))"><i class="fa-regular fa-copy me-1"></i>{{ $t('history.copyAll') }}</BButton>
            </div>
            <BAlert v-if="logError" :model-value="true" variant="danger" class="mb-0" data-testid="history-log-error">{{ $t('history.logError', { error: logError }) }}</BAlert>
            <div v-else-if="logLoaded && !shownLog.length" class="text-body-secondary small" data-testid="history-log-empty">{{ $t('history.logEmpty') }}</div>
            <div v-else ref="logBox" class="history-mono small" style="max-height: 16rem; overflow: auto" data-testid="history-log-lines" @scroll="onLogScroll">
              <div v-if="logTruncated" class="text-body-secondary">{{ $t('history.logTruncated') }}</div>
              <div v-for="(l, i) in shownLog" :key="i" class="d-flex gap-2 align-items-baseline" data-testid="history-log-line" :data-level="l.level">
                <span class="text-nowrap text-body-secondary">{{ l.ts ? new Date(l.ts).toLocaleTimeString() : '' }}</span>
                <BBadge :variant="LOG[l.level] || 'secondary'" data-testid="history-log-badge">{{ l.level }}</BBadge>
                <span :class="LOGTEXT[l.level]" style="white-space: pre-wrap; overflow-wrap: anywhere">{{ l.text }}</span>
              </div>
            </div>
          </div>
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
import { t } from '../i18n'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useUiStore } from '../stores/ui'
import { usePodsStore } from '../stores/pods'
import { historyAPI, onHistoryChange } from '../api/history'
import { saveTextFile } from '../api/configio'
import { useToastStore } from '../stores/toast'

const ui = useUiStore()
const toast = useToastStore()
const pods = usePodsStore()
const ACTION = { created: 'success', started: 'success', stopped: 'secondary', recreated: 'info', renamed: 'info', deleted: 'danger' }
const STATE = { done: 'success', failed: 'danger', cancelled: 'secondary' }
const RUN = { success: 'success', error: 'danger', running: 'primary', pending: 'secondary' }

const LOG = { error: 'danger', warning: 'warning', info: 'secondary' }
const LOGTEXT = { error: 'text-danger', warning: 'text-warning', info: 'text-body-secondary' }

const tabIndex = ref(0)
watch(tabIndex, (i) => { if (i === 3) { loadRuns(); loadLog() } })
const events = ref([])
const spend = ref(null)
const loading = ref(false)
const error = ref('')
const runPod = ref('')
const runs = ref(null)
const runsLoading = ref(false)
const runsError = ref('')
const open = ref(new Set())           // prompt ids of the expanded runs
const logLevel = ref('all')
const logText = ref('')
const logAuto = ref(true)
const logEntries = ref([])
const logTruncated = ref(false)
const logLoaded = ref(false)
const logLoading = ref(false)
const logError = ref('')
const logBox = ref(null)
let pinned = true                     // follow the newest line unless the user scrolled up

const podEvents = computed(() => events.value.filter((e) => e.kind === 'pod'))
/** The filters of Jobs & Changes: kind (a job kind, a change area, or just jobs / changes), state (jobs only), where it came from, and a text found in what, pod, detail, error or tool. */
const jobKind = ref('')
const jobState = ref('')
const jobVia = ref('')
const jobText = ref('')
const jobKindOptions = computed(() => [{ value: '', text: t('history.anyKind') }, { value: 'jobs', text: t('history.kindJobs') }, { value: 'changes', text: t('history.kindChanges') }, ...['pull', 'sync', 'remove'].map((k) => ({ value: `job:${k}`, text: k })), ...['volume', 'configuration', 'import', 'adapter'].map((a) => ({ value: `area:${a}`, text: t(`history.area_${a}`) }))])
/** Configuration saves are frequent and rarely the point: hidden unless asked for (the switch, or the Configuration kind picked). Remembered. */
const showConfig = ref(localStorage.getItem('history.showConfig') === '1')
watch(showConfig, (v) => localStorage.setItem('history.showConfig', v ? '1' : '0'))
const configCount = computed(() => events.value.filter((e) => e.kind === 'change' && e.area === 'configuration').length)
const jobsFiltered = computed(() => !!(jobKind.value || jobState.value || jobVia.value || jobText.value.trim()))
const clearJobFilters = () => { jobKind.value = ''; jobState.value = ''; jobVia.value = ''; jobText.value = '' }
const shownJobs = computed(() => {
  const q = jobText.value.trim().toLowerCase()
  const k = jobKind.value
  return jobEvents.value.filter((e) => {
    if (e.kind === 'change' && e.area === 'configuration' && !showConfig.value && k !== 'area:configuration') return false
    if (k === 'jobs' && e.kind !== 'job') return false
    if (k === 'changes' && e.kind !== 'change') return false
    if (k.startsWith('job:') && !(e.kind === 'job' && e.job === k.slice(4))) return false
    if (k.startsWith('area:') && !(e.kind === 'change' && e.area === k.slice(5))) return false
    if (jobState.value && !(e.kind === 'job' && e.state === jobState.value)) return false   // a change has no state: a state filter is about jobs
    if (jobVia.value && (e.source || 'app') !== jobVia.value) return false
    return !q || [e.what, e.pod_name, e.detail, e.error, e.action, e.tool, e.job, e.area, e.approved_by].some((x) => x && String(x).toLowerCase().includes(q))
  })
})
const jobEvents = computed(() => events.value.filter((e) => e.kind === 'job' || e.kind === 'change').sort((a, b) => String(b.ts).localeCompare(String(a.ts))))
const runningPods = computed(() => pods.pods.filter((p) => p.status === 'running'))
const shownLog = computed(() => {
  const q = logText.value.trim().toLowerCase()
  const keep = logLevel.value === 'error' ? ['error'] : logLevel.value === 'warning' ? ['warning', 'error'] : null
  return logEntries.value.filter((l) => (!keep || keep.includes(l.level)) && (!q || String(l.text).toLowerCase().includes(q)))
})
const runsMinutes = computed(() => Math.round((runs.value || []).reduce((a, r) => a + (Number(r.duration_s) || 0), 0) / 6) / 10)
const runsCost = computed(() => (runs.value || []).reduce((a, r) => a + (r.cost_estimate != null ? Number(r.cost_estimate) : 0), 0))
const logErrors = computed(() => logEntries.value.filter((l) => l.level === 'error').length)

const msg = (e) => e?.response?.data?.detail || e?.message || String(e)
const runCost = (c) => (c == null ? '—' : Number(c) > 0 && Number(c) < 0.0001 ? '<$0.0001' : `$${Number(c).toFixed(Math.abs(c) < 0.01 ? 4 : 2)}`)
const viaTitle = (e) => (e.approved_by ? t('history.viaMcpTitle', { tool: e.tool || '?', who: e.approved_by }) : t('history.viaMcpNoApprover', { tool: e.tool || '?' }))
const short = (d) => { const j = typeof d === 'string' ? d : JSON.stringify(d ?? {}); return j.length > 160 ? `${j.slice(0, 160)}…` : j }
const logLine = (l) => `${l.ts || ''} ${String(l.level).toUpperCase()} ${l.text}`.trim()
const toggleRun = (id) => { const n = new Set(open.value); if (n.has(id)) n.delete(id); else n.add(id); open.value = n }
async function copy(text) { try { await navigator.clipboard.writeText(text); toast.info(t('history.copied')) } catch { /* clipboard blocked: the text is still on screen */ } }
const when = (ts) => (ts ? new Date(ts).toLocaleString() : '')
const money = (n) => `$${Number(n || 0).toFixed(2)}`
const size = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`)

/** Updates by itself while the window is open: the app pushes each change (a poll where it cannot). The ComfyUI runs live on the pod, so that tab asks again every 5 seconds. */
let stopWatch = null, runsTimer = null
const live = () => { if (!stopWatch) stopWatch = onHistoryChange(() => load(true)) }
const unlive = () => { stopWatch?.(); stopWatch = null }
watch(() => ui.historyOpen, (open) => { if (open) live(); else unlive() }, { immediate: true })
watch([() => ui.historyOpen, tabIndex, runPod, logAuto], () => { clearInterval(runsTimer); runsTimer = null; if (ui.historyOpen && tabIndex.value === 3 && runPod.value) runsTimer = setInterval(() => { loadRuns(true); if (logAuto.value) loadLog(true) }, 5000) })
watch(runPod, () => { logEntries.value = []; logLoaded.value = false; logError.value = ''; if (tabIndex.value === 3) loadLog() })
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
const onLogScroll = () => { const b = logBox.value; if (b) pinned = b.scrollHeight - b.scrollTop - b.clientHeight < 24 }
async function loadLog(quiet = false) {
  if (!runPod.value) return
  if (!quiet) logLoading.value = true
  try {
    const r = await historyAPI.logs(runPod.value, logLevel.value, 500)
    logEntries.value = r?.entries || []; logTruncated.value = !!r?.truncated; logError.value = ''
    await nextTick()
    if (pinned && logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
  } catch (e) { logError.value = msg(e) } finally { logLoading.value = false; logLoaded.value = true }
}
</script>

<style scoped>
.history-mono { font-family: var(--bs-font-monospace); }
.history-run-row { cursor: pointer; }
/* Free text (names, what, errors, file names) wraps at any point instead of pushing the table wider than the window. */
.history-wrap { white-space: normal; overflow-wrap: anywhere; word-break: break-word; min-width: 7rem; max-width: 26rem; }
</style>
