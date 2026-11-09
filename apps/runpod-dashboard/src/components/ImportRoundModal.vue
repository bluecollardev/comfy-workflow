<template>
  <BModal v-model="open" :title="$t('importRound.title')" size="lg" scrollable no-footer data-testid="import-round-modal" @hidden="open = false">
    <div v-if="error" class="alert alert-danger small py-2" data-testid="import-round-error">{{ error }}</div>
    <div class="mb-3">
      <div class="form-label small mb-1">{{ $t('importRound.rounds') }}</div>
      <div class="border rounded p-2 round-list" data-testid="import-round-list">
        <div v-for="r in roundNamesList" :key="r" class="d-flex align-items-center gap-2 small" data-testid="import-round-option" :data-round="r">
          <input :id="`irr-${r}`" type="checkbox" class="form-check-input mt-0" :checked="chosen.has(r)" @change="toggleRound(r, $event.target.checked)" />
          <label :for="`irr-${r}`" class="font-monospace mb-0 flex-grow-1">{{ r }}</label>
          <BButton variant="outline-light" size="sm" class="py-0 text-nowrap" data-testid="import-round-browse" @click="browsing = r"><i class="fa-solid fa-folder-tree me-1"></i>{{ $t('importRound.browse') }}</BButton>
        </div>
        <div v-if="!roundNamesList.length" class="small text-body-secondary">{{ $t('importRound.noRounds') }}</div>
      </div>
    </div>
    <div v-if="loadingPlan" class="small text-body-secondary" data-testid="import-round-loading">{{ $t('importRound.loadingPlan') }}</div>
    <template v-else-if="chosen.size && plans.size">
      <div class="small fw-semibold mb-1">{{ $t('importRound.shots') }}</div>
      <div v-for="[r, pl] in plans" :key="r" class="mb-2" data-testid="import-round-group" :data-round="r">
        <div v-if="plans.size > 1" class="small text-body-secondary font-monospace">{{ r }}</div>
        <div v-for="s in pl.shots" :key="s" class="d-flex align-items-center gap-2 small" data-testid="import-round-shot" :data-shot="s">
          <input :id="`ir-${r}-${s}`" type="checkbox" class="form-check-input mt-0" :checked="picked.get(r)?.has(s)" @change="toggleShot(r, s, $event.target.checked)" />
          <label :for="`ir-${r}-${s}`" class="font-monospace mb-0">{{ s }}</label>
        </div>
      </div>
      <label class="d-flex align-items-center gap-2 small mb-3"><input v-model="runWorkflows" type="checkbox" class="form-check-input mt-0" data-testid="import-round-run" />{{ $t('importRound.runWorkflows') }}</label>

      <div class="border rounded p-2 mb-3 small" data-testid="import-round-estimate">
        <div>{{ $t('importRound.price', { price: first.price_per_hour ?? '?' }) }}</div>
        <div>{{ $t('importRound.estimate', { usd: estimate }) }}</div>
        <div v-if="first.cap_enabled" class="d-flex align-items-center gap-2 mt-2 flex-wrap">
          <label class="mb-0" for="ir-pods">{{ $t(plans.size > 1 ? 'importRound.maxPodsEach' : 'importRound.maxPods') }}</label>
          <BFormInput id="ir-pods" v-model.number="maxPods" type="number" min="1" max="20" size="sm" style="width: 5rem" data-testid="import-round-max-pods" @input="podsEdited = true" />
          <label class="mb-0 ms-2" for="ir-cap">{{ $t(plans.size > 1 ? 'importRound.costCapTotal' : 'importRound.costCap') }}</label>
          <BFormInput id="ir-cap" v-model.number="costCap" type="number" min="1" size="sm" style="width: 6rem" data-testid="import-round-cost-cap" />
        </div>
        <div v-else class="text-warning mt-2" data-testid="import-round-cap-off"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('importRound.capOff') }}</div>
        <div v-if="first.cap_enabled && estimate > costCap" class="text-warning mt-1" data-testid="import-round-over-cap">{{ $t('importRound.overCap') }}</div>
      </div>

      <div class="d-flex align-items-center gap-2 mb-2">
        <label class="mb-0 small" for="ir-by">{{ $t('importRound.approvedBy') }}</label>
        <BFormInput id="ir-by" v-model="approvedBy" size="sm" style="width: 12rem" :placeholder="$t('importRound.approvedByPlaceholder')" data-testid="import-round-approved-by" />
      </div>
      <div class="d-flex gap-2 justify-content-end">
        <BButton variant="outline-light" size="sm" @click="open = false">{{ $t('picker.cancel') }}</BButton>
        <BButton variant="success" size="sm" :disabled="!canStart || starting" data-testid="import-round-start" @click="start"><i class="fa-solid fa-play me-1"></i>{{ $t('importRound.start') }}</BButton>
      </div>
    </template>
    <RoundFilesModal :round="browsing" target="local" @close="browsing = ''" />
  </BModal>
</template>

<script setup>
/**
 * Import Round(s) (ADR-038): tick one or more rounds, see their shots, the pods and the estimate with the caps, approve once. Starting queues, for each round, a pull and one run per shot; pool pods take them (see the Queue).
 * Each round is its own import in the queue; the dollar cap entered is the total and is split evenly between the rounds, so the sum never passes it.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { panamaAPI } from '../api/panama'
import { queueAPI } from '../api/queue'
import { errorText } from '../stores/toast'
import { useUiStore } from '../stores/ui'
import RoundFilesModal from './RoundFilesModal.vue'

const ui = useUiStore()
const open = computed({ get: () => ui.importRoundOpen, set: (v) => { ui.importRoundOpen = v } })
const rounds = ref([]), chosen = ref(new Set()), plans = ref(new Map()), picked = ref(new Map()), runWorkflows = ref(true)
const browsing = ref('')   // the round whose files are open in the explorer
const podsEdited = ref(false)   // until the pod limit is typed, it follows the shots ticked: one pod per shot
const maxPods = ref(2), costCap = ref(50), approvedBy = ref(''), error = ref(''), loadingPlan = ref(false), starting = ref(false)
try { approvedBy.value = localStorage.getItem('runpod-manager.approved-by') || '' } catch { /* storage blocked */ }

const roundNamesList = computed(() => { const n = rounds.value.map((r) => r.name); for (const c of chosen.value) if (!n.includes(c)) n.push(c); return n })
const first = computed(() => [...plans.value.values()][0] || {})
const estimate = computed(() => Math.round([...plans.value.entries()].reduce((a, [r, p]) => a + (p.est_total_usd ?? 0) * ((picked.value.get(r)?.size || 0) > 0 ? 1 : 0), 0) * 100) / 100)
const shotCount = (r) => picked.value.get(r)?.size || 0
const totalShots = computed(() => [...plans.value.keys()].reduce((a, r) => a + shotCount(r), 0))
const canStart = computed(() => totalShots.value > 0 && approvedBy.value.trim().length > 0)

onMounted(async () => { try { const r = await panamaAPI.rounds(); rounds.value = Array.isArray(r) ? r : r.rounds || [] } catch (e) { error.value = errorText(e) } })
watch(() => ui.importRoundOpen, (o) => { if (o && ui.importRoundPreset) { toggleRound(ui.importRoundPreset, true); ui.importRoundPreset = '' } }, { immediate: true })   // re-import: the round is already ticked
const followPods = () => { if (!podsEdited.value) maxPods.value = Math.min(20, Math.max(1, ...[...plans.value.keys()].map(shotCount))) }
async function toggleRound(r, on) {
  const n = new Set(chosen.value); on ? n.add(r) : n.delete(r); chosen.value = n
  error.value = ''
  if (!on) { plans.value.delete(r); picked.value.delete(r); plans.value = new Map(plans.value); picked.value = new Map(picked.value); followPods(); return }
  loadingPlan.value = true
  try {
    const pl = await queueAPI.plan(r, {})
    if (!chosen.value.has(r)) return
    plans.value = new Map(plans.value).set(r, pl); picked.value = new Map(picked.value).set(r, new Set(pl.shots))   // every shot ticked
    if (plans.value.size === 1) costCap.value = pl.cost_cap_usd ?? 50
    podsEdited.value = false; followPods()
  } catch (e) { error.value = errorText(e); const m = new Set(chosen.value); m.delete(r); chosen.value = m } finally { loadingPlan.value = false }
}
function toggleShot(r, s, on) { const m = new Map(picked.value); const n = new Set(m.get(r)); on ? n.add(s) : n.delete(s); m.set(r, n); picked.value = m; followPods() }
async function start() {
  starting.value = true; error.value = ''
  try {
    try { localStorage.setItem('runpod-manager.approved-by', approvedBy.value.trim()) } catch { /* storage blocked */ }
    const todo = [...plans.value.keys()].filter((r) => shotCount(r) > 0)
    const each = Math.round((costCap.value / todo.length) * 100) / 100   // the cap is the total: split evenly
    for (const r of todo) {
      const pl = plans.value.get(r)
      await queueAPI.import(r, { shots: [...picked.value.get(r)], run_workflows: runWorkflows.value, approved_by: approvedBy.value.trim(), ...(pl.cap_enabled ? { max_pods: todo.length > 1 && !podsEdited.value ? shotCount(r) : maxPods.value, cost_cap_usd: each } : {}) })
    }
    open.value = false; ui.queueOpen = true   // the Queue shows what it queued
  } catch (e) { error.value = errorText(e) } finally { starting.value = false }
}
</script>

<style scoped>
.round-list { max-height: 12rem; overflow: auto; }
</style>
