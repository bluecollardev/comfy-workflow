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

    <!-- Pods. Grouped by round (ADR-039: a round holds a series of pods; each round is a collapsible list, empty ones too) and/or by datacenter. -->
    <BCard no-body data-testid="pods-card">
      <BCardHeader class="d-flex align-items-center">
        <span class="fw-semibold">{{ byRound ? $t('dashboard.rounds') : $t('dashboard.pods') }}</span>
        <BButton variant="success" size="sm" class="ms-3" :disabled="!settings.ready" :title="$t('app.importRoundTitle')" data-testid="open-import-round" @click="ui.importRoundOpen = true">
          <i class="fa-solid fa-cloud-arrow-down me-1"></i>{{ $t('app.importRound') }}
        </BButton>
        <BFormCheckbox v-model="byRound" switch class="ms-auto me-3 mb-0 small" data-testid="pods-round-toggle">{{ $t('dashboard.groupByRound') }}</BFormCheckbox>
        <BFormCheckbox v-if="byRound && emptyCount" v-model="showEmpty" switch class="me-3 mb-0 small" data-testid="pods-empty-toggle">{{ $t('dashboard.showEmpty', { n: emptyCount }) }}</BFormCheckbox>
        <BFormCheckbox v-model="grouped" switch class="me-3 mb-0 small" data-testid="pods-group-toggle">{{ $t('dashboard.groupByDatacenter') }}</BFormCheckbox>
        <BBadge variant="secondary" pill>{{ pods.pods.length }}</BBadge>
      </BCardHeader>
      <BCardBody>
        <div v-if="pods.pods.length === 0 && !(byRound && sections.length)" class="text-center text-body-secondary py-4" data-testid="pods-empty">
          {{ $t('dashboard.noPods') }}
        </div>
        <div v-else data-testid="pod-list">
          <section v-for="sec in sections" :key="sec.key" class="round-section mb-3" :class="{ 'drop-over': dragId && overKey === sec.key }" data-testid="round-section" :data-round="sec.round ?? ''" @dragover="onDragOver($event, sec)" @dragleave="onDragLeave(sec)" @drop="onDrop($event, sec)">
            <div v-if="byRound" class="d-flex align-items-center gap-2 round-head" :class="{ 'mb-2': !isCollapsed(sec) }">
              <button type="button" class="btn btn-link p-0 text-body d-flex align-items-center gap-2 text-decoration-none" :aria-expanded="!isCollapsed(sec)" data-testid="round-toggle" @click="toggleRound(sec)">
                <i class="fa-solid fa-chevron-right fa-xs round-chevron" :class="{ open: !isCollapsed(sec) }"></i>
                <i class="fa-solid" :class="sec.round ? 'fa-film' : 'fa-circle-question'"></i>
                <span v-if="renamingRound !== sec.round" class="fw-semibold" data-testid="round-title" :title="sec.round && sec.label !== sec.round ? sec.round : ''">{{ sec.label }}</span>
              </button>
              <template v-if="sec.round && renamingRound !== sec.round">
                <button type="button" class="btn btn-sm btn-outline-light py-0 text-nowrap" :title="$t('dashboard.roundReimport')" :aria-label="$t('dashboard.roundReimport')" :disabled="!settings.ready" data-testid="round-reimport" @click="reimportRound(sec)"><i class="fa-solid fa-cloud-arrow-down me-1"></i>{{ $t('dashboard.roundReimportLabel') }}</button>
                <button type="button" class="btn btn-sm btn-outline-success py-0 text-nowrap" :title="runningPod(sec) ? $t('dashboard.roundRunTitle', { name: runningPod(sec).name }) : $t('dashboard.roundRunNoPod')" :aria-label="$t('dashboard.roundRun')" data-testid="round-run-workflows" @click="runRound(sec)"><i class="fa-solid fa-play me-1"></i>{{ $t('dashboard.roundRun') }}</button>
                <button type="button" class="btn btn-sm btn-outline-danger py-0" :title="$t('dashboard.roundDelete')" :aria-label="$t('dashboard.roundDelete')" data-testid="round-delete" @click="deleteRound(sec)"><i class="fa-solid fa-trash"></i></button>
                <button type="button" class="btn btn-sm btn-outline-light py-0" :title="$t('dashboard.roundRename')" :aria-label="$t('dashboard.roundRename')" data-testid="round-rename" @click="startRenameRound(sec)"><i class="fa-solid fa-pencil"></i></button>
              </template>
              <div v-else-if="sec.round" class="input-group input-group-sm" style="max-width: 24rem">
                <input v-model="roundDraft" type="text" class="form-control" maxlength="80" :placeholder="sec.round" :aria-label="$t('dashboard.roundRename')" data-testid="round-rename-input" @keydown.enter="saveRenameRound(sec)" @keydown.esc="renamingRound = ''" />
                <button type="button" class="btn btn-primary" :title="$t('dashboard.roundRenameSave')" data-testid="round-rename-save" @click="saveRenameRound(sec)"><i class="fa-solid fa-check"></i></button>
                <button type="button" class="btn btn-outline-light" data-testid="round-rename-cancel" @click="renamingRound = ''"><i class="fa-solid fa-xmark"></i></button>
              </div>
              <BBadge variant="secondary" pill class="ms-auto fw-normal" data-testid="round-count">{{ $t('dashboard.roundPods', { n: sec.pods.length }) }}</BBadge>
            </div>
            <div v-show="!byRound || !isCollapsed(sec)" data-testid="round-body">
              <div v-if="!sec.pods.length" class="small text-body-secondary py-2" data-testid="round-empty">
                <template v-if="facts(sec.round).length"><span v-for="f in facts(sec.round)" :key="f" class="badge text-bg-secondary fw-normal me-2" data-testid="round-fact">{{ f }}</span></template>
                <template v-if="!facts(sec.round).length">{{ $t('dashboard.roundEmpty') }}</template>
              </div>
              <BRow v-else-if="!grouped" class="g-3" data-testid="round-pod-list">
                <BCol v-for="pod in sec.pods" :key="pod.id" md="6" xl="4">
                  <div class="pod-drag" :class="{ dragging: dragId === pod.id }" data-testid="pod-drag" :data-pod="pod.id"><PodCard :pod="pod" :busy="pods.busyPodId === pod.id" :rounds="roundNames" :handle="byRound" @dragstart="(e) => onDragStart(e, pod)" @dragend="dragId = ''; overKey = null" @stop="pods.stop(pod.id)" @resume="pods.resume(pod.id)" @delete="pods.remove(pod.id)" @rename="(name) => pods.rename(pod.id, name)" @round="(rd) => pods.setRound(pod.id, rd)" /></div>
                </BCol>
              </BRow>
              <template v-else>
                <section v-for="g in dcGroups(sec.pods)" :key="g.dc" class="pod-group mb-3" data-testid="pod-group" :data-dc="g.dc">
                  <h6 class="d-flex align-items-center gap-2 text-body-secondary mb-2" data-testid="pod-group-title"><i class="fa-solid fa-location-dot"></i><span class="font-monospace">{{ g.dc || $t('dashboard.noDatacenter') }}</span><BBadge variant="secondary" pill class="fw-normal">{{ g.pods.length }}</BBadge></h6>
                  <BRow class="g-3">
                    <BCol v-for="pod in g.pods" :key="pod.id" md="6" xl="4">
                      <div class="pod-drag" :class="{ dragging: dragId === pod.id }" data-testid="pod-drag" :data-pod="pod.id"><PodCard :pod="pod" :busy="pods.busyPodId === pod.id" :rounds="roundNames" :handle="byRound" @dragstart="(e) => onDragStart(e, pod)" @dragend="dragId = ''; overKey = null" @stop="pods.stop(pod.id)" @resume="pods.resume(pod.id)" @delete="pods.remove(pod.id)" @rename="(name) => pods.rename(pod.id, name)" @round="(rd) => pods.setRound(pod.id, rd)" /></div>
                    </BCol>
                  </BRow>
                </section>
              </template>
            </div>
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
    <RunWorkflowsModal v-if="runFlows" :model-value="true" :pod="runFlows.pod" :round="runFlows.round" @update:model-value="(v) => !v && (runFlows = null)" />
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
import { t } from '../i18n'
import RunWorkflowsModal from './RunWorkflowsModal.vue'

const pods = usePodsStore()
const panama = usePanamaStore()
/** The pods grouped by datacenter, in name order, the ones with no datacenter last; pods keep their order inside a group. */
const dcGroups = (list) => {
  const m = new Map()
  for (const p of list) { const k = p.datacenter || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(p) }
  return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))).map(([dc, l]) => ({ dc, pods: l }))
}
/** Rounds (ADR-039): a round holds a series of pods. Grouping by round is a choice, remembered; each round is a collapsible list. */
const byRound = ref(localStorage.getItem('pods.groupByRound') !== '0')
watch(byRound, (v) => localStorage.setItem('pods.groupByRound', v ? '1' : '0'))
const collapsed = ref(new Set(JSON.parse(localStorage.getItem('pods.collapsedRounds') || '[]')))
const isCollapsed = (sec) => collapsed.value.has(sec.key)
const toggleRound = (sec) => { const n = new Set(collapsed.value); n.has(sec.key) ? n.delete(sec.key) : n.add(sec.key); collapsed.value = n; localStorage.setItem('pods.collapsedRounds', JSON.stringify([...n])) }
/** The rounds a pod can be dropped into: the bucket's rounds, as far as the exchange is set up, and any round that already has pods. Each with the name this app shows. */
/** A deleted round that is still in the bucket stays out of the list on this PC until it is imported again. */
const hiddenRounds = ref(new Set(JSON.parse(localStorage.getItem('pods.hiddenRounds') || '[]')))
const hideRound = (r, on) => { const n = new Set(hiddenRounds.value); on ? n.add(r) : n.delete(r); hiddenRounds.value = n; localStorage.setItem('pods.hiddenRounds', JSON.stringify([...n])) }
const roundNames = computed(() => {
  const m = new Map((panama.rounds || []).filter((r) => !hiddenRounds.value.has(r.name)).map((r) => [r.name, r.name]))
  for (const r of panama.podView?.rounds || []) if (r.state !== 'none' && !hiddenRounds.value.has(r.name)) m.set(r.name, r.name)   // what a pod pulled onto the volume
  for (const p of pods.pods) if (p.round) m.set(p.round, p.round_label || p.round)
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([round, label]) => ({ round, label }))
})
/** Rounds with no pod are out of the way until asked for ("Show empty rounds"); then each says where its files are. */
const showEmpty = ref(localStorage.getItem('pods.showEmptyRounds') === '1')
watch(showEmpty, (v) => localStorage.setItem('pods.showEmptyRounds', v ? '1' : '0'))
/** A round with its files on this PC or on the volume is listed even with no pod: it is something we imported. */
const hasData = (round) => facts(round).length > 0
const emptyCount = computed(() => roundNames.value.filter((r) => !pods.pods.some((p) => p.round === r.round) && !hasData(r.round)).length)
const facts = (round) => {
  const out = [], loc = (panama.rounds || []).find((r) => r.name === round), vol = (panama.podView?.rounds || []).find((r) => r.name === round)
  if (loc && loc.state !== 'none') out.push(t('dashboard.factLocal', { n: loc.present }))
  if (vol && vol.state !== 'none') out.push(t('dashboard.factVolume', { n: vol.present, name: panama.podView?.volume?.name || '' }))
  return out
}
/** What the list shows: with rounds on, every round (empty ones too) then the pods in no round; with rounds off, one list. */
const sections = computed(() => {
  if (!byRound.value) return pods.pods.length ? [{ key: '*', round: null, label: '', pods: pods.pods }] : []
  const out = roundNames.value.map((r) => ({ key: r.round, round: r.round, label: r.label, pods: pods.pods.filter((p) => p.round === r.round) })).filter((s) => s.pods.length || hasData(s.round) || showEmpty.value)
  const rest = pods.pods.filter((p) => !p.round)
  if (rest.length || !out.length) out.push({ key: '', round: null, label: t('dashboard.unassigned'), pods: rest })
  return out
})
/** Drag a pod card onto another round (or onto "No round") to move it there, after a confirmation (ADR-039). Only while grouped by round. */
const dragId = ref('')
const overKey = ref(null)
const onDragStart = (e, pod) => { if (!byRound.value) return; dragId.value = pod.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', pod.id) }
const onDragOver = (e, sec) => { if (!dragId.value) return; const pod = pods.pods.find((p) => p.id === dragId.value); if ((pod?.round || '') === (sec.round || '')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; overKey.value = sec.key }
const onDragLeave = (sec) => { if (overKey.value === sec.key) overKey.value = null }
const onDrop = (e, sec) => {
  const id = dragId.value; dragId.value = ''; overKey.value = null
  const pod = pods.pods.find((p) => p.id === id)
  if (!pod || (pod.round || '') === (sec.round || '')) return
  e.preventDefault()
  const msg = sec.round ? t('dashboard.confirmMove', { name: pod.name, to: sec.label }) : t('dashboard.confirmMoveOut', { name: pod.name })
  if (window.confirm(msg)) pods.setRound(pod.id, sec.round || '')
}
/** Re-import opens Import Round with this round chosen. Delete clears the round on our side (after a confirmation): its pods leave it and keep running. */
/** Run all workflows of a round: on a running pod of the round (Run Workflows opens with the round's graphs ticked); with none running, Import Round(s) opens on the round to pick pods and cards. */
const runFlows = ref(null)
const runningPod = (sec) => sec.pods.find((p) => p.status === 'running') || null
const runRound = (sec) => { const pod = runningPod(sec); if (pod) runFlows.value = { pod: { id: pod.id, name: pod.name }, round: sec.round }; else reimportRound(sec) }
const reimportRound = (sec) => { hideRound(sec.round, false); ui.importRoundPreset = sec.round; ui.importRoundOpen = true }
const deleteRound = (sec) => { if (window.confirm(t('dashboard.confirmDeleteRound', { name: sec.label, n: sec.pods.length }))) { hideRound(sec.round, true); pods.deleteRound(sec.round) } }
/** A round is renamable: the name is ours (the delivery round keeps its own); empty goes back to it. */
const renamingRound = ref('')
const roundDraft = ref('')
const startRenameRound = (r) => { roundDraft.value = r.label; renamingRound.value = r.round }
const saveRenameRound = (r) => { const n = roundDraft.value.trim(); renamingRound.value = ''; if (n !== r.label) pods.renameRound(r.round, n === r.round ? '' : n) }
onMounted(async () => { try { const st = await panama.loadStatus(); if (st?.configured) { await panama.loadRounds(); panama.loadPod() } } catch { /* no exchange: only rounds with pods are offered */ } })
/** The grouped view is a choice, off by default (the plain list); it is remembered. */
const grouped = ref(localStorage.getItem('pods.groupByDatacenter') === '1')
watch(grouped, (v) => localStorage.setItem('pods.groupByDatacenter', v ? '1' : '0'))
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

<style scoped>
.pod-drag.dragging { opacity: 0.45; }
.round-section.drop-over { outline: 2px dashed #508cff; outline-offset: 4px; border-radius: 6px; background: rgba(80, 140, 255, 0.08); }
.round-head { padding: 6px 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.05); }
.round-chevron { transition: transform 0.15s; }
.round-chevron.open { transform: rotate(90deg); }
</style>
