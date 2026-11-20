<template>
  <BModal v-model="open" :title="$t('importRound.title')" size="lg" scrollable data-testid="import-round-modal" @hidden="open = false">
    <StepperNav testid="import-round" :steps="stepItems" :active="step" @go="goTo" />
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
      <div class="d-flex align-items-center gap-2 small mb-2" data-testid="import-round-source-row">   <!-- where the rounds come from (ADR-044): BH, and later a volume -->
        <label for="irr-source" class="form-label mb-0">{{ $t('importRound.source') }}</label>
        <BFormSelect id="irr-source" v-model="source" :options="sourceOptions" size="sm" style="max-width: 22rem" data-testid="import-round-source" />
        <span v-if="sourceInfo && !sourceInfo.available && sourceInfo.reason" class="text-warning" data-testid="import-round-source-reason">{{ sourceInfo.reason }}</span>
      </div>
      <div v-if="isVolume" class="small mb-2" data-testid="import-round-source-volume-row">   <!-- ADR-044: which volume the rounds sit on; read-only, in place -->
        <div class="d-flex align-items-center gap-2">
          <label for="irr-src-vol" class="form-label mb-0">{{ $t('importRound.sourceVolume') }}</label>
          <BFormSelect id="irr-src-vol" v-model="sourceVolumeId" :options="sourceVolumeOptions" size="sm" style="max-width: 30rem" data-testid="import-round-source-volume" />
        </div>
        <div class="text-body-secondary mt-1" data-testid="import-round-source-volume-note">{{ $t('importRound.sourceVolumeNote') }}</div>
        <div v-if="sourceStatus.reason && !sourceStatus.available" class="text-warning mt-1" data-testid="import-round-volume-reason"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ sourceStatus.reason }}</div>
        <div v-if="loadingRounds" class="text-body-secondary mt-1" data-testid="import-round-listing"><BSpinner small class="me-2" />{{ $t('importRound.listing') }}</div>
      </div>
      <div class="form-label small mb-1">{{ $t('importRound.rounds') }}</div>
      <label v-if="selectable.length > 1" class="d-flex align-items-center gap-2 small mb-1 select-all-row select-all-in-list" for="irr-all">   <!-- above the checkbox column of the list -->
        <input id="irr-all" type="checkbox" class="form-check-input mt-0" :checked="allChosen" :indeterminate.prop="chosen.size > 0 && !allChosen" data-testid="import-round-select-all" @change="toggleAll($event.target.checked)" />{{ $t('importRound.selectAll') }}
      </label>
      <div class="border rounded p-2 round-list" data-testid="import-round-list">
        <template v-for="r in roundNamesList" :key="r">
        <div class="d-flex align-items-center gap-2 small round-row" data-testid="import-round-option" :data-round="r">
          <input :id="`irr-${r}`" type="checkbox" class="form-check-input mt-0" :checked="chosen.has(r)" :disabled="isVolume && itemOf(r) && itemOf(r).importable === false" @change="toggleRound(r, $event.target.checked)" />
          <label :for="`irr-${r}`" class="font-monospace mb-0 flex-grow-1">{{ r }}</label>
          <template v-if="isVolume && itemOf(r)">
            <span v-if="itemOf(r).note" class="text-body-secondary" data-testid="import-round-note">{{ $t('importRound.notRound') }}</span>
            <span v-else class="text-body-secondary text-nowrap" data-testid="import-round-counts">{{ $t('importRound.shotsCount', { n: itemOf(r).shots.length }) }} · {{ $t('importRound.graphsCount', { n: itemOf(r).graphs ?? 0 }) }}<template v-if="itemOf(r).locked?.length"> · {{ $t('importRound.lockedCount', { n: itemOf(r).locked.length }) }}</template></span>
            <BButton v-if="itemOf(r).importable !== false || itemOf(r).shots.length" variant="outline-light" size="sm" class="py-0 text-nowrap" :disabled="checking.has(r)" data-testid="import-round-check-models" @click="checkModels(r)"><i class="fa-solid fa-clipboard-check me-1"></i>{{ $t('importRound.checkModels') }}</BButton>
          </template>
          <BButton v-else variant="outline-light" size="sm" class="py-0 text-nowrap" data-testid="import-round-browse" @click="browsing = r"><i class="fa-solid fa-folder-tree me-1"></i>{{ $t('importRound.browse') }}</BButton>
        </div>
        <div v-if="models[r]" class="small ps-4 pb-1" data-testid="import-round-models" :data-round="r">
          <div v-if="models[r].error" class="text-danger">{{ models[r].error }}</div>
          <div v-else-if="!models[r].missing_total" class="text-success">{{ $t('importRound.modelsOk', { n: models[r].checked }) }}</div>
          <template v-else>
            <div class="text-warning">{{ $t('importRound.modelsMissing', { n: models[r].missing_total, graphs: models[r].checked }) }}</div>
            <div v-for="m in models[r].list" :key="m.graph + m.name" class="font-monospace text-body-secondary" data-testid="import-round-model-miss">{{ m.name }} ({{ m.node_type }}): {{ m.elsewhere.length ? $t('importRound.modelsElsewhere', { where: m.elsewhere.join(', '), reads: m.reads.join(' / ') }) : $t('importRound.modelsNowhere', { reads: m.reads.join(' / ') }) }}</div>
          </template>
        </div>
        <div v-if="rowErrors[r]" class="small text-danger pb-1 ps-4" data-testid="import-round-row-error" :data-round="r">{{ rowErrors[r] }}</div>
        </template>
        <div v-if="!roundNamesList.length && !loadingRounds" class="small text-body-secondary">{{ isVolume ? $t('importRound.noRoundsVolume') : $t('importRound.noRounds') }}</div>
      </div>
    </template>

    <!-- 2. Choose shots -->
    <template v-else-if="step === 2">
      <div class="small fw-semibold mb-1">{{ isVolume ? $t('importRound.shotsVolume') : $t('importRound.shots') }}</div>
      <label v-if="allShots.length > 1" class="d-flex align-items-center gap-2 small mb-1" for="irs-all">   <!-- above the checkbox column of the shots -->
        <input id="irs-all" type="checkbox" class="form-check-input mt-0" :checked="allShotsPicked" :indeterminate.prop="pickedCount > 0 && !allShotsPicked" data-testid="import-round-shots-select-all" @change="toggleAllShots($event.target.checked)" />{{ $t('importRound.selectAll') }}
      </label>
      <div v-for="r in [...chosen]" :key="r" class="mb-2" data-testid="import-round-group" :data-round="r">
        <div v-if="chosen.size > 1 || pending.has(r)" class="small text-body-secondary font-monospace">{{ r }}</div>
        <div v-if="pending.has(r)" class="small text-body-secondary" data-testid="import-round-reading"><BSpinner small class="me-2" />{{ $t('importRound.loadingPlan') }}</div>
        <div v-for="s in plans.get(r)?.shots || []" :key="s" class="d-flex align-items-center gap-2 small round-row" data-testid="import-round-shot" :data-shot="s">
          <input :id="`ir-${r}-${s}`" type="checkbox" class="form-check-input mt-0" :checked="picked.get(r)?.has(s)" @change="toggleShot(r, s, $event.target.checked)" />
          <label :for="`ir-${r}-${s}`" class="font-monospace mb-0 flex-grow-1">{{ s }}</label>
          <BButton variant="outline-light" size="sm" class="py-0 text-nowrap" data-testid="import-round-shot-browse" @click="browsing = r; browsingShot = s"><i class="fa-solid fa-folder-tree me-1"></i>{{ $t('importRound.browse') }}</BButton>
        </div>
        <div v-for="s in plans.get(r)?.locked || []" :key="`lock-${s}`" class="d-flex align-items-center gap-2 small round-row" data-testid="import-round-shot-locked" :data-shot="s" :title="$t('importRound.referenceOnlyWhy')">
          <input :id="`ir-${r}-${s}`" type="checkbox" class="form-check-input mt-0" disabled />
          <label :for="`ir-${r}-${s}`" class="font-monospace mb-0 flex-grow-1 text-body-secondary">{{ s }}</label>
          <span class="badge text-bg-warning" data-testid="import-round-reference-only"><i class="fa-solid fa-lock me-1"></i>{{ $t('importRound.referenceOnly') }}</span>
        </div>
      </div>
    </template>

    <!-- 3. Choose cards for the shots, and the volume -->
    <template v-else>
      <!-- Choose Card: a button that opens the same card and datacenter table as Create Pod, in a window of its own -->
      <div v-if="runWorkflows || isVolume" class="d-flex align-items-center gap-2 mb-3 flex-wrap" data-testid="import-round-choose-card">
        <BButton :variant="allCards.length ? 'outline-success' : 'outline-light'" size="sm" data-testid="import-round-choose-card-btn" @click="cardModal = true"><i class="fa-solid fa-microchip me-1"></i>{{ $t('importRound.cardAll') }}</BButton>
        <span v-if="allCards.length" class="small" data-testid="import-round-chosen-card"><strong>{{ allCardLabel }}</strong><span class="text-body-secondary"> · {{ dcChoice }}</span></span>
        <span v-else class="small text-body-secondary">{{ $t('importRound.chooseCardNone') }}</span>
        <div v-if="allCards.length > 1" class="w-100 small text-body-secondary" data-testid="import-round-same-card-first">{{ $t('importRound.sameCardFirst') }}</div>
      </div>
      <div v-if="runWorkflows || isVolume" class="small mb-3" data-testid="import-round-autosync-block">
        <label class="d-flex align-items-center gap-2"><input v-model="autoSync" type="checkbox" class="form-check-input mt-0" data-testid="import-round-autosync" /><i class="fa-solid fa-cloud-arrow-down"></i>{{ $t('importRound.autoSync') }}</label>
        <label v-if="autoSync" class="d-flex align-items-center gap-2 ps-4 mt-1"><input v-model="autoSyncPush" type="checkbox" class="form-check-input mt-0" data-testid="import-round-autosync-push" />{{ $t('importRound.autoSyncPush') }}</label>
        <div class="text-body-secondary ps-4" data-testid="import-round-autosync-hint">{{ $t('importRound.autoSyncHint') }}</div>
        <label class="d-flex align-items-center gap-2 mt-2"><input :checked="generateOutputs" type="checkbox" class="form-check-input mt-0" data-testid="import-round-generate" @change="onGenerate" /><i class="fa-solid fa-film"></i>{{ $t('importRound.generate') }}</label>
        <div class="text-body-secondary ps-4" data-testid="import-round-generate-hint">{{ $t('importRound.generateHint') }}</div>
        <template v-if="generateOutputs">
          <label class="d-flex align-items-center gap-2 mt-2"><input :checked="publishOut" type="checkbox" class="form-check-input mt-0" :disabled="!pubReady.ok" data-testid="import-round-publish" @change="onPublish" /><i class="fa-solid fa-cloud-arrow-up"></i>{{ $t('importRound.publish') }}</label>
          <div v-if="!pubReady.ok" class="text-warning ps-4" data-testid="import-round-publish-reason"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('importRound.publishNotReady', { reason: pubReady.reason }) }}</div>
          <div v-else class="text-body-secondary ps-4" data-testid="import-round-publish-hint">{{ $t('importRound.publishHint') }}</div>
        </template>
        <div v-if="nameNeeded" class="text-warning mt-2" data-testid="import-round-name-needed"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('importRound.needsName') }}</div>
      </div>
      <div class="border rounded p-2 small mb-3" data-testid="import-round-estimate">
        <template v-if="isVolume">
          <div data-testid="import-round-inplace">{{ $t('importRound.inPlace') }}</div>
          <div>{{ $t('importRound.price', { price: first.price_per_hour ?? '?' }) }}</div>
          <div data-testid="import-round-vol-estimate">{{ $t('importRound.volEstimate', { usd: estimate, graphs: volGraphs }) }}</div>
          <div class="text-body-secondary" data-testid="import-round-assumption">{{ $t('importRound.assumption') }} {{ [...estimates.values()][0]?.assumption || first.assumption }}</div>
          <div v-if="remainingUsd != null" class="text-body-secondary" data-testid="import-round-remaining">{{ $t('importRound.remaining', { usd: remainingUsd }) }}</div>
        </template>
        <template v-else>
        <div>{{ $t('importRound.price', { price: first.price_per_hour ?? '?' }) }}</div>
        <div>{{ $t('importRound.estimate', { usd: estimate }) }}</div>
        </template>
        <div v-if="autoSync" data-testid="import-round-autosync-line">{{ $t(autoSyncPush ? 'importRound.autoSyncLinePush' : 'importRound.autoSyncLine') }}</div>
        <div v-if="generateOutputs" data-testid="import-round-generate-line">{{ $t('importRound.generateLine') }}</div>
        <div v-if="publishOut" data-testid="import-round-publish-line">{{ $t('importRound.publishLine', { by: approvedBy.trim() || '?' }) }}</div>
        <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
          <label class="mb-0" for="ir-pods">{{ $t(plans.size > 1 ? 'importRound.maxPodsEach' : 'importRound.maxPods') }}</label>
          <BFormInput id="ir-pods" v-model.number="maxPods" type="number" min="1" max="20" size="sm" style="width: 5rem" data-testid="import-round-max-pods" @input="podsEdited = true" />
          <div class="w-100 text-body-secondary" data-testid="import-round-pods-note">{{ $t('importRound.podsNote') }}</div>
          <template v-if="first.cap_enabled">
          <label class="mb-0 ms-2" for="ir-cap">{{ $t(plans.size > 1 ? 'importRound.costCapTotal' : 'importRound.costCap') }}</label>
          <BFormInput id="ir-cap" v-model.number="costCap" type="number" min="1" size="sm" style="width: 6rem" data-testid="import-round-cost-cap" />
          </template>
        </div>
        <div v-if="!first.cap_enabled" class="text-warning mt-2" data-testid="import-round-cap-off"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('importRound.capOff') }}</div>
        <div v-if="isVolume && volOver" class="text-danger mt-1" data-testid="import-round-over-cap"><i class="fa-solid fa-ban me-1"></i>{{ $t('importRound.volOverCap') }}</div>
        <div v-else-if="first.cap_enabled && estimate > costCap" class="text-warning mt-1" data-testid="import-round-over-cap">{{ $t('importRound.overCap') }}</div>
      </div>
      <div v-if="isVolume" class="small mb-3" data-testid="import-round-volume-fixed">
        <span class="fw-semibold">{{ $t('importRound.volume') }}:</span> {{ sourceVolumeName }}
        <div v-if="volDcMismatch" class="text-warning mt-1" data-testid="import-round-vol-dc"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('importRound.volDcMismatch', { dc: sourceVolume?.datacenter }) }}</div>
      </div>
      <div v-else class="d-flex align-items-center gap-2 mb-3 small flex-wrap">
        <label class="mb-0 fw-semibold" for="ir-volume">{{ $t('importRound.volume') }}</label>
        <BFormSelect id="ir-volume" v-model="volumeId" :options="volumeOptions" size="sm" style="max-width: 30rem" data-testid="import-round-volume" />
        <div v-if="dcChoice && volumesIn(dcChoice).length" class="w-100" data-testid="import-round-dc-volumes">   <!-- after a card at a datacenter: the volumes that live there -->
          <div class="text-body-secondary mb-1">{{ $t('importRound.volumesIn', { dc: dcChoice }) }}</div>
          <div class="d-flex flex-wrap gap-2">
            <BButton v-for="v in volumesIn(dcChoice)" :key="v.id" size="sm" :variant="volumeId === v.id ? 'primary' : 'outline-light'" :aria-pressed="volumeId === v.id" data-testid="import-round-dc-volume" :data-volume="v.id" @click="volumeId = v.id">
              <i class="fa-solid fa-hard-drive me-1"></i>{{ v.name }} · {{ v.size_gb }} GB<template v-if="v.is_default"> · {{ $t('importRound.volumeDefault') }}</template>
            </BButton>
          </div>
        </div>
        <div v-if="dcNoVolume" class="w-100" data-testid="import-round-dc-novolume">
          <div class="text-warning mb-1"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('importRound.dcNoVolume', { dc: dcChoice }) }}</div>
          <label class="d-flex align-items-center gap-2 mb-1"><input v-model="createVol" type="checkbox" class="form-check-input mt-0" data-testid="import-round-create-volume" />{{ $t('importRound.createVolume', { dc: dcChoice }) }}</label>
          <div v-if="createVol" class="d-flex align-items-center gap-2 flex-wrap ps-4" data-testid="import-round-new-volume">
            <BFormInput v-model="newVolName" size="sm" style="max-width: 18rem" maxlength="60" :aria-label="$t('importRound.newVolumeName')" data-testid="import-round-new-volume-name" />
            <BFormInput v-model.number="newVolSize" type="number" min="10" max="4000" size="sm" style="width: 6rem" :aria-label="$t('importRound.newVolumeSize')" data-testid="import-round-new-volume-size" /> GB
            <span class="text-body-secondary" data-testid="import-round-new-volume-cost">{{ $t('importRound.newVolumeCost', { usd: newVolCost }) }}</span>
          </div>
        </div>
        <div v-else-if="volumeProblem" class="text-warning w-100" data-testid="import-round-volume-problem"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ volumeProblem }}</div>
        <div v-else-if="volumeId && volumeId !== defaultVolume" class="text-body-secondary w-100" data-testid="import-round-volume-note">{{ $t('importRound.volumeNote') }}</div>
      </div>
      <label v-if="!isVolume" class="d-flex align-items-center gap-2 small mb-3"><input v-model="runWorkflows" type="checkbox" class="form-check-input mt-0" data-testid="import-round-run" />{{ $t('importRound.runWorkflows') }}</label>
      <div v-if="!runWorkflows && !isVolume" class="small text-body-secondary mb-3" data-testid="import-round-no-cards">{{ $t('importRound.noCards') }}</div>
    </template>

    <template #footer>
      <div class="d-flex align-items-center gap-2 w-100 flex-wrap">
        <label class="mb-0 small" for="ir-by">{{ $t('importRound.approvedBy') }}</label>
        <BFormInput id="ir-by" v-model="approvedBy" size="sm" style="width: 16rem" :placeholder="$t('importRound.approvedByPlaceholder')" data-testid="import-round-approved-by" />
        <span v-if="!canStart" class="small text-body-secondary w-100 order-last" data-testid="import-round-hint">{{ hint }}</span>
        <div class="ms-auto d-flex gap-2">
          <BButton variant="outline-light" size="sm" @click="open = false">{{ $t('picker.cancel') }}</BButton>
          <BButton v-if="step > 1" variant="outline-light" size="sm" data-testid="import-round-back" @click="step--"><i class="fa-solid fa-arrow-left me-1"></i>{{ $t('importRound.back') }}</BButton>
          <BButton v-if="step < 3" variant="primary" size="sm" :class="{ blocked: !canNext }" data-testid="import-round-next" @click="next">{{ $t('importRound.next') }}<i class="fa-solid fa-arrow-right ms-1"></i></BButton>
          <BButton variant="success" size="sm" :disabled="!canStart || starting" data-testid="import-round-start" @click="start"><i class="fa-solid fa-file-import me-1"></i>{{ $t('importRound.start') }}</BButton>
        </div>
      </div>
    </template>
    <ChooseCardModal :show="cardModal" :list="dcList" :loading="dcLoading" :datacenter="dcChoice" :cards="allCards" :card-label="allCardLabel" :volume-dcs="volumeDcs" :default-dc="isVolume ? (sourceVolume?.datacenter || '') : ''" @close="cardModal = false" @refresh="loadDcs(true)" @update:datacenter="dcChoice = $event" @pick="onPickCard" @auto="clearAllCards" />
    <RoundFilesModal :round="browsing" :shot="browsingShot" target="local" @close="browsing = ''; browsingShot = ''" />
  </BModal>
</template>

<script setup>
/**
 * Import Round(s) (ADR-038): tick one or more rounds, see their shots, the pods and the estimate with the caps, approve once. Starting queues, for each round, a pull and one run per shot; pool pods take them (see the Queue).
 * Each round is its own import in the queue; the dollar cap entered is the total and is split evenly between the rounds, so the sum never passes it.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { panamaAPI } from '../api/panama'
import { libraryAPI } from '../api/library'
import { queueAPI } from '../api/queue'
import { podsAPI } from '../api/pods'
import { volumesAPI } from '../api/volumes'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { useUiStore } from '../stores/ui'
import RoundFilesModal from './RoundFilesModal.vue'
import ChooseCardModal from './ChooseCardModal.vue'
import StepperNav from './StepperNav.vue'
import { useImportsStore } from '../stores/imports'
import { usePublishStore } from '../stores/publish'
import { targetState } from '../utils/publish'

const ui = useUiStore()
const open = computed({ get: () => ui.importRoundOpen, set: (v) => { ui.importRoundOpen = v } })
const rounds = ref([]), chosen = ref(new Set()), plans = ref(new Map()), picked = ref(new Map()), runWorkflows = ref(false)
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
const rowErrors = ref({})   // round -> why it cannot be ticked (no shots in it, or its plan failed)
const step = ref(1)
const stepLabels = computed(() => [t('importRound.stepRounds'), t('importRound.stepShots'), t('importRound.stepCards')])
const stepItems = computed(() => stepLabels.value.map((label, i) => ({ label, done: stepDone(i + 1), blocked: !canGoTo(i + 1), why: stepWhy(i + 1) })))
const cards = ref({})   // `${round}::${shot}` -> the ordered card keys (the first free one is used); absent = the pool
const setAllCards = (list) => { if (!list.length) return; const n = { ...cards.value }; for (const [r, set] of picked.value) for (const s of set) n[`${r}::${s}`] = [...list]; cards.value = n }
const cardsFor = (r) => Object.fromEntries([...(picked.value.get(r) || [])].filter((s) => cards.value[`${r}::${s}`]).map((s) => [s, cards.value[`${r}::${s}`].length === 1 ? cards.value[`${r}::${s}`][0] : cards.value[`${r}::${s}`]]))
const estimates = ref(new Map())   // round -> the plan for the shots and cards chosen (its estimate)
async function replan() {
  const m = new Map()
  try { for (const r of plans.value.keys()) m.set(r, await queueAPI.plan(r, { shots: [...(picked.value.get(r) || [])], cards: cardsFor(r), run_workflows: runWorkflows.value, ...autoSyncKey(), ...outputsKey(), ...volumeOpts(), ...(isVolume.value && first.value.cap_enabled ? { cost_cap_usd: Math.round(costCap.value / Math.max(1, plans.value.size) * 100) / 100 } : {}) })) } catch (e) { error.value = errorText(e) }
  estimates.value = m
}
const canNext = computed(() => (step.value === 1 ? chosen.value.size > 0 : totalShots.value > 0 && !loadingPlan.value))
/** A finished step can be revisited; a later one only once the step before it is complete. */
/** A step shows green with a check once what it asks for is complete, wherever you are in the window: rounds chosen and read; shots chosen and gone past; a volume and an approver given. */
const reached = ref(1)
watch(step, (n) => { if (n > reached.value) reached.value = n })
watch(() => ui.importRoundOpen, (o) => { if (o) reached.value = 1 })
const stepDone = (n) => (n === 1 ? chosen.value.size > 0 : n === 2 ? stepDone(1) && totalShots.value > 0 && !loadingPlan.value && reached.value >= 3 : canStart.value)
/** Any step can be clicked, forwards or back, as long as what it needs is there: step 2 needs the rounds chosen and read, step 3 also a shot. */
const canGoTo = (n) => n === 1 || (n === 2 ? chosen.value.size > 0 : chosen.value.size > 0 && !loadingPlan.value && totalShots.value > 0)
const stepWhy = (n) => (n === 2 ? t('importRound.hintPick') : !chosen.value.size ? t('importRound.hintPick') : t('importRound.hintShots'))
const goTo = async (n) => { if (!canGoTo(n)) { error.value = stepWhy(n); return } error.value = ''; step.value = n; if (n === 3) { loadVolumes(); await replan() } }
const next = async () => { if (!canNext.value) { error.value = step.value === 2 && loadingPlan.value ? t('importRound.loadingPlan') : step.value === 1 ? t('importRound.hintPick') : t('importRound.hintShots'); return } error.value = ''; step.value++; if (step.value === 3) { loadVolumes(); await replan() } }
const hint = computed(() => (!chosen.value.size ? t('importRound.hintPick') : step.value < 3 ? t('importRound.hintSteps') : !isVolume.value && !volumeId.value ? t('importRound.volumeNone') : !totalShots.value ? t('importRound.hintShots') : t('importRound.hintApprove')))
const volumes = ref([]), volumeId = ref(''), defaultVolume = ref('')
// Choose Card (as in Create Pod): a card at a datacenter. The card goes to every shot; the datacenter picks the volume that lives there.
const cardModal = ref(false), dcList = ref([]), dcLoading = ref(false), dcChoice = ref(''), allCards = ref([]), cardsDc = ref(''), allCardLabel = ref('')   // allCards: [{ key, name, vram }] in click order, all of the datacenter dcChoice
async function loadDcs(fresh = false) { dcLoading.value = true; try { dcList.value = (await podsAPI.datacenters(fresh)).datacenters || [] } catch { /* the per-shot choices still work */ } finally { dcLoading.value = false } }
const volumesIn = (dc) => volumes.value.filter((v) => v.datacenter === dc)
const cardName = (c) => `${c.name}${c.vram ? ` ${c.vram} GB` : ''}`
/** A click on a card at a datacenter: the same datacenter toggles the card in the ranked list; another datacenter replaces the list (volumes and pods are pinned to one datacenter). The window stays open until Done. */
function onPickCard({ dc, card }) {
  if (card) {
    const same = !allCards.value.length || dc === cardsDc.value   // (the table has already moved dcChoice to this click's datacenter, so the selection's own is kept apart)
    const has = allCards.value.some((c) => c.key === card.key)
    allCards.value = same ? (has ? allCards.value.filter((c) => c.key !== card.key) : [...allCards.value, card]) : [card]
    cardsDc.value = allCards.value.length ? dc : ''
    syncCards()
  }
  if (isVolume.value) { dcChoice.value = dc || dcChoice.value; return }   // a volume round runs where its volume is: the card is chosen, the volume is not
  const vs = volumesIn(dc)
  if (dc && (card ? !volumes.value.some((v) => v.id === volumeId.value && v.datacenter === dc) : true)) volumeId.value = vs.length ? (vs.find((v) => v.is_default) || vs[0]).id : ''   // none there: no volume is chosen (a pod cannot leave its volume's datacenter), so Import waits for one
}
/** The label and every shot's list follow the ranked cards. */
function syncCards() {
  allCardLabel.value = allCards.value.map(cardName).join(', ')
  const n = { ...cards.value }; for (const [r, set] of picked.value) for (const sh of set) delete n[`${r}::${sh}`]; cards.value = n
  setAllCards(allCards.value.map((c) => c.key))
}
function clearAllCards() { allCards.value = []; cardsDc.value = ''; allCardLabel.value = ''; const n = { ...cards.value }; for (const [r, set] of picked.value) for (const sh of set) delete n[`${r}::${sh}`]; cards.value = n }
const dcNoVolume = computed(() => !!dcChoice.value && volumes.value.length > 0 && !volumesIn(dcChoice.value).length)
watch(volumeId, (id) => { if (isVolume.value) return; const v = volumes.value.find((x) => x.id === id); if (!v) return; if (allCards.value.length && dcChoice.value && v.datacenter !== dcChoice.value) clearAllCards(); dcChoice.value = v.datacenter })   // a volume elsewhere: the card was chosen at another datacenter, so it goes   // choosing a volume says where the pods will be
// No volume of yours in the card's datacenter: tick "Create a new volume" and Import makes it first (a volume costs per month, so it is the user's tick and the Approved by that count)
const createVol = ref(false), newVolName = ref(''), newVolSize = ref(250)
const newVolCost = computed(() => Math.round((Math.min(newVolSize.value || 0, 1000) * 0.07 + Math.max((newVolSize.value || 0) - 1000, 0) * 0.05) * 100) / 100)   // RunPod's price per GB per month, as in Volumes
const newVolOk = computed(() => createVol.value && dcNoVolume.value && newVolName.value.trim().length > 0 && Number.isInteger(newVolSize.value) && newVolSize.value >= 10 && newVolSize.value <= 4000)
watch(dcChoice, (dc) => { createVol.value = false; newVolName.value = dc ? `brynley-rounds-${dc.toLowerCase()}` : '' })
const volumeOptions = computed(() => [{ value: '', text: t('importRound.volumePick') }, ...volumes.value.map((v) => ({ value: v.id, text: `${v.name} · ${v.size_gb} GB · ${v.datacenter}${v.is_default ? ` · ${t('importRound.volumeDefault')}` : ''}` }))])
const volumeProblem = computed(() => (volumes.value.length && !volumeId.value ? t('importRound.volumeNone') : !volumes.value.length && volumesLoaded.value ? t('importRound.volumeNoneAtAll') : ''))
const volumesLoaded = ref(false)
async function loadVolumes() {
  try { volumes.value = await volumesAPI.list(); const d = volumes.value.find((v) => v.is_default); defaultVolume.value = d?.id || ''; if (!volumeId.value) volumeId.value = d?.id || (volumes.value.length === 1 ? volumes.value[0].id : '') } catch { /* the import says so if there is no volume */ } finally { volumesLoaded.value = true }
}
const browsingShot = ref('')   // with `browsing`: only that shot's folder
const browsing = ref('')   // the round whose files are open in the explorer
const podsEdited = ref(false)   // until the pod limit is typed, it follows the shots ticked: one pod per shot
const autoSync = ref(false), autoSyncPush = ref(false)   // Auto sync (ADR-046): pods this import creates get it; the key is sent only when ticked
const autoSyncOpt = computed(() => (autoSync.value ? (autoSyncPush.value ? { pull: true, push: true } : true) : undefined))
const autoSyncKey = () => (autoSyncOpt.value === undefined ? {} : { auto_sync: autoSyncOpt.value })
// Run Workflows > Generate Outputs > Publish: each child shows only under its parent, and unticking a parent clears its children
const generateOutputs = ref(false), publishOut = ref(false), nameNeeded = ref(false)
const publishStore = usePublishStore(), pubReady = computed(() => targetState(publishStore.settings, 's3'))
const outputsKey = () => ({ ...(generateOutputs.value ? { generate_outputs: true } : {}), ...(publishOut.value ? { publish: true } : {}) })
watch(runWorkflows, (on) => { if (!on && !isVolume.value) { autoSync.value = false; autoSyncPush.value = false; generateOutputs.value = false } })
watch(generateOutputs, (on) => { if (!on) publishOut.value = false })
/** Ticking either needs the name in Approved by first (they act under it): blocked in place, with the message. */
function tick(ev, ref_) { if (ev.target.checked && !approvedBy.value.trim()) { ev.target.checked = false; nameNeeded.value = true; return } nameNeeded.value = false; ref_.value = ev.target.checked }
const onGenerate = (ev) => tick(ev, generateOutputs), onPublish = (ev) => tick(ev, publishOut)
onMounted(() => { publishStore.loadSettings() })
const maxPods = ref(2), costCap = ref(50), approvedBy = ref(''), error = ref(''), starting = ref(false)
watch([cards, picked, runWorkflows, costCap, autoSyncOpt, generateOutputs, publishOut], () => { if (step.value === 3) replan() }, { deep: true })
const pending = ref(new Set())   // rounds whose plan is still being read (a big round takes seconds): step 2 can be opened meanwhile
const loadingPlan = computed(() => pending.value.size > 0)
try { approvedBy.value = localStorage.getItem('runpod-manager.approved-by') || '' } catch { /* storage blocked */ }
watch(() => approvedBy.value.trim(), (n) => { if (n) nameNeeded.value = false })

const roundNamesList = computed(() => { const n = rounds.value.map((r) => r.name); for (const c of chosen.value) if (!n.includes(c)) n.push(c); return n })
const first = computed(() => [...plans.value.values()][0] || {})
const estimate = computed(() => Math.round([...plans.value.entries()].reduce((a, [r, p]) => a + ((estimates.value.get(r) || p).est_total_usd ?? 0) * ((picked.value.get(r)?.size || 0) > 0 ? 1 : 0), 0) * 100) / 100)
const shotCount = (r) => picked.value.get(r)?.size || 0
const totalShots = computed(() => [...plans.value.keys()].reduce((a, r) => a + shotCount(r), 0))
const canStart = computed(() => step.value === 3 && (isVolume.value ? !!sourceVolumeId.value && !volOver.value && !volDcMismatch.value : !!volumeId.value || newVolOk.value) && totalShots.value > 0 && approvedBy.value.trim().length > 0)

// The rounds of the chosen source (ADR-044): every source answers in the one library item shape, whose `name` is what the rest of this window works with. BH is the only source so far.
const source = ref('panama-s3'), sources = ref([])
// A volume source (ADR-044): the rounds already sit on a network volume; they are listed read-only and run in place. Guards live in the core; the window shows them (locked shots disabled, the estimate against the cap).
const isVolume = computed(() => sourceInfo.value?.needs === 'volume')
const sourceVolumeId = ref(''), srcVolumes = ref([]), sourceStatus = ref({ available: true, reason: '' }), loadingRounds = ref(false)
const sourceVolume = computed(() => srcVolumes.value.find((v) => v.id === sourceVolumeId.value) || null)
/** The datacenters where the person has a network volume: a pod can only run where one lives, so Choose Card starts on these. */
const volumeDcs = computed(() => [...new Set((volumes.value.length ? volumes.value : srcVolumes.value).map((v) => v.datacenter).filter(Boolean))].sort())
const sourceVolumeName = computed(() => (sourceVolume.value ? `${sourceVolume.value.name} · ${sourceVolume.value.size_gb} GB · ${sourceVolume.value.datacenter}` : sourceVolumeId.value))
const sourceVolumeOptions = computed(() => [{ value: '', text: t('importRound.volumePick') }, ...srcVolumes.value.map((v) => ({ value: v.id, text: `${v.name} · ${v.size_gb} GB · ${v.datacenter}${v.is_shared ? ' · Shared' : v.is_default ? ` · ${t('importRound.volumeDefault')}` : ''}${v.s3 ? '' : ' · no S3'}` }))])
const volumeOpts = () => (isVolume.value ? { source: 'volume', volume_id: sourceVolumeId.value } : {})
const itemOf = (r) => rounds.value.find((x) => x.name === r) || null
const volGraphs = computed(() => [...estimates.value.values()].reduce((a, p) => a + (p.graphs ?? 0), 0))
const remainingUsd = computed(() => [...estimates.value.values()][0]?.remaining_usd ?? null)
const volOver = computed(() => isVolume.value && ([...estimates.value.values()].some((p) => p.over_cap) || (first.value.cap_enabled && estimate.value > costCap.value)))
const volDcMismatch = computed(() => isVolume.value && !!dcChoice.value && !!sourceVolume.value && dcChoice.value !== sourceVolume.value.datacenter)
async function loadSourceVolumes() {
  try {
    srcVolumes.value = await volumesAPI.list()
    if (!sourceVolumeId.value) sourceVolumeId.value = (srcVolumes.value.find((v) => v.is_shared) || srcVolumes.value.find((v) => v.is_default) || srcVolumes.value.find((v) => v.s3) || srcVolumes.value[0])?.id || ''
  } catch (e) { error.value = errorText(e) }
}
// The preflight (ADR-044 decision 5): read-only, per round, on demand: a button, never all the graphs at once.
const models = ref({}), checking = ref(new Set())
async function checkModels(r) {
  checking.value = new Set(checking.value).add(r)
  try {
    const p = await libraryAPI.preflight(sourceVolumeId.value, r, {})
    models.value = { ...models.value, [r]: { checked: p.checked, missing_total: p.missing_total, list: p.graphs.flatMap((g) => g.missing.map((m) => ({ ...m, graph: g.graph }))) } }
  } catch (e) { models.value = { ...models.value, [r]: { error: errorText(e) } } } finally { const n = new Set(checking.value); n.delete(r); checking.value = n }
}
const sourceOptions = computed(() => (sources.value.length ? sources.value : [{ id: 'panama-s3', name: t('importRound.sourceBH') }]).map((s) => ({ value: s.id, text: s.name })))
const sourceInfo = computed(() => sources.value.find((s) => s.id === source.value) || null)
async function loadRounds() {
  const mine = source.value + '|' + sourceVolumeId.value
  loadingRounds.value = true
  try {
    if (isVolume.value) {
      if (!sourceVolumeId.value) { rounds.value = []; return }
      sourceStatus.value = await libraryAPI.status(source.value, { volume_id: sourceVolumeId.value })
      if (!sourceStatus.value.available) { rounds.value = []; return }   // no S3 keys or no S3 API there: say why, start no pod
    }
    const r = await libraryAPI.list(source.value, isVolume.value ? { volume_id: sourceVolumeId.value } : undefined)
    if (mine === source.value + '|' + sourceVolumeId.value) rounds.value = Array.isArray(r) ? r : r.rounds || []
  } catch (e) { error.value = errorText(e) } finally { loadingRounds.value = false }
}
function resetPicks() { chosen.value = new Set(); plans.value = new Map(); picked.value = new Map(); estimates.value = new Map(); rowErrors.value = {}; rounds.value = []; models.value = {}; error.value = '' }
watch(sourceVolumeId, (now, was) => { if (!isVolume.value || now === was) return; resetPicks(); loadRounds() })
watch(source, (now, was) => {   // another source: its own rounds, and nothing ticked from the last one
  if (now === was) return
  resetPicks()
  if (isVolume.value) { runWorkflows.value = true; loadSourceVolumes().then(() => { if (!sourceVolumeId.value) loadRounds() }) }   // the volume's own watcher loads the rounds once one is chosen
  else loadRounds()
})
onMounted(async () => { loadDcs()
  try { sources.value = (await libraryAPI.sources()) || [] } catch { sources.value = [] }   // the list is only for the dropdown: rounds still load without it
  await loadRounds() })
watch(() => ui.importRoundOpen, (o) => { if (o) step.value = 1; if (o && ui.importRoundPreset) { toggleRound(ui.importRoundPreset, true); ui.importRoundPreset = '' } }, { immediate: true })   // re-import: the round is already ticked
const followPods = () => { if (!podsEdited.value) maxPods.value = Math.min(20, Math.max(1, ...[...plans.value.keys()].map(shotCount))) }
/** Select all: every round that can be ticked (one refused for having no shots stays out); unticking clears them all. */
const selectable = computed(() => roundNamesList.value.filter((r) => !rowErrors.value[r]))
const allChosen = computed(() => selectable.value.length > 0 && selectable.value.every((r) => chosen.value.has(r)))
const toggleAll = (on) => { for (const r of on ? selectable.value.filter((x) => !chosen.value.has(x)) : [...chosen.value]) toggleRound(r, on) }
async function toggleRound(r, on) {
  const n = new Set(chosen.value); on ? n.add(r) : n.delete(r); chosen.value = n
  error.value = ''; { const e = { ...rowErrors.value }; delete e[r]; rowErrors.value = e }
  if (!on) { plans.value.delete(r); picked.value.delete(r); plans.value = new Map(plans.value); picked.value = new Map(picked.value); followPods(); return }
  pending.value = new Set(pending.value).add(r)
  try {
    const pl = await queueAPI.plan(r, volumeOpts())
    if (!chosen.value.has(r)) return
    if (!pl.shots?.length) { error.value = `${r}: ${t('importRound.noShots')}`; rowErrors.value = { ...rowErrors.value, [r]: t('importRound.noShots') }; const m = new Set(chosen.value); m.delete(r); chosen.value = m; return }   // nothing to run in it: say so on its row and leave it unticked
    plans.value = new Map(plans.value).set(r, pl); picked.value = new Map(picked.value).set(r, new Set(pl.shots))   // every shot ticked
    if (plans.value.size === 1) costCap.value = pl.cost_cap_usd ?? 50
    podsEdited.value = false; followPods()
  } catch (e) { error.value = `${r}: ${errorText(e)}`; rowErrors.value = { ...rowErrors.value, [r]: errorText(e) }; const m = new Set(chosen.value); m.delete(r); chosen.value = m } finally { const q = new Set(pending.value); q.delete(r); pending.value = q }
}
const allShots = computed(() => [...chosen.value].flatMap((r) => (plans.value.get(r)?.shots || []).map((s) => [r, s])))
const pickedCount = computed(() => allShots.value.filter(([r, s]) => picked.value.get(r)?.has(s)).length)
const allShotsPicked = computed(() => allShots.value.length > 0 && pickedCount.value === allShots.value.length)
function toggleAllShots(on) { const m = new Map(picked.value); for (const r of chosen.value) m.set(r, new Set(on ? plans.value.get(r)?.shots || [] : [])); picked.value = m; followPods() }
function toggleShot(r, s, on) { const m = new Map(picked.value); const n = new Set(m.get(r)); on ? n.add(s) : n.delete(s); m.set(r, n); picked.value = m; followPods() }
async function start() {
  starting.value = true; error.value = ''
  try { localStorage.setItem('runpod-manager.approved-by', approvedBy.value.trim()) } catch { /* storage blocked */ }
  const todo = [...plans.value.keys()].filter((r) => shotCount(r) > 0)
  const capOn = first.value.cap_enabled
  const items = todo.map((r) => ({ round: r, shots: [...picked.value.get(r)], cards: cardsFor(r), ...autoSyncKey(), max_pods: todo.length > 1 && !podsEdited.value ? shotCount(r) : Math.min(20, Math.max(1, Math.round(Number(maxPods.value)) || 1)) }))   // always sent: the pod limit is not the dollar cap (with the cap off it was dropped and the queue started as many pods as it liked)
  const makeVol = !isVolume.value && newVolOk.value ? { name: newVolName.value.trim(), size_gb: newVolSize.value, datacenter: dcChoice.value } : null
  const opts = { run_workflows: isVolume.value ? true : runWorkflows.value, volume_id: isVolume.value ? sourceVolumeId.value : volumeId.value, approved_by: approvedBy.value.trim(), ...autoSyncKey(), ...outputsKey(), ...(isVolume.value ? { source: 'volume' } : {}), ...(capOn ? { cost_cap_usd: costCap.value } : {}) }
  // The Queue opens at once and says it is queueing: reading and planning the rounds takes a while, and the button alone says nothing.
  ui.queueStartError = ''; ui.queueStarting = todo; open.value = false; ui.queueTab = 'imports'; ui.queueOpen = true
  try { if (makeVol) { const v = await volumesAPI.create(makeVol); opts.volume_id = v.id }; await queueAPI.importMany(items, opts) } catch (e) { ui.queueStartError = errorText(e) } finally { ui.queueStarting = []; ui.queueVersion++; starting.value = false }
}
</script>

<style scoped>
.drop-zone { border: 2px dashed rgba(255, 255, 255, 0.3); color: var(--bs-secondary-color); }
.drop-zone.over { border-color: #508cff; background: rgba(80, 140, 255, 0.12); color: inherit; }
.round-list { max-height: 14rem; overflow: auto; }
.select-all-in-list { padding-left: calc(0.5rem + 1px); }   /* the list's border and padding, so the box sits above the row boxes */
.round-row { padding: 0.3rem 0; }
.round-row { border-top: 1px solid rgba(255, 255, 255, 0.08); }
.round-row:first-child, [data-testid="import-round-group"] > :not(.round-row) + .round-row { border-top: 0; }
</style>
