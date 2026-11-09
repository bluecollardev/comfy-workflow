<template>
  <BModal v-model="open" :title="$t('importRound.title')" size="lg" scrollable data-testid="import-round-modal" @hidden="open = false">
    <ol class="stepper mb-5" data-testid="import-round-steps">
      <li v-for="(label, i) in stepLabels" :key="i" class="stepper-item" :class="{ active: step === i + 1, done: step > i + 1 }">
        <button type="button" class="stepper-btn" :disabled="!canGoTo(i + 1)" :aria-current="step === i + 1 ? 'step' : undefined" data-testid="import-round-step" :data-step="i + 1" :data-active="step === i + 1" @click="goTo(i + 1)">
          <span class="stepper-dot"><i v-if="step > i + 1" class="fa-solid fa-check"></i><template v-else>{{ i + 1 }}</template></span>
          <span class="stepper-label">{{ label }}</span>
        </button>
      </li>
    </ol>
    <div v-if="error" class="alert alert-danger small py-2" data-testid="import-round-error">{{ error }}</div>

    <!-- 1. Choose rounds -->
    <template v-if="step === 1">
      <div class="drop-zone rounded p-3 mb-3 text-center small" :class="{ over: dragOver }" data-testid="import-round-drop" @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop">
        <i class="fa-solid fa-file-zipper me-2"></i>{{ staging ? $t('importRound.dropping') : $t('importRound.drop') }}
      </div>
      <div v-if="dropped.length" class="mb-3" data-testid="import-round-dropped">
        <div class="form-label small mb-1">{{ $t('importRound.droppedTitle') }}</div>
        <div v-for="d in dropped" :key="d.round" class="d-flex align-items-center gap-2 small border rounded p-2 mb-1" data-testid="import-round-dropped-row" :data-round="d.round">
          <span class="font-monospace flex-grow-1">{{ d.round }}</span>
          <span class="text-body-secondary">{{ $t('importRound.droppedSize', { files: d.files }) }}<template v-if="d.extracted"> · {{ $t('importRound.droppedZip') }}</template></span>
          <BButton variant="success" size="sm" class="py-0 text-nowrap" data-testid="import-round-dropped-import" @click="importDropped(d)"><i class="fa-solid fa-file-import me-1"></i>{{ $t('importRound.droppedImport') }}</BButton>
        </div>
        <div class="small text-body-secondary">{{ $t('importRound.droppedNote') }}</div>
      </div>
      <div class="form-label small mb-1">{{ $t('importRound.rounds') }}</div>
      <div class="border rounded p-2 round-list" data-testid="import-round-list">
        <div v-for="r in roundNamesList" :key="r" class="d-flex align-items-center gap-2 small" data-testid="import-round-option" :data-round="r">
          <input :id="`irr-${r}`" type="checkbox" class="form-check-input mt-0" :checked="chosen.has(r)" @change="toggleRound(r, $event.target.checked)" />
          <label :for="`irr-${r}`" class="font-monospace mb-0 flex-grow-1">{{ r }}</label>
          <BButton variant="outline-light" size="sm" class="py-0 text-nowrap" data-testid="import-round-browse" @click="browsing = r"><i class="fa-solid fa-folder-tree me-1"></i>{{ $t('importRound.browse') }}</BButton>
        </div>
        <div v-if="!roundNamesList.length" class="small text-body-secondary">{{ $t('importRound.noRounds') }}</div>
      </div>
      <div v-if="loadingPlan" class="small text-body-secondary mt-2" data-testid="import-round-loading">{{ $t('importRound.loadingPlan') }}</div>
    </template>

    <!-- 2. Choose shots -->
    <template v-else-if="step === 2">
      <div class="small fw-semibold mb-1">{{ $t('importRound.shots') }}</div>
      <div v-for="[r, pl] in plans" :key="r" class="mb-2" data-testid="import-round-group" :data-round="r">
        <div v-if="plans.size > 1" class="small text-body-secondary font-monospace">{{ r }}</div>
        <div v-for="s in pl.shots" :key="s" class="d-flex align-items-center gap-2 small" data-testid="import-round-shot" :data-shot="s">
          <input :id="`ir-${r}-${s}`" type="checkbox" class="form-check-input mt-0" :checked="picked.get(r)?.has(s)" @change="toggleShot(r, s, $event.target.checked)" />
          <label :for="`ir-${r}-${s}`" class="font-monospace mb-0">{{ s }}</label>
        </div>
      </div>
      <label class="d-flex align-items-center gap-2 small mt-3"><input v-model="runWorkflows" type="checkbox" class="form-check-input mt-0" data-testid="import-round-run" />{{ $t('importRound.runWorkflows') }}</label>
    </template>

    <!-- 3. Choose cards for the shots -->
    <template v-else>
      <div class="d-flex align-items-center gap-2 mb-2 small">
        <label class="mb-0" for="ir-card-all">{{ $t('importRound.cardAll') }}</label>
        <BFormSelect id="ir-card-all" :model-value="''" :options="cardOptions" size="sm" style="max-width: 24rem" data-testid="import-round-card-all" @update:model-value="setAllCards" />
      </div>
      <div v-for="[r, pl] in plans" :key="r" class="mb-2" data-testid="import-round-card-group" :data-round="r">
        <div v-if="plans.size > 1" class="small text-body-secondary font-monospace">{{ r }}</div>
        <div v-for="s in [...(picked.get(r) || [])]" :key="s" class="d-flex align-items-center gap-2 small mb-1" data-testid="import-round-card-row" :data-shot="s">
          <span class="font-monospace" style="min-width: 9rem">{{ s }}</span>
          <BFormSelect :model-value="cards[`${r}::${s}`] || ''" :options="cardOptions" size="sm" style="max-width: 24rem" data-testid="import-round-card" @update:model-value="(v) => setCard(r, s, v)" />
        </div>
      </div>
      <div class="small text-body-secondary mb-3">{{ $t('importRound.cardNote') }}</div>

      <div class="border rounded p-2 small" data-testid="import-round-estimate">
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
    </template>

    <template #footer>
      <div class="d-flex align-items-center gap-2 w-100 flex-wrap">
        <label class="mb-0 small" for="ir-by">{{ $t('importRound.approvedBy') }}</label>
        <BFormInput id="ir-by" v-model="approvedBy" size="sm" style="width: 16rem" :placeholder="$t('importRound.approvedByPlaceholder')" data-testid="import-round-approved-by" />
        <span v-if="!canStart" class="small text-body-secondary w-100 order-last" data-testid="import-round-hint">{{ hint }}</span>
        <div class="ms-auto d-flex gap-2">
          <BButton variant="outline-light" size="sm" @click="open = false">{{ $t('picker.cancel') }}</BButton>
          <BButton v-if="step > 1" variant="outline-light" size="sm" data-testid="import-round-back" @click="step--"><i class="fa-solid fa-arrow-left me-1"></i>{{ $t('importRound.back') }}</BButton>
          <BButton v-if="step < 3" variant="primary" size="sm" :disabled="!canNext" data-testid="import-round-next" @click="next">{{ $t('importRound.next') }}<i class="fa-solid fa-arrow-right ms-1"></i></BButton>
          <BButton variant="success" size="sm" :disabled="!canStart || starting" data-testid="import-round-start" @click="start"><i class="fa-solid fa-file-import me-1"></i>{{ $t('importRound.start') }}</BButton>
        </div>
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
import { podsAPI } from '../api/pods'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { useUiStore } from '../stores/ui'
import RoundFilesModal from './RoundFilesModal.vue'
import { useImportsStore } from '../stores/imports'

const ui = useUiStore()
const open = computed({ get: () => ui.importRoundOpen, set: (v) => { ui.importRoundOpen = v } })
const rounds = ref([]), chosen = ref(new Set()), plans = ref(new Map()), picked = ref(new Map()), runWorkflows = ref(true)
const dragOver = ref(false), staging = ref(false), dropped = ref([])
const imports = useImportsStore()
/** Files, folders and zips dragged from the desktop: copied (a zip extracted) into a new round folder on this PC. Needs the app for the real paths. */
async function onDrop(ev) {
  dragOver.value = false
  const paths = [...(ev.dataTransfer?.files || [])].map((f) => window.core?.files?.pathFor?.(f) || f.path || '').filter(Boolean)
  if (!paths.length) { error.value = t('importRound.dropNoPath'); return }
  staging.value = true; error.value = ''
  try { dropped.value = [...dropped.value, await panamaAPI.stageDrop(paths)] } catch (e) { error.value = errorText(e) } finally { staging.value = false }
}
/** A dropped round is imported into ComfyUI-Shared like any staged round: Import Shot Pack with its folder, planned first. No pods, no spend. */
function importDropped(d) {
  imports.folder = d.path; ui.importPod = null; ui.importSource = 'folder'; imports.makePlan(false)
  open.value = false; ui.importOpen = true
}
const step = ref(1)
const stepLabels = computed(() => [t('importRound.stepRounds'), t('importRound.stepShots'), t('importRound.stepCards')])
const cards = ref({})   // `${round}::${shot}` -> card key; absent = the pool
const gpuMenu = ref([])
const cardOptions = computed(() => [{ value: '', text: t('importRound.cardPool') }, ...gpuMenu.value.map((g) => ({ value: g.value, text: g.text }))])
const setCard = (r, s, v) => { const n = { ...cards.value }; v ? (n[`${r}::${s}`] = v) : delete n[`${r}::${s}`]; cards.value = n }
const setAllCards = (v) => { if (v === '' ) return; const n = { ...cards.value }; for (const [r, set] of picked.value) for (const s of set) n[`${r}::${s}`] = v; cards.value = n }
const cardsFor = (r) => Object.fromEntries([...(picked.value.get(r) || [])].filter((s) => cards.value[`${r}::${s}`]).map((s) => [s, cards.value[`${r}::${s}`]]))
const estimates = ref(new Map())   // round -> the plan for the shots and cards chosen (its estimate)
async function replan() {
  const m = new Map()
  try { for (const r of plans.value.keys()) m.set(r, await queueAPI.plan(r, { shots: [...(picked.value.get(r) || [])], cards: cardsFor(r), run_workflows: runWorkflows.value })) } catch (e) { error.value = errorText(e) }
  estimates.value = m
}
watch([cards, picked, runWorkflows], () => { if (step.value === 3) replan() }, { deep: true })
const canNext = computed(() => (step.value === 1 ? chosen.value.size > 0 && plans.value.size === chosen.value.size && !loadingPlan.value : totalShots.value > 0))
/** A finished step can be revisited; a later one only once the step before it is complete. */
const canGoTo = (n) => n <= step.value || (n === 2 ? canNext.value && step.value === 1 : n === 3 ? totalShots.value > 0 : false)
const goTo = async (n) => { if (!canGoTo(n)) return; step.value = n; if (n === 3) await replan() }
const next = async () => { step.value++; if (step.value === 3) await replan() }
const hint = computed(() => (!chosen.value.size ? t('importRound.hintPick') : step.value < 3 ? t('importRound.hintSteps') : !totalShots.value ? t('importRound.hintShots') : t('importRound.hintApprove')))
const browsing = ref('')   // the round whose files are open in the explorer
const podsEdited = ref(false)   // until the pod limit is typed, it follows the shots ticked: one pod per shot
const maxPods = ref(2), costCap = ref(50), approvedBy = ref(''), error = ref(''), loadingPlan = ref(false), starting = ref(false)
try { approvedBy.value = localStorage.getItem('runpod-manager.approved-by') || '' } catch { /* storage blocked */ }

const roundNamesList = computed(() => { const n = rounds.value.map((r) => r.name); for (const c of chosen.value) if (!n.includes(c)) n.push(c); return n })
const first = computed(() => [...plans.value.values()][0] || {})
const estimate = computed(() => Math.round([...plans.value.entries()].reduce((a, [r, p]) => a + ((estimates.value.get(r) || p).est_total_usd ?? 0) * ((picked.value.get(r)?.size || 0) > 0 ? 1 : 0), 0) * 100) / 100)
const shotCount = (r) => picked.value.get(r)?.size || 0
const totalShots = computed(() => [...plans.value.keys()].reduce((a, r) => a + shotCount(r), 0))
const canStart = computed(() => step.value === 3 && totalShots.value > 0 && approvedBy.value.trim().length > 0)

onMounted(async () => { try { gpuMenu.value = ((await podsAPI.gpus('')).gpus || []).filter((g) => g.value !== 'auto') } catch { /* the plain pool choice still works */ }
  try { const r = await panamaAPI.rounds(); rounds.value = Array.isArray(r) ? r : r.rounds || [] } catch (e) { error.value = errorText(e) } })
watch(() => ui.importRoundOpen, (o) => { if (o) step.value = 1; if (o && ui.importRoundPreset) { toggleRound(ui.importRoundPreset, true); ui.importRoundPreset = '' } }, { immediate: true })   // re-import: the round is already ticked
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
    const capOn = first.value.cap_enabled
    await queueAPI.importMany(todo.map((r) => ({ round: r, shots: [...picked.value.get(r)], cards: cardsFor(r), ...(capOn ? { max_pods: todo.length > 1 && !podsEdited.value ? shotCount(r) : maxPods.value } : {}) })), { run_workflows: runWorkflows.value, approved_by: approvedBy.value.trim(), ...(capOn ? { cost_cap_usd: costCap.value } : {}) })
    open.value = false; ui.queueOpen = true   // the Queue shows what it queued
  } catch (e) { error.value = errorText(e) } finally { starting.value = false }
}
</script>

<style scoped>
.stepper { display: flex; list-style: none; padding: 0; margin: 0; }
.stepper-item { flex: 1; position: relative; text-align: center; }
.stepper-item:not(:last-child)::after { content: ''; position: absolute; top: 15px; left: calc(50% + 22px); width: calc(100% - 44px); height: 2px; background: rgba(255, 255, 255, 0.2); }
.stepper-item.done:not(:last-child)::after { background: var(--bs-success); }
.stepper-btn { background: none; border: 0; padding: 0; color: var(--bs-secondary-color); display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; }
.stepper-btn:not(:disabled) { cursor: pointer; }
.stepper-dot { width: 32px; height: 32px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.3); display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.85rem; background: transparent; }
.stepper-item.active .stepper-dot { border-color: #508cff; background: #508cff; color: #fff; box-shadow: 0 0 0 4px rgba(80, 140, 255, 0.25); }
.stepper-item.done .stepper-dot { border-color: var(--bs-success); background: var(--bs-success); color: #fff; }
.stepper-item.active .stepper-label { color: var(--bs-body-color); font-weight: 600; }
.stepper-item.done .stepper-label { color: var(--bs-body-color); }
.stepper-label { font-size: 0.85rem; }
.drop-zone { border: 2px dashed rgba(255, 255, 255, 0.3); color: var(--bs-secondary-color); }
.drop-zone.over { border-color: #508cff; background: rgba(80, 140, 255, 0.12); color: inherit; }
.round-list { max-height: 12rem; overflow: auto; }
</style>
