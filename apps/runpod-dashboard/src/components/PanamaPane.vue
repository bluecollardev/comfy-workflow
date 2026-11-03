<template>
  <div data-testid="panama-pane">
    <p class="text-body-secondary small">{{ $t('panama.intro', { bucket: store.status?.bucket, via: store.status?.via === 'aws profile' ? $t('panama.viaProfile', { profile: store.status?.profile }) : $t('panama.viaKeys') }) }}</p>
    <BAlert v-if="store.error" :model-value="true" variant="danger" dismissible class="mb-3" data-testid="panama-error" @update:model-value="store.error = null">{{ store.error }}</BAlert>
    <div class="small mb-2" data-testid="panama-staging"><span class="text-body-secondary">{{ $t('panama.staging') }}</span> <code class="ms-1">{{ store.status?.staging }}</code></div>

    <div v-if="store.loading" class="text-body-secondary small" data-testid="panama-loading"><BSpinner small class="me-2" />{{ $t('panama.loading') }}</div>
    <div v-else-if="!store.rounds.length" class="small text-body-secondary" data-testid="panama-none">{{ $t('panama.none') }}</div>
    <div v-for="r in store.rounds" :key="r.name" class="d-flex align-items-center gap-2 py-1 border-bottom" data-testid="panama-round" :data-round="r.name">
      <code class="flex-grow-1">{{ r.name }}</code>
      <BBadge v-if="r.state === 'complete'" variant="success" class="fw-normal" data-testid="panama-staged">{{ $t('panama.staged') }}</BBadge>
      <BBadge v-else-if="r.state === 'partial'" variant="warning" class="fw-normal" :title="r.missing != null ? $t('panama.missingHint', { n: r.missing }) : ''" data-testid="panama-partial">{{ r.expected != null ? $t('panama.stagedPartial', { present: r.present, expected: r.expected }) : $t('panama.stagedPartialUnknown', { present: r.present }) }}</BBadge>
      <BBadge v-else-if="r.state === 'unverified'" variant="info" class="fw-normal" data-testid="panama-unverified">{{ $t('panama.stagedUnverified') }}</BBadge>
      <span v-if="r.bytes" class="small text-body-secondary" :title="$t('panama.onDiskHint')" data-testid="panama-on-disk">{{ $t('panama.onDisk', { size: size(r.bytes) }) }}</span>
      <span v-if="store.sizes[r.name]" class="small text-body-secondary" data-testid="panama-size">{{ $t('panama.sizeLine', { files: store.sizes[r.name].files, size: size(store.sizes[r.name].bytes) }) }}</span>
      <BButton v-else size="sm" variant="outline-light" class="text-nowrap" data-testid="panama-size-btn" @click="store.loadSize(r.name)">{{ $t('panama.size') }}</BButton>
      <BButton size="sm" variant="primary" class="text-nowrap" :disabled="busy" data-testid="panama-pull" @click="store.pull(r.name)"><i class="fa-solid fa-cloud-arrow-down me-1"></i>{{ r.state === 'partial' ? $t('panama.resume') : r.state === 'none' || !r.state ? $t('panama.download') : $t('panama.again') }}</BButton>
      <BButton v-if="r.staged" size="sm" variant="success" class="text-nowrap" data-testid="panama-use" @click="use(r.name)">{{ $t('panama.use') }}</BButton>
      <BButton v-if="r.state !== 'none' && store.removing !== r.name" size="sm" variant="outline-danger" class="text-nowrap" :disabled="busy && store.job?.round === r.name" :title="$t('panama.deleteHint')" data-testid="panama-delete" @click="store.removing = r.name"><i class="fa-regular fa-trash-can me-1"></i>{{ $t('panama.delete') }}</BButton>
    </div>
    <div v-if="store.removing" class="alert alert-danger d-flex align-items-center gap-2 mt-2 mb-0 py-2 small" data-testid="panama-delete-confirm">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span class="flex-grow-1">{{ $t('panama.deleteConfirm', { round: store.removing, size: size(store.rounds.find((x) => x.name === store.removing)?.bytes || 0) }) }}</span>
      <BButton size="sm" variant="danger" data-testid="panama-delete-yes" @click="store.remove(store.removing)">{{ $t('panama.deleteYes') }}</BButton>
      <BButton size="sm" variant="outline-light" data-testid="panama-delete-no" @click="store.removing = null">{{ $t('panama.deleteNo') }}</BButton>
    </div>

    <div v-if="store.job" class="card mt-3" data-testid="panama-job">
      <div class="card-body small">
        <div class="d-flex align-items-center gap-2" data-testid="panama-job-header">
          <strong>{{ store.job.round }}</strong>
          <BBadge :variant="{ failed: 'danger', done: 'success', cancelled: 'warning' }[store.job.state] || 'info'" class="fw-normal" data-testid="panama-job-state">{{ $t(`panama.state.${store.job.state}`) }}</BBadge>
          <span class="text-body-secondary" data-testid="panama-job-files">{{ $t('panama.files', { n: store.job.files }) }}</span>
          <BButton v-if="store.job.state === 'running'" size="sm" variant="outline-danger" class="ms-auto text-nowrap" data-testid="panama-cancel" @click="store.cancel()"><i class="fa-solid fa-xmark me-1"></i>{{ $t('panama.cancel') }}</BButton>
        </div>
        <div v-if="store.job.error" class="text-danger mt-1" data-testid="panama-job-error">{{ store.job.error }}</div>
        <pre v-if="store.job.lines?.length" class="mb-0 mt-2 small text-body-secondary">{{ store.job.lines.slice(-4).join('\n') }}</pre>
        <div v-if="store.job.state === 'cancelled'" class="text-body-secondary mt-1" data-testid="panama-job-cancelled">{{ $t('panama.cancelledNote') }}</div>
        <BButton v-if="store.job.state === 'done'" size="sm" variant="success" class="mt-2" data-testid="panama-continue" @click="use(store.job.round)">{{ $t('panama.use') }}</BButton>
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * PanamaPane — the "Panama S3" source of Import Shot Pack (docs/ADR-015): list the rounds in the exchange bucket, download one to
 * the staging folder, then hand that folder to the ordinary folder import (adapter, plan, Import).
 */
import { computed, onMounted } from 'vue'
import { usePanamaStore } from '../stores/panama'
import { useImportsStore } from '../stores/imports'
import { useUiStore } from '../stores/ui'

const store = usePanamaStore()
const imports = useImportsStore()
const ui = useUiStore()
const busy = computed(() => store.job?.state === 'running')
const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`)
/** The staged round becomes the folder of the ordinary import, and the pane switches to it. */
const use = (round) => {
  imports.folder = `${store.status.staging}/${round}`
  ui.importSource = 'folder'
  imports.makePlan(false)
}
onMounted(() => store.loadRounds())
</script>
