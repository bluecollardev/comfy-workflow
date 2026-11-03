<template>
  <div data-testid="panama-pane">
    <p class="text-body-secondary small">{{ $t('panama.intro', { bucket: store.status?.bucket, profile: store.status?.profile }) }}</p>
    <BAlert v-if="store.error" :model-value="true" variant="danger" dismissible class="mb-3" data-testid="panama-error" @update:model-value="store.error = null">{{ store.error }}</BAlert>
    <div class="small mb-2" data-testid="panama-staging"><span class="text-body-secondary">{{ $t('panama.staging') }}</span> <code class="ms-1">{{ store.status?.staging }}</code></div>

    <div v-if="store.loading" class="text-body-secondary small" data-testid="panama-loading"><BSpinner small class="me-2" />{{ $t('panama.loading') }}</div>
    <div v-else-if="!store.rounds.length" class="small text-body-secondary" data-testid="panama-none">{{ $t('panama.none') }}</div>
    <div v-for="r in store.rounds" :key="r.name" class="d-flex align-items-center gap-2 py-1 border-bottom" data-testid="panama-round" :data-round="r.name">
      <code class="flex-grow-1">{{ r.name }}</code>
      <span v-if="store.sizes[r.name]" class="small text-body-secondary" data-testid="panama-size">{{ $t('panama.sizeLine', { files: store.sizes[r.name].files, size: size(store.sizes[r.name].bytes) }) }}</span>
      <BButton v-else size="sm" variant="outline-light" class="text-nowrap" data-testid="panama-size-btn" @click="store.loadSize(r.name)">{{ $t('panama.size') }}</BButton>
      <BBadge v-if="r.staged" variant="success" class="fw-normal" data-testid="panama-staged">{{ $t('panama.staged') }}</BBadge>
      <BButton size="sm" variant="primary" class="text-nowrap" :disabled="busy" data-testid="panama-pull" @click="store.pull(r.name)"><i class="fa-solid fa-cloud-arrow-down me-1"></i>{{ r.staged ? $t('panama.again') : $t('panama.download') }}</BButton>
      <BButton v-if="r.staged" size="sm" variant="outline-light" class="text-nowrap" data-testid="panama-use" @click="use(r.name)">{{ $t('panama.use') }}</BButton>
    </div>

    <div v-if="store.job" class="card mt-3" data-testid="panama-job">
      <div class="card-body small">
        <strong>{{ store.job.round }}</strong>
        <BBadge :variant="store.job.state === 'failed' ? 'danger' : store.job.state === 'done' ? 'success' : 'info'" class="ms-2 fw-normal" data-testid="panama-job-state">{{ $t(`panama.state.${store.job.state}`) }}</BBadge>
        <span class="ms-2 text-body-secondary" data-testid="panama-job-files">{{ $t('panama.files', { n: store.job.files }) }}</span>
        <div v-if="store.job.error" class="text-danger mt-1" data-testid="panama-job-error">{{ store.job.error }}</div>
        <pre v-if="store.job.lines?.length" class="mb-0 mt-2 small text-body-secondary">{{ store.job.lines.slice(-4).join('\n') }}</pre>
        <BButton v-if="store.job.state === 'done'" size="sm" variant="primary" class="mt-2" data-testid="panama-continue" @click="use(store.job.round)">{{ $t('panama.use') }}</BButton>
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
