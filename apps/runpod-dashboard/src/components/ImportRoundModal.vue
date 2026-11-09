<template>
  <BModal v-model="open" :title="$t('importRound.title')" size="lg" scrollable no-footer data-testid="import-round-modal" @hidden="open = false">
    <div v-if="error" class="alert alert-danger small py-2" data-testid="import-round-error">{{ error }}</div>
    <div class="mb-3">
      <label class="form-label small mb-1" for="ir-round">{{ $t('importRound.round') }}</label>
      <div class="d-flex gap-2">
        <BFormSelect id="ir-round" v-model="round" :options="roundOptions" size="sm" data-testid="import-round-select" @change="loadPlan" />
        <BButton variant="outline-light" size="sm" class="text-nowrap" :disabled="!round" data-testid="import-round-browse" @click="browsing = round"><i class="fa-solid fa-folder-tree me-1"></i>{{ $t('importRound.browse') }}</BButton>
      </div>
    </div>
    <div v-if="loadingPlan" class="small text-body-secondary" data-testid="import-round-loading">{{ $t('importRound.loadingPlan') }}</div>
    <template v-else-if="plan">
      <div class="small fw-semibold mb-1">{{ $t('importRound.shots') }}</div>
      <div class="mb-2">
        <div v-for="s in plan.shots" :key="s" class="d-flex align-items-center gap-2 small" data-testid="import-round-shot" :data-shot="s">
          <input :id="`ir-${s}`" type="checkbox" class="form-check-input mt-0" :checked="picked.has(s)" @change="toggle(s, $event.target.checked)" />
          <label :for="`ir-${s}`" class="font-monospace mb-0">{{ s }}</label>
        </div>
      </div>
      <label class="d-flex align-items-center gap-2 small mb-3"><input v-model="runWorkflows" type="checkbox" class="form-check-input mt-0" data-testid="import-round-run" />{{ $t('importRound.runWorkflows') }}</label>

      <div class="border rounded p-2 mb-3 small" data-testid="import-round-estimate">
        <div>{{ $t('importRound.price', { price: plan.price_per_hour ?? '?' }) }}</div>
        <div>{{ $t('importRound.estimate', { usd: plan.est_total_usd ?? '?' }) }}</div>
        <div v-if="plan.cap_enabled" class="d-flex align-items-center gap-2 mt-2 flex-wrap">
          <label class="mb-0" for="ir-pods">{{ $t('importRound.maxPods') }}</label>
          <BFormInput id="ir-pods" v-model.number="maxPods" type="number" min="1" max="20" size="sm" style="width: 5rem" data-testid="import-round-max-pods" @input="podsEdited = true" />
          <label class="mb-0 ms-2" for="ir-cap">{{ $t('importRound.costCap') }}</label>
          <BFormInput id="ir-cap" v-model.number="costCap" type="number" min="1" size="sm" style="width: 6rem" data-testid="import-round-cost-cap" />
        </div>
        <div v-else class="text-warning mt-2" data-testid="import-round-cap-off"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('importRound.capOff') }}</div>
        <div v-if="plan.cap_enabled && estimate > costCap" class="text-warning mt-1" data-testid="import-round-over-cap">{{ $t('importRound.overCap') }}</div>
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
 * Import Round (ADR-038): choose a round, see its shots, the pods and the estimate with the caps, approve once. Starting queues a pull and one run per shot; pool pods take them (see the Queue).
 */
import { computed, onMounted, ref } from 'vue'
import { panamaAPI } from '../api/panama'
import { queueAPI } from '../api/queue'
import { errorText } from '../stores/toast'
import { useUiStore } from '../stores/ui'
import RoundFilesModal from './RoundFilesModal.vue'

const ui = useUiStore()
const open = computed({ get: () => ui.importRoundOpen, set: (v) => { ui.importRoundOpen = v } })
const rounds = ref([]), round = ref(''), plan = ref(null), picked = ref(new Set()), runWorkflows = ref(true)
const browsing = ref('')   // the round whose files are open in the explorer
const podsEdited = ref(false)   // until the pod limit is typed, it follows the shots ticked: one pod per shot
const maxPods = ref(2), costCap = ref(50), approvedBy = ref(''), error = ref(''), loadingPlan = ref(false), starting = ref(false)
try { approvedBy.value = localStorage.getItem('runpod-manager.approved-by') || '' } catch { /* storage blocked */ }

const roundOptions = computed(() => [{ value: '', text: '-' }, ...rounds.value.map((r) => ({ value: r.name, text: r.name }))])
const estimate = computed(() => plan.value?.est_total_usd ?? 0)
const canStart = computed(() => !!plan.value && picked.value.size > 0 && approvedBy.value.trim().length > 0)

onMounted(async () => { try { const r = await panamaAPI.rounds(); rounds.value = Array.isArray(r) ? r : r.rounds || [] } catch (e) { error.value = errorText(e) } })
async function loadPlan() {
  plan.value = null; error.value = ''
  if (!round.value) return
  loadingPlan.value = true
  try { plan.value = await queueAPI.plan(round.value, {}); picked.value = new Set(plan.value.shots); podsEdited.value = false; maxPods.value = Math.min(20, Math.max(1, picked.value.size)); costCap.value = plan.value.cost_cap_usd ?? 50 }   // every shot ticked
  catch (e) { error.value = errorText(e) } finally { loadingPlan.value = false }
}
const toggle = (s, on) => { const n = new Set(picked.value); on ? n.add(s) : n.delete(s); picked.value = n; if (!podsEdited.value) maxPods.value = Math.min(20, Math.max(1, n.size)) }
async function start() {
  starting.value = true; error.value = ''
  try {
    try { localStorage.setItem('runpod-manager.approved-by', approvedBy.value.trim()) } catch { /* storage blocked */ }
    await queueAPI.import(round.value, { shots: [...picked.value], run_workflows: runWorkflows.value, approved_by: approvedBy.value.trim(), ...(plan.value.cap_enabled ? { max_pods: maxPods.value, cost_cap_usd: costCap.value } : {}) })
    open.value = false; ui.queueOpen = true   // the Queue shows what it queued
  } catch (e) { error.value = errorText(e) } finally { starting.value = false }
}
</script>
