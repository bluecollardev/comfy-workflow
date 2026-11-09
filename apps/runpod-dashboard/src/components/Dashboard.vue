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

    <!-- Rounds: a round holds a series of pods (ADR-039). Pods with no round are listed under "No round", exactly as the pod list was. -->
    <BCard v-for="r in roundSections" :key="r.round" no-body data-testid="round-section" :data-round="r.round">
      <BCardHeader class="d-flex align-items-center">
        <i class="fa-solid fa-film me-2 text-body-secondary"></i>
        <template v-if="renamingRound !== r.round">
          <span class="fw-semibold" data-testid="round-title" :title="r.label !== r.round ? r.round : ''">{{ r.label }}</span>
          <button type="button" class="btn btn-link btn-sm p-0 ms-2 align-baseline text-body-secondary" :title="$t('dashboard.roundRename')" :aria-label="$t('dashboard.roundRename')" data-testid="round-rename" @click="startRenameRound(r)"><i class="fa-solid fa-pencil fa-xs"></i></button>
        </template>
        <div v-else class="input-group input-group-sm" style="max-width: 24rem">
          <input v-model="roundDraft" type="text" class="form-control" maxlength="80" :placeholder="r.round" :aria-label="$t('dashboard.roundRename')" data-testid="round-rename-input" @keydown.enter="saveRenameRound(r)" @keydown.esc="renamingRound = ''" />
          <button type="button" class="btn btn-primary" :title="$t('dashboard.roundRenameSave')" data-testid="round-rename-save" @click="saveRenameRound(r)"><i class="fa-solid fa-check"></i></button>
          <button type="button" class="btn btn-outline-light" data-testid="round-rename-cancel" @click="renamingRound = ''"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <BBadge variant="secondary" pill class="ms-auto">{{ $t('dashboard.roundPods', { n: r.pods.length }) }}</BBadge>
      </BCardHeader>
      <BCardBody>
        <BRow class="g-3" data-testid="round-pod-list">
          <BCol v-for="pod in r.pods" :key="pod.id" md="6" xl="4">
            <PodCard :pod="pod" :busy="pods.busyPodId === pod.id" :rounds="roundNames" @stop="pods.stop(pod.id)" @resume="pods.resume(pod.id)" @delete="pods.remove(pod.id)" @rename="(name) => pods.rename(pod.id, name)" @round="(rd) => pods.setRound(pod.id, rd)" />
          </BCol>
        </BRow>
      </BCardBody>
    </BCard>

    <!-- Pod list -->
    <BCard no-body data-testid="unassigned-section">
      <BCardHeader class="d-flex align-items-center">
        <span class="fw-semibold">{{ roundSections.length ? $t('dashboard.unassigned') : $t('dashboard.pods') }}</span>
        <BFormCheckbox v-model="grouped" switch class="ms-auto me-3 mb-0 small" data-testid="pods-group-toggle">{{ $t('dashboard.groupByDatacenter') }}</BFormCheckbox>
        <BBadge variant="secondary" pill>{{ unassigned.length }}</BBadge>
      </BCardHeader>
      <BCardBody>
        <div v-if="pods.pods.length === 0" class="text-center text-body-secondary py-4" data-testid="pods-empty">
          {{ $t('dashboard.noPods') }}
        </div>
        <BRow v-else-if="!grouped" class="g-3" data-testid="pod-list">
          <BCol v-for="pod in unassigned" :key="pod.id" md="6" xl="4">
            <PodCard
              :pod="pod"
              :busy="pods.busyPodId === pod.id"
              :rounds="roundNames"
              @stop="pods.stop(pod.id)"
              @resume="pods.resume(pod.id)"
              @delete="pods.remove(pod.id)"
              @rename="(name) => pods.rename(pod.id, name)"
              @round="(rd) => pods.setRound(pod.id, rd)"
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
                  :rounds="roundNames"
                  @stop="pods.stop(pod.id)"
                  @resume="pods.resume(pod.id)"
                  @delete="pods.remove(pod.id)"
                  @rename="(name) => pods.rename(pod.id, name)"
                  @round="(rd) => pods.setRound(pod.id, rd)"
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
import { computed, onMounted, ref, watch } from 'vue'
import PodCard from './PodCard.vue'
import PodForm from './PodForm.vue'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { usePodsStore } from '../stores/pods'
import { usePanamaStore } from '../stores/panama'

const pods = usePodsStore()
const panama = usePanamaStore()
/** Rounds (ADR-039): a round holds a series of pods. The pods in a round, round by round in name order; the rest stay in the pod list below. */
const unassigned = computed(() => pods.pods.filter((p) => !p.round))
const roundSections = computed(() => {
  const m = new Map()
  for (const p of pods.pods) if (p.round) { if (!m.has(p.round)) m.set(p.round, []); m.get(p.round).push(p) }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([round, list]) => ({ round, label: list[0].round_label || round, pods: list }))
})
/** A round is renamable: the name is ours (the delivery round keeps its own); empty goes back to it. */
const renamingRound = ref('')
const roundDraft = ref('')
const startRenameRound = (r) => { roundDraft.value = r.label; renamingRound.value = r.round }
const saveRenameRound = (r) => { const n = roundDraft.value.trim(); renamingRound.value = ''; if (n !== r.label) pods.renameRound(r.round, n === r.round ? '' : n) }
/** The rounds a pod can be dropped into: the bucket's rounds, as far as the exchange is set up, and any round that already has pods. */
const roundNames = computed(() => {
  const m = new Map((panama.rounds || []).map((r) => [r.name, r.name]))
  for (const r of roundSections.value) m.set(r.round, r.label)
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([round, label]) => ({ round, label }))
})
onMounted(async () => { try { const st = await panama.loadStatus(); if (st?.configured) await panama.loadRounds() } catch { /* no exchange: only rounds with pods are offered */ } })
/** The grouped view is a choice, off by default (the plain list); it is remembered. */
const grouped = ref(localStorage.getItem('pods.groupByDatacenter') === '1')
watch(grouped, (v) => localStorage.setItem('pods.groupByDatacenter', v ? '1' : '0'))
/** The pods grouped by datacenter, in name order, the ones with no datacenter last; pods keep their order inside a group. */
const groups = computed(() => {
  const m = new Map()
  for (const p of unassigned.value) { const k = p.datacenter || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(p) }
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
