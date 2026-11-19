<template>
  <div v-if="active" class="border rounded p-2 mt-2" data-testid="publish-return">
    <label class="small fw-semibold mb-0" for="pub-round">{{ $t('publish.ret.round') }}</label>
    <BFormInput id="pub-round" :model-value="round" size="sm" class="font-monospace" list="pub-rounds" autocomplete="off" placeholder="qc_2026-11-02_r01" data-testid="publish-round" @update:model-value="$emit('update:round', String($event).trim())" />
    <datalist id="pub-rounds"><option v-for="r in rounds" :key="r.name" :value="r.name" data-testid="publish-round-suggestion" /></datalist>
    <div v-if="!round" class="small text-warning" data-testid="publish-round-hint">{{ $t('publish.ret.roundNeeded') }}</div>
    <div v-else-if="roundProblem(round)" class="small text-danger" data-testid="publish-round-error">{{ $t('publish.ret.roundBad') }}</div>
    <div class="small font-monospace text-body-secondary mt-1" data-testid="publish-return-dest">{{ dest }}</div>
    <div v-if="edlNeeded && edl.seen && !edl.old && !edl.loaded" class="d-flex align-items-center gap-2 small text-warning mt-2" data-testid="edl-none-line"><span>{{ $t('edl.noneLine') }}</span><BButton size="sm" variant="outline-primary" :disabled="edl.loading" data-testid="edl-none-load" @click="edl.load()"><BSpinner v-if="edl.loading" small class="me-1" />{{ $t('edl.load') }}</BButton></div>
    <div v-if="stems.length" class="mt-2" data-testid="publish-clipnames">
      <div class="small fw-semibold">{{ $t('publish.ret.clipNames') }}</div>
      <div v-for="s in stems" :key="s" class="mb-1">
        <input type="text" class="form-control form-control-sm font-monospace" :value="clipNames[s] ?? s" :list="edlOn ? `pub-edl-${s}` : undefined" :aria-label="$t('publish.ret.clipFor', { name: s })" data-testid="publish-clip-name" :data-stem="s" @input="setName(s, $event.target.value)" />
        <datalist v-if="edlOn" :id="`pub-edl-${s}`"><option v-for="e in edl.forShot(shotOfClip(s))" :key="e.clip" :value="e.clip" /></datalist>
        <div v-if="edlOn" class="small text-body-secondary" data-testid="publish-clip-match" :data-match="edl.matchOf(clipNames[s] ?? s)">{{ edl.matchOf(clipNames[s] ?? s) === 'match' ? $t('edl.matches') : $t('edl.notIn') }}</div>
        <div v-if="clipProblem(clipNames[s] ?? s)" class="small text-danger" data-testid="publish-clip-name-error">{{ $t(`outputs.render.${clipProblem(clipNames[s] ?? s)}`) }}</div>
        <div v-else-if="(clipNames[s] ?? s) !== s" class="small text-body-secondary" data-testid="publish-clip-renamed">{{ $t('publish.ret.renamedFrom', { from: s }) }}</div>
      </div>
    </div>
    <div v-if="flagged.length" class="mt-2" data-testid="publish-seq-flags">
      <div v-if="blockedCount" class="small text-danger" data-testid="publish-blocked-summary">{{ $t(blockedCount === 1 ? 'edl.blockedOne' : 'edl.blocked', { n: blockedCount }) }}</div>
      <div v-for="r in flagged" :key="rowKey(r)" class="small mt-1" data-testid="publish-flagged-row" :data-stem="rowKey(r)"><span class="font-monospace">{{ rowKey(r) }}</span>
        <SeqFlags :flags="r.flags" :row="r" :stem="rowKey(r)" :override="!!overrides[rowKey(r)]" :candidates="cands[rowKey(r)] || r.candidates || []" @update:override="(v) => $emit('update:overrides', { ...overrides, [rowKey(r)]: v })" @pick="(c) => setName(rowKey(r), c)" /></div>
    </div>
    <div class="small text-body-secondary mt-1" data-testid="publish-manifest-line">{{ $t('publish.ret.manifest') }}</div>
    <details v-if="plan?.items?.length" class="small mt-1" data-testid="publish-plan-table"><summary>{{ $t('publish.ret.table', { n: plan.items.length }) }}</summary>
      <div v-for="(i, n) in plan.items.slice(0, 200)" :key="n" class="font-monospace text-break" data-testid="publish-plan-row" :data-path="i.path">{{ i.path }} <span class="text-body-secondary">→</span> <span data-testid="publish-plan-key">{{ i.s3_key }}</span><span v-if="i.renamed_from" class="text-body-secondary" data-testid="publish-plan-renamed"> · {{ $t('publish.ret.renamedNote', { from: i.renamed_from }) }}</span></div>
      <div v-if="plan.items.length > 200" class="text-body-secondary">{{ $t('publish.ret.more', { n: plan.items.length - 200 }) }}</div>
    </details>
  </div>
</template>

<script setup>
/**
 * ReturnLayout: the BKK return layout of a publish (docs/ADR-050, Kyle 2026-11-19): a Round name (required, suggestions from the bucket), where files land (returns/BKK/<round>/<shot>/<clip>/...), a clip name per DPX sequence
 * (the EDL name; frames on disk are never renamed), the manifest line and the plan's s3_key per item. Shown only when the core reports the layout `bkk-return` (an older core has neither the layout nor the Round).
 */
import { computed, onMounted, ref, watch } from 'vue'
import { publishAPI } from '../api/publish'
import { roundProblem } from '../utils/publish'
import { clipProblem } from '../utils/renders'
import { useEdlStore, shotOfClip } from '../stores/edl'
import { edlAPI } from '../api/edl'
import SeqFlags from './SeqFlags.vue'

const props = defineProps({ overrides: { type: Object, default: () => ({}) }, active: { type: Boolean, default: false }, round: { type: String, default: '' }, clipNames: { type: Object, default: () => ({}) }, stems: { type: Array, default: () => [] }, plan: { type: Object, default: null }, prefix: { type: String, default: '' } })
const emit = defineEmits(['update:round', 'update:clipNames', 'update:overrides'])
const edl = useEdlStore(), cands = ref({})
const edlOn = computed(() => edl.loaded && !edl.old)
const edlNeeded = computed(() => props.active)
onMounted(() => edl.ensure())
const rowKey = (r) => r.stem || r.name || ''
const rowsOf = computed(() => (Array.isArray(props.plan?.sequences) ? props.plan.sequences : []))
const flagged = computed(() => rowsOf.value.filter((r) => Array.isArray(r.flags) && r.flags.length))
const isBlocked = (r) => (r.flags || []).some((f) => f.level === 'block' && !(f.code === 'frames-differ-from-edl' && props.overrides[rowKey(r)]))
const blockedCount = computed(() => rowsOf.value.filter(isBlocked).length)
watch(flagged, async (rs) => { for (const r of rs) { const k = rowKey(r); if (!r.flags.some((f) => f.code === 'ambiguous-edl-element') || cands.value[k] || r.candidates?.length) continue; cands.value[k] = []; try { const l = await edlAPI.lookup({ clip: k }); cands.value[k] = (l.candidates || []).map((c) => (typeof c === 'string' ? c : c.clip)) } catch { /* none */ } } })
const rounds = ref([])
const load = async () => { try { rounds.value = await publishAPI.rounds() } catch { rounds.value = [] } }
onMounted(() => { if (props.active) load() })
watch(() => props.active, (a) => { if (a) load() })
const dest = computed(() => `${String(props.prefix || 'returns/BKK/').replace(/^\/+|\/+$/g, '')}/${props.round || '<round>'}/<shot>/<clip>/…`)
const setName = (stem, v) => emit('update:clipNames', { ...props.clipNames, [stem]: v })
</script>
