<template>
  <div v-if="!runjobs.old && rows.length" class="mb-4" data-testid="queue-runjobs">
    <h6 class="mb-2" data-testid="queue-runjobs-title">{{ $t('queue.run.title', { n: runjobs.activeCount }) }}</h6>
    <div class="table-responsive">
      <table class="table table-sm align-middle mb-0">
        <thead><tr><th>{{ $t('queue.col.started') }}</th><th>{{ $t('queue.run.pod') }}</th><th>{{ $t('queue.run.element') }}</th><th>{{ $t('queue.col.state') }}</th><th>{{ $t('queue.col.progress') }}</th><th></th></tr></thead>
        <tbody>
          <tr v-for="j in rows" :key="j.job_id" data-testid="queue-runjob" :data-job="j.job_id" :data-state="j.state" :data-external="j.external ? 'true' : 'false'">
            <td class="small text-nowrap" :title="j.started_at">{{ when(j.started_at) }}</td>
            <td class="small text-nowrap" data-testid="queue-runjob-pod" :title="j.pod_id">{{ podLabel(j) }}</td>
            <td class="small"><strong data-testid="queue-runjob-element">{{ j.element }}</strong>
              <span v-if="j.external" class="badge text-bg-secondary fw-normal ms-1" :title="$t('queue.run.externalTip')" data-testid="queue-runjob-external">{{ j.client || $t('queue.run.external') }}</span></td>
            <td><span class="badge" :class="chip(j)" data-testid="queue-runjob-state">{{ j.state }}</span></td>
            <td class="small" style="min-width: 15rem">
              <div data-testid="queue-runjob-progress">{{ framesText(j) }}<span v-if="framesText(j) && genLine(j)"> · </span>{{ genLine(j) }}</div>
              <BProgress v-if="percentOf(j) != null" :value="percentOf(j)" :max="100" height="3px" class="mt-1" :data-percent="percentOf(j)" data-testid="queue-runjob-bar" />
              <div v-if="j.state === 'running'" class="text-body-secondary" data-testid="queue-runjob-rate">
                <span v-if="rateText(j)">{{ rateText(j) }}</span><span v-if="rateText(j) && etaText(j)"> · </span><span v-if="etaText(j)">{{ etaText(j) }}</span>
                <span v-if="liveState(j.live) === 'none'" class="ms-1" :title="j.live && j.live.reason ? j.live.reason : ''" data-testid="queue-runjob-nolive">{{ $t('queue.run.noLive') }}</span>
                <span v-else-if="liveState(j.live) === 'waiting'" class="ms-1" data-testid="queue-runjob-waiting">{{ $t('queue.run.waiting') }}</span>
              </div>
              <div v-else-if="j.error" class="text-danger" data-testid="queue-runjob-error">{{ j.error }}</div>
            </td>
            <td class="text-end text-nowrap">
              <BButton v-if="j.pod_id && !j.external" size="sm" variant="link" class="p-0 me-2" data-testid="queue-runjob-open" @click="openRun(j)">{{ $t('queue.col.open') }}</BButton>
              <BButton v-if="j.state === 'running'" size="sm" variant="outline-warning" data-testid="queue-runjob-cancel" @click="cancel(j)">{{ $t('queue.cancel') }}</BButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
/**
 * RunJobsSection: the render runs of the app and of other processes, in the Queue's Generations (Lucas, 2026-11-21: "in queue why don't i see these renderings happening", "these are generations").
 * One row per run: the pod, the element, its state, `122 of 209 frames · chunk 5 of 8 · SeedVR2 sampling 3/12 · 41%` (the last part is ComfyUI's own step events on the pod),
 * the rate and the ETA, Open (the pod's Run Workflows window) and Cancel (the same cancel as that window, asked first).
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRunJobsStore } from '../stores/runjobs'
import { useUiStore } from '../stores/ui'
import { useConfirmStore } from '../stores/confirm'
import { selectRows, podLabel, framesText, genLine, percentOf, rateText, etaText, liveState } from '../utils/runjobs'
import { whenText } from '../utils/when'
import { t } from '../i18n'

const runjobs = useRunJobsStore(), ui = useUiStore(), confirm = useConfirmStore()
const now = ref(Date.now())
const tick = setInterval(() => { now.value = Date.now() }, 1000)
onBeforeUnmount(() => clearInterval(tick))
const rows = computed(() => selectRows(runjobs.jobs))
const when = (at) => whenText(at, new Date(now.value))
const chip = (j) => (j.state === 'running' ? 'text-bg-primary' : j.state === 'done' ? 'text-bg-success' : j.state === 'cancelled' ? 'text-bg-secondary' : 'text-bg-danger')
const openRun = (j) => { ui.runFlowsFor = { pod_id: j.pod_id } }
async function cancel(j) {
  if (!(await confirm.ask(t('queue.run.confirmCancel', { element: j.element, pod: podLabel(j) }), { okLabel: t('queue.cancel') }))) return
  await runjobs.cancel(j)
}
</script>
