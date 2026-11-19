<template>
  <div v-if="supported" data-testid="autopublish-existing">
    <BButton size="sm" variant="outline-primary" data-testid="autopublish-generate-existing" @click="openIt">{{ $t('autopublish.existing.button') }}</BButton>
    <div v-if="result" class="small text-success mt-1" data-testid="existing-result">{{ result }} <BButton variant="link" size="sm" class="p-0" data-testid="existing-open-generations" @click="ui.queueTab = 'generations'; ui.queueOpen = true">{{ $t('autopublish.existing.open') }}</BButton></div>
    <BModal :model-value="open" :title="$t('autopublish.existing.title')" size="lg" no-footer data-testid="existing-modal" @update:model-value="(v) => !v && cancel()">
      <div v-if="loading" class="d-flex align-items-center gap-2" data-testid="existing-loading"><BSpinner small />{{ $t('autopublish.existing.loading') }}</div>
      <div v-else-if="loadError" class="alert alert-danger py-1 px-2 small" data-testid="existing-load-error">{{ loadError }}</div>
      <template v-else-if="p">
        <div class="small" data-testid="existing-totals">{{ $t('autopublish.existing.totals', { n: (p.totals?.sequences ?? 0).toLocaleString('en-US'), frames: (p.totals?.frames ?? 0).toLocaleString('en-US'), gb: gb }) }}</div>
        <div class="small text-body-secondary" data-testid="existing-where">{{ whereText }} · {{ $t('autopublish.existing.preset', { preset: presetText }) }}</div>
        <div class="small text-body-secondary" data-testid="existing-today">{{ todayText }}</div>
        <div v-if="p.estimate_hours" class="small text-body-secondary" data-testid="existing-estimate">{{ $t('autopublish.existing.estimate', { h: p.estimate_hours }) }}</div>
        <div v-for="(n, i) in p.notes || []" :key="i" class="small text-body-secondary" data-testid="existing-note">{{ n }}</div>
        <div v-if="noPod" class="alert alert-warning py-1 px-2 small mt-2" data-testid="existing-no-pod">{{ $t('autopublish.existing.noPod') }}
          <label class="d-flex align-items-center gap-2 mb-0 mt-1"><input v-model="fallback" type="checkbox" class="form-check-input mt-0" data-testid="existing-fallback" />{{ $t('autopublish.existing.fallback') }}</label></div>
        <div v-if="!(p.sequences || []).length" class="text-body-secondary small mt-2" data-testid="existing-empty">{{ $t('autopublish.existing.none') }}</div>
        <div v-else class="mt-2">
          <div class="existing-list border rounded" :class="{ open: showAll }" data-testid="existing-list">
            <div v-for="s in shownSeqs" :key="s.stem" class="d-flex align-items-center gap-2 small px-2 py-1 border-bottom flex-wrap" data-testid="existing-seq" :data-stem="s.stem">
              <span class="font-monospace text-truncate" style="max-width: 20rem" :title="s.stem">{{ s.stem }}</span><span class="text-body-secondary">{{ $t('autopublish.existing.frames', { n: s.frames }) }}</span>
              <span v-if="s.source" class="badge text-bg-info fw-normal" data-testid="existing-source">{{ $t(s.source === 'volume' ? 'autopublish.sources.badgeVolume' : 'autopublish.sources.badgeLocal') }}</span>
              <span v-for="f in s.flags || []" :key="f.code" class="badge fw-normal" :class="f.level === 'block' ? 'text-bg-danger' : 'text-bg-warning'" data-testid="existing-flag" :title="f.message">{{ f.code }}</span></div>
          </div>
          <BButton v-if="(p.sequences || []).length > 8" variant="link" size="sm" class="p-0" data-testid="existing-more" @click="showAll = !showAll">{{ showAll ? $t('outputs.generate.showFewer') : $t('outputs.generate.showAll', { n: p.sequences.length }) }}</BButton>
        </div>
        <details v-if="(p.skipped || []).length" class="small mt-2" data-testid="existing-skipped"><summary>{{ $t('autopublish.watch.skipped', { n: p.skipped.length }) }}</summary>
          <div v-for="(s, i) in p.skipped" :key="i" data-testid="existing-skipped-row"><span class="font-monospace">{{ s.stem }}</span>: {{ s.reason }}</div></details>
        <div class="small text-body-secondary mt-2" data-testid="existing-approval-note">{{ $t('autopublish.existing.needsApproval') }}</div>
        <label class="small mb-0 mt-2" for="existing-approver">{{ $t('autopublish.gen.approver') }}<span v-if="p.where !== 'pod'" class="text-body-secondary"> ({{ $t('autopublish.existing.onlyPod') }})</span></label>
        <input id="existing-approver" :value="who" type="text" class="form-control form-control-sm" style="max-width: 18rem" autocomplete="off" data-testid="existing-approver" @input="who = $event.target.value" />
        <div v-if="p.where === 'pod' && !whoT" class="small text-warning" data-testid="existing-approver-hint">{{ $t('autopublish.gen.approverNeeded') }}</div>
      </template>
      <div v-if="error" class="alert alert-danger py-1 px-2 small mt-2 mb-0" data-testid="existing-error">{{ error }}</div>
      <div class="d-flex justify-content-end gap-2 mt-3">
        <BButton size="sm" variant="outline-light" data-testid="existing-cancel" @click="cancel">{{ $t('picker.cancel') }}</BButton>
        <BButton size="sm" variant="primary" :disabled="!canStart" data-testid="existing-start" @click="start"><BSpinner v-if="starting" small class="me-1" />{{ $t('autopublish.existing.start') }}</BButton>
      </div>
    </BModal>
  </div>
</template>

<script setup>
/**
 * GenerateExisting: "Generate for what is already there" (docs/ADR-050, v1.7.0): a one-time, confirmed action. The preview (free) lists what would be rendered, what is skipped and why, where, the preset, the day's limit and the hours;
 * Start (with the approver's name for a pod) starts them as ordinary render jobs on the Queue. It never starts a pod and never approves or publishes. Hidden on a core without it.
 */
import { computed, ref } from 'vue'
import { useAutopublishStore } from '../stores/autopublish'
import { useUiStore } from '../stores/ui'
import { errorText } from '../stores/toast'
import { t } from '../i18n'

const ap = useAutopublishStore(), ui = useUiStore()
const open = ref(false), loading = ref(false), starting = ref(false), p = ref(null), loadError = ref(''), error = ref(''), who = ref(''), fallback = ref(false), showAll = ref(false), result = ref('')
const supported = computed(() => { const g = ap.status?.generate; return !g || 'pending_existing' in g || 'existing_started' in g || !ap.status?.generate })
const whoT = computed(() => String(who.value || '').trim())
const gb = computed(() => { const b = p.value?.totals?.bytes ?? 0; return b >= 1e9 ? Math.round(b / 1e8) / 10 : Math.round(b / 1e7) / 100 })
const noPod = computed(() => p.value?.where === 'pod' && (!p.value?.pod || (p.value.pod.running === false && !p.value.pod.case)))
const whereText = computed(() => (p.value?.where === 'pod' ? (p.value.pod ? podCaseText(p.value.pod) : t('autopublish.gen.pod')) : t('autopublish.gen.local')))
const podCaseText = (pod) => (pod.case === 'resume' ? t('autopublish.existing.caseResume', { name: pod.name }) : pod.case === 'create' ? t('autopublish.existing.caseCreate', { card: pod.card || pod.gpu || '', price: pod.price_per_hour ?? '' }) : t('autopublish.existing.onPod', { name: pod.name, state: t(pod.running !== false ? 'autopublish.existing.running' : 'autopublish.existing.stopped') }))
const presetText = computed(() => t(p.value?.preset === 'tunnel' ? 'autopublish.gen.tunnel' : 'autopublish.gen.review'))
const todayText = computed(() => { const x = p.value || {}; return x.max_per_day == null ? t('autopublish.existing.todayNoMax', { n: x.today_started ?? 0 }) : t('autopublish.existing.today', { n: x.today_started ?? 0, max: x.max_per_day, deferred: x.remaining_after_today ?? 0 }) })
const shownSeqs = computed(() => (showAll.value ? p.value.sequences : p.value.sequences.slice(0, 8)))
const canStart = computed(() => !!p.value && (p.value.sequences || []).length > 0 && !starting.value && (p.value.where !== 'pod' || (!!whoT.value && (!noPod.value || fallback.value))) && (!noPod.value || p.value.where !== 'pod' || fallback.value))
async function openIt() {
  open.value = true; loading.value = true; loadError.value = ''; error.value = ''; p.value = null; showAll.value = false; fallback.value = false; result.value = ''
  who.value = ap.status?.standing?.approved_by || (() => { try { return localStorage.getItem('runpod-manager.approved-by') || '' } catch { return '' } })()
  try { p.value = await ap.generateExisting({ dry_run: true }) } catch (e) { loadError.value = errorText(e) } finally { loading.value = false }
}
const cancel = () => { open.value = false }
async function start() {
  starting.value = true; error.value = ''
  try {
    const r = await ap.generateExisting({ confirm: true, approved_by: whoT.value, ...(p.value.can_start_today != null ? { limit: p.value.can_start_today } : {}), ...(noPod.value && fallback.value ? { where: 'local' } : {}) })
    try { if (who.value) localStorage.setItem('runpod-manager.approved-by', who.value) } catch { /* storage blocked */ }
    result.value = t('autopublish.existing.started', { n: r.started ?? 0, m: r.deferred ?? 0 }); open.value = false
  } catch (e) { error.value = errorText(e) } finally { starting.value = false }
}
</script>

<style scoped>
.existing-list { max-height: 11rem; overflow: hidden; }
.existing-list.open { overflow-y: auto; }
</style>
