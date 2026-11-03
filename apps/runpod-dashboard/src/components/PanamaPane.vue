<template>
  <div data-testid="panama-pane">
    <p class="text-body-secondary small">{{ $t('panama.intro', { bucket: store.status?.bucket, via: store.status?.via === 'aws profile' ? $t('panama.viaProfile', { profile: store.status?.profile }) : $t('panama.viaKeys') }) }}</p>
    <BAlert v-if="store.error" :model-value="true" variant="danger" dismissible class="mb-3" data-testid="panama-error" @update:model-value="store.error = null">{{ store.error }}</BAlert>

    <!-- Where a round is staged (docs/ADR-022): on this PC, or on the network volume by a pod. Pod is off until the core says it can. -->
    <div class="d-flex align-items-center gap-3 mb-2 flex-wrap" data-testid="panama-target">
      <BFormRadioGroup :model-value="store.target" buttons button-variant="outline-light" size="sm" name="panama-target" @update:model-value="store.setTarget">
        <BFormRadio value="local" data-testid="panama-target-local"><i class="fa-solid fa-laptop me-1"></i>{{ $t('panama.targetLocal') }}</BFormRadio>
        <span :title="podAvailable ? '' : podReason" data-testid="panama-target-pod-wrap">
          <BFormRadio value="pod" :disabled="!podAvailable" data-testid="panama-target-pod"><i class="fa-solid fa-cloud me-1"></i>{{ $t('panama.targetPod') }}</BFormRadio>
        </span>
      </BFormRadioGroup>
      <div class="small" data-testid="panama-staging">
        <span class="text-body-secondary">{{ $t(store.target === 'pod' ? 'panama.stagingPod' : 'panama.staging') }}</span>
        <code class="ms-1" data-testid="panama-staging-path">{{ store.target === 'pod' ? '/workspace/comfy-shared/temp/rounds' : store.status?.staging }}</code>
        <span v-if="store.target === 'pod' && store.podView.volume" class="text-body-secondary ms-1" data-testid="panama-volume">{{ $t('panama.onVolume', { name: store.podView.volume.name }) }}</span>
        <span v-if="store.target === 'pod'" class="text-body-secondary ms-2" data-testid="panama-as-of">{{ store.podView.as_of ? $t('panama.asOf', { when: new Date(store.podView.as_of).toLocaleString() }) : $t('panama.neverRead') }}</span>
      </div>
    </div>
    <div v-if="store.target === 'pod'" class="small text-body-secondary mb-2" data-testid="panama-pod-note"><i class="fa-solid fa-circle-info me-1"></i>{{ $t('panama.podNote') }}</div>

    <div v-if="store.loading" class="text-body-secondary small" data-testid="panama-loading"><BSpinner small class="me-2" />{{ $t('panama.loading') }}</div>
    <div v-else-if="!store.rows.length" class="small text-body-secondary" data-testid="panama-none">{{ $t('panama.none') }}</div>
    <div v-for="r in store.rows" :key="r.name" class="d-flex align-items-center gap-2 py-1 border-bottom" data-testid="panama-round" :data-round="r.name">
      <code class="flex-grow-1">{{ r.name }}</code>
      <BBadge v-if="r.state === 'complete'" variant="success" class="fw-normal" data-testid="panama-staged">{{ $t('panama.staged') }}</BBadge>
      <BBadge v-else-if="r.state === 'partial'" variant="warning" class="fw-normal" :title="r.missing != null ? $t('panama.missingHint', { n: r.missing }) : ''" data-testid="panama-partial">{{ r.expected != null ? $t('panama.stagedPartial', { present: r.present, expected: r.expected }) : $t('panama.stagedPartialUnknown', { present: r.present }) }}</BBadge>
      <BBadge v-else-if="r.state === 'unverified'" variant="info" class="fw-normal" data-testid="panama-unverified">{{ $t('panama.stagedUnverified') }}</BBadge>
      <span v-if="r.bytes" class="small text-body-secondary" :title="$t(store.target === 'pod' ? 'panama.onVolumeHint' : 'panama.onDiskHint')" data-testid="panama-on-disk">{{ $t(store.target === 'pod' ? 'panama.onVolumeSize' : 'panama.onDisk', { size: size(r.bytes) }) }}</span>
      <span v-if="store.sizes[r.name]" class="small text-body-secondary" data-testid="panama-size">{{ $t('panama.sizeLine', { files: store.sizes[r.name].files, size: size(store.sizes[r.name].bytes) }) }}</span>
      <BButton v-else size="sm" variant="outline-light" class="text-nowrap" data-testid="panama-size-btn" @click="store.loadSize(r.name)">{{ $t('panama.size') }}</BButton>
      <BButton size="sm" variant="primary" class="text-nowrap" :disabled="busy" data-testid="panama-pull" @click="store.pull(r.name)"><i class="fa-solid fa-cloud-arrow-down me-1"></i>{{ r.state === 'partial' ? $t('panama.resume') : r.state === 'none' || !r.state ? $t('panama.download') : $t('panama.again') }}</BButton>
      <BButton v-if="r.staged && store.target === 'local'" size="sm" variant="success" class="text-nowrap" data-testid="panama-use" @click="use(r.name)">{{ $t('panama.use') }}</BButton>
      <span v-else-if="r.staged" class="small text-body-secondary text-nowrap" data-testid="panama-use-local-note">{{ $t('panama.importLocalNote') }}</span>
      <BButton v-if="r.state !== 'none' && store.removing !== r.name" size="sm" variant="outline-danger" class="text-nowrap" :disabled="busy" :title="$t(store.target === 'pod' ? 'panama.deleteHintPod' : 'panama.deleteHint')" data-testid="panama-delete" @click="store.askRemove(r.name)"><i class="fa-regular fa-trash-can me-1"></i>{{ $t('panama.delete') }}</BButton>
    </div>

    <!-- Pod download: asked first, because it uses a pod or starts one (ADR-022 decision 2, 2c, 2d) -->
    <div v-if="store.confirming" class="alert alert-warning d-flex align-items-center gap-2 mt-2 mb-0 py-2 small" data-testid="panama-pod-confirm">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span class="flex-grow-1" data-testid="panama-pod-confirm-text">{{ planText(store.confirming.plan, 'pull') }}</span>
      <BButton size="sm" variant="warning" data-testid="panama-pod-start" @click="store.confirmStart()">{{ $t('panama.podStart') }}</BButton>
      <BButton size="sm" variant="outline-light" data-testid="panama-pod-cancel" @click="store.cancelConfirm()">{{ $t('panama.deleteNo') }}</BButton>
    </div>

    <div v-if="store.removing" class="alert alert-danger d-flex align-items-center gap-2 mt-2 mb-0 py-2 small" data-testid="panama-delete-confirm">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span v-if="store.target === 'pod' && store.removePlan" class="flex-grow-1" data-testid="panama-delete-confirm-text">{{ $t('panama.deleteConfirmPod', { round: store.removing, volume: store.removePlan.volume?.name || '', size: size(store.rows.find((x) => x.name === store.removing)?.bytes || 0) }) }} {{ planText(store.removePlan, 'remove') }}</span>
      <span v-else class="flex-grow-1" data-testid="panama-delete-confirm-text">{{ $t('panama.deleteConfirm', { round: store.removing, size: size(store.rows.find((x) => x.name === store.removing)?.bytes || 0) }) }}</span>
      <BButton size="sm" variant="danger" data-testid="panama-delete-yes" @click="store.remove(store.removing)">{{ $t(store.target === 'pod' ? 'panama.deleteYesPod' : 'panama.deleteYes') }}</BButton>
      <BButton size="sm" variant="outline-light" data-testid="panama-delete-no" @click="store.cancelRemove()">{{ $t('panama.deleteNo') }}</BButton>
    </div>

    <div v-if="store.job" class="card mt-3" data-testid="panama-job">
      <div class="card-body small">
        <div class="d-flex align-items-center gap-2" data-testid="panama-job-header">
          <strong>{{ store.job.round }}</strong>
          <BBadge :variant="{ failed: 'danger', done: 'success', cancelled: 'warning' }[store.job.state] || 'info'" class="fw-normal" data-testid="panama-job-state">{{ $t(`panama.state.${store.job.state}`) }}</BBadge>
          <span v-if="isPodJob" class="text-body-secondary" data-testid="panama-job-pod">
            {{ store.job.route === 'active' ? $t('panama.podOnYours', { name: store.job.pod_name || '' }) : store.job.pod_name || '' }}
            <BBadge v-if="store.job.route === 'temporary'" variant="secondary" class="fw-normal ms-1" data-testid="panama-job-temporary">{{ $t('panama.temporary') }}</BBadge>
          </span>
          <span v-if="store.job.kind !== 'remove'" class="text-body-secondary" data-testid="panama-job-files">{{ $t('panama.files', { n: store.job.files }) }}</span>
          <BButton v-if="store.jobActive && (isPodJob || store.job.state === 'running')" size="sm" variant="outline-danger" class="ms-auto text-nowrap" data-testid="panama-cancel" @click="store.cancel()"><i class="fa-solid fa-xmark me-1"></i>{{ $t('panama.cancel') }}</BButton>
        </div>
        <div v-if="showBar" data-testid="panama-progress">
          <BProgress :value="barPct" :max="100" height="8px" :variant="barVariant" :striped="barMoving" :animated="barMoving" class="mt-2 mb-1" data-testid="panama-bar" :data-indeterminate="indeterminate ? 'true' : 'false'" />
          <div class="text-body-secondary" data-testid="panama-progress-detail">{{ detail }}</div>
        </div>
        <div v-if="store.job.recent?.length" ref="fileList" class="small font-monospace bg-body-tertiary rounded p-2 mt-2" style="max-height: 30vh; overflow: auto" data-testid="panama-files">
          <div v-for="(f, n) in store.job.recent" :key="n" class="text-break" data-testid="panama-file"><i class="fa-solid fa-check text-success me-1"></i>{{ f }}</div>
        </div>
        <div v-if="store.job.error" class="text-danger mt-1" data-testid="panama-job-error">{{ store.job.error }}</div>
        <pre v-if="store.job.lines?.length" class="mb-0 mt-2 small text-body-secondary">{{ store.job.lines.slice(-4).join('\n') }}</pre>
        <div v-if="store.job.state === 'cancelled'" class="text-body-secondary mt-1" data-testid="panama-job-cancelled">{{ $t(isPodJob ? 'panama.cancelledNotePod' : 'panama.cancelledNote') }}</div>
        <BButton v-if="store.job.state === 'done' && !isPodJob && store.job.kind !== 'remove'" size="sm" variant="success" class="mt-2" data-testid="panama-continue" @click="use(store.job.round)">{{ $t('panama.use') }}</BButton>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * PanamaPane — the "Panama S3" source of Import Shot Pack (docs/ADR-015, ADR-016, ADR-022): list the rounds in the exchange bucket, download one,
 * and then hand the staged folder to the ordinary folder import (adapter, plan, Import). A Local | Pod switch says where a round is staged: in
 * ComfyUI-Shared/temp/rounds on this PC, or on the network volume by a pod (the pod is planned and confirmed first, and shows in the pod list).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { formatBytes } from '../sync-progress'
import { usePanamaStore } from '../stores/panama'
import { useImportsStore } from '../stores/imports'
import { useUiStore } from '../stores/ui'
import { t } from '../i18n'

const store = usePanamaStore()
const imports = useImportsStore()
const ui = useUiStore()
const busy = computed(() => store.jobActive)
const podAvailable = computed(() => store.podAvailable)
const podReason = computed(() => store.status?.pod?.reason || t('panama.podUnavailable'))
const isPodJob = computed(() => store.job?.route !== undefined && store.job?.route !== null)
const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`)
/** What a Pod download or delete would do, in words: a pod of yours, or a short-lived one that is named, priced, deleted after and stopped by the idle timer. */
const planText = (p, kind) => {
  if (!p) return ''
  if (p.route === 'active') return t('panama.planActive', { name: p.pod?.name || '' })
  return t(kind === 'remove' ? 'panama.planTemporaryRemove' : 'panama.planTemporary', {
    gpu: p.gpu || '', price: p.price_per_hour != null ? p.price_per_hour.toFixed(2) : '?', volume: p.volume?.name || '', size: size(p.bytes || 0), minutes: p.idle_stop_minutes,
  })
}
/** The staged round becomes the folder of the ordinary import, and the pane switches to it. */
const use = (round) => {
  imports.folder = `${store.status.staging}/${round}`
  ui.importSource = 'folder'
  imports.makePlan(false)
}

// The download's bar and live file list, read from aws's and rclone's own output in the core, the same look as the Sync window.
const fileList = ref(null)
const TERMINAL = ['done', 'failed', 'cancelled']
const showBar = computed(() => !!store.job && store.job.kind !== 'remove')
const total = computed(() => store.job?.bytes_total || 0)
const indeterminate = computed(() => !!store.job && !TERMINAL.includes(store.job.state) && (!total.value || ['creating', 'starting'].includes(store.job.state)))
const barPct = computed(() => {
  const j = store.job
  if (!j) return 0
  if (j.state === 'done' || indeterminate.value) return 100
  return Math.min(100, Math.round((j.bytes_done / total.value) * 100))
})
const barMoving = computed(() => !!store.job && !TERMINAL.includes(store.job.state))
const barVariant = computed(() => ({ failed: 'danger', done: 'success', cancelled: 'secondary' }[store.job?.state] || 'warning'))
const detail = computed(() => {
  const j = store.job
  if (!j) return ''
  const parts = [t('panama.files', { n: j.files })]
  if (j.remaining != null) parts.push(t('panama.filesLeft', { n: j.remaining }))
  if (j.bytes_done) parts.push(total.value ? t('panama.bytesOf', { done: formatBytes(j.bytes_done), total: formatBytes(total.value) }) : formatBytes(j.bytes_done))
  if (j.rate && !TERMINAL.includes(j.state)) parts.push(`${formatBytes(j.rate)}/s`)
  return parts.join(' · ')
})
watch(() => store.job?.recent?.length, async () => { await nextTick(); if (fileList.value) fileList.value.scrollTop = fileList.value.scrollHeight })   // the newest file in view, like the Sync window
onMounted(async () => { await store.loadStatus(); store.reload() })
watch(() => store.podAvailable, () => store.reload())
</script>
