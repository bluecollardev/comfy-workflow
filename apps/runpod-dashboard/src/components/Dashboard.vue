<template>
  <div class="d-flex flex-column gap-4">
    <BAlert v-if="!settings.ready" :model-value="true" variant="warning" class="mb-0" data-testid="key-required">
      <i class="fa-solid fa-key me-2"></i>{{ $t('dashboard.keyRequired') }}
      <BButton size="sm" variant="warning" class="ms-2" data-testid="key-required-open" @click="ui.configOpen = true">{{ $t('dashboard.keyRequiredOpen') }}</BButton>
    </BAlert>
    <!-- Create pod: the card header is the collapse trigger -->
    <BCard v-if="settings.ready" no-body>
      <button
        type="button"
        class="card-header card-header-toggle d-flex align-items-center"
        :aria-expanded="showCreateForm"
        aria-controls="create-pod-form"
        data-testid="create-pod-toggle"
        @click="toggleCreateForm"
      >
        <span class="fw-semibold">{{ $t('dashboard.createPod') }}</span>
        <i class="fa-solid fa-chevron-right ms-auto"></i>
      </button>
      <BCollapse id="create-pod-form" v-model="showCreateForm">
        <BCardBody>
          <PodForm ref="podForm" @pod-created="handlePodCreated" />
        </BCardBody>
      </BCollapse>
    </BCard>

    <!-- Pod list -->
    <BCard no-body>
      <BCardHeader class="d-flex align-items-center">
        <span class="fw-semibold">{{ $t('dashboard.pods') }}</span>
        <BFormCheckbox v-model="grouped" switch class="ms-auto me-3 mb-0 small" data-testid="pods-group-toggle">{{ $t('dashboard.groupByDatacenter') }}</BFormCheckbox>
        <BBadge variant="secondary" pill>{{ pods.pods.length }}</BBadge>
      </BCardHeader>
      <BCardBody>
        <div v-if="pods.pods.length === 0" class="text-center text-body-secondary py-4" data-testid="pods-empty">
          {{ $t('dashboard.noPods') }}
        </div>
        <BRow v-else-if="!grouped" class="g-3" data-testid="pod-list">
          <BCol v-for="pod in pods.pods" :key="pod.id" md="6" xl="4">
            <PodCard
              :pod="pod"
              :busy="pods.busyPodId === pod.id"
              @stop="pods.stop(pod.id)"
              @resume="pods.resume(pod.id)"
              @delete="pods.remove(pod.id)"
            />
          </BCol>
        </BRow>
        <div v-else data-testid="pod-list">
          <section v-for="g in groups" :key="g.dc" class="pod-group mb-4" data-testid="pod-group" :data-dc="g.dc">
            <h6 class="d-flex align-items-center gap-2 text-body-secondary mb-2" data-testid="pod-group-title"><i class="fa-solid fa-location-dot"></i><span class="font-monospace">{{ g.dc || $t('dashboard.noDatacenter') }}</span><BBadge variant="secondary" pill class="fw-normal">{{ g.pods.length }}</BBadge></h6>
            <BRow class="g-3">
              <BCol v-for="pod in g.pods" :key="pod.id" md="6" xl="4">
                <PodCard
                  :pod="pod"
                  :busy="pods.busyPodId === pod.id"
                  @stop="pods.stop(pod.id)"
                  @resume="pods.resume(pod.id)"
                  @delete="pods.remove(pod.id)"
                />
              </BCol>
            </BRow>
          </section>
        </div>
      </BCardBody>
    </BCard>

    <BAlert
      v-if="pods.actionError"
      :model-value="true"
      variant="danger"
      dismissible
      data-testid="action-error"
      @update:model-value="pods.actionError = null"
    >
      {{ pods.actionError }}
    </BAlert>
  </div>
</template>

<script setup>
/**
 * Dashboard — the create-pod card and the pod list. The list, the busy state and every
 * action live in the pods store; this component only lays them out and collapses the
 * create form when a pod has been created.
 */
import { computed, ref, watch } from 'vue'
import PodCard from './PodCard.vue'
import PodForm from './PodForm.vue'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { usePodsStore } from '../stores/pods'

const pods = usePodsStore()
/** The grouped view is a choice, off by default (the plain list); it is remembered. */
const grouped = ref(localStorage.getItem('pods.groupByDatacenter') === '1')
watch(grouped, (v) => localStorage.setItem('pods.groupByDatacenter', v ? '1' : '0'))
/** The pods grouped by datacenter, in name order, the ones with no datacenter last; pods keep their order inside a group. */
const groups = computed(() => {
  const m = new Map()
  for (const p of pods.pods) { const k = p.datacenter || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(p) }
  return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))).map(([dc, list]) => ({ dc, pods: list }))
})
const settings = useSettingsStore()
const ui = useUiStore()
const showCreateForm = ref(false)
const podForm = ref(null)

// Opening the form re-reads RunPod's stock so the card menu is current.
function toggleCreateForm() {
  showCreateForm.value = !showCreateForm.value
  if (showCreateForm.value) podForm.value?.loadGpus()
}

function handlePodCreated() {
  showCreateForm.value = false
}
</script>
