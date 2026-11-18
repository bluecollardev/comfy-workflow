<template>
  <div class="dc-table" :data-testid="testid" :data-value="modelValue">
    <div class="small mb-2" data-testid="dc-table-chosen">
      <span class="text-body-secondary">{{ $t('dc.chosen') }}</span>
      <strong class="font-monospace ms-1">{{ modelValue || anyLabel || $t('dc.none') }}</strong>
      <span v-if="cardLabel" class="ms-1" data-testid="dc-table-chosen-card">· <strong :data-testid="`${gpuTestid}-chosen`" :data-value="selectedCard || 'auto'">{{ cardLabel }}</strong>
        <button v-if="selectedCard" type="button" class="btn btn-sm btn-outline-light ms-2 py-0" :data-testid="`${gpuTestid}-auto`" @click="picked = { dc: '', key: '' }; emit('auto')">{{ $t('form.gpuAuto') }}</button>
      </span>
      <span v-if="chosen?.s3" class="badge text-bg-secondary fw-normal ms-1" :title="$t('config.cardsS3')">S3</span>
      <span v-if="modelValue && chosen?.cards?.length && !selectedCard" class="text-body-secondary ms-2" data-testid="dc-table-chosen-cards">{{ chosen.cards.map((c) => `${c.name}${c.vram ? ` ${c.vram} GB` : ''} ${c.stock}`).join(' · ') }}</span>
      <span v-else-if="modelValue && chosen" class="text-body-secondary ms-2" data-testid="dc-table-chosen-empty">{{ $t('dc.noneListed') }}</span>
    </div>
    <div class="d-flex align-items-center gap-3 mb-2 flex-wrap">
      <button v-if="anyLabel" type="button" class="btn btn-sm" :class="!modelValue ? 'btn-primary' : 'btn-outline-light'" data-testid="dc-any" @click="pickAny">{{ anyLabel }}</button>
      <select v-if="dcDropdown" v-model="dcSel" class="form-select form-select-sm dc-dc-select" :aria-label="$t('dc.filterDcLabel')" :title="$t('dc.filterDcLabel')" data-testid="dc-dc-filter" @change="onDc">
        <option v-for="o in dcOptions" :key="o.value" :value="o.value">{{ o.text }}</option>
      </select>
      <div class="input-group input-group-sm dc-filter">
        <input v-model="filter" type="text" class="form-control" :placeholder="$t('dc.filter')" :aria-label="$t('dc.filter')" data-testid="dc-filter" @keydown.esc="filter = ''" />
        <button v-if="filter" type="button" class="btn btn-outline-light" :title="$t('dc.filterClear')" :aria-label="$t('dc.filterClear')" data-testid="dc-filter-clear" @click="filter = ''"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <span class="small text-body-secondary">{{ filter ? $t('dc.filterCount', { n: shownRows.length, of: cardRows.length }) : $t('dc.summary', { n: freeDcs, cards: cardRows.length }) }}</span>
    </div>

    <div v-if="volumesNotListed" class="small text-warning mb-2" data-testid="dc-volumes-not-listed">{{ $t('dc.filterVolumesNone') }}</div>
    <!-- One list, by card: the biggest card first and where it is offered. Exactly one card at one datacenter is chosen. -->
    <div class="table-wrap" data-testid="dc-by-card">
      <div v-for="c in shownRows" :key="c.name" class="card-row" :class="{ chosen: (multi ? selectedCards.includes(c.key) : cardKey === c.key) && c.dcs.some((d) => d.value === modelValue) }" data-testid="dc-card-row" :data-card="c.name">
        <div class="d-flex align-items-baseline gap-2 flex-wrap">
          <strong>{{ c.name }}</strong>
          <span class="text-body-secondary small">{{ c.vram ? `${c.vram} GB` : '' }}</span>
          <span v-if="c.cuda === 13" class="badge text-bg-info fw-normal" :title="$t('dc.cu13Tip')" data-testid="dc-card-cu13">{{ $t('dc.cu13image') }}</span>
          <span v-if="!c.runs" class="badge text-bg-warning fw-normal" :title="$t(c.why === 'amd' ? 'dc.amdTip' : 'dc.needsNewImage')">{{ $t(c.why === 'amd' ? 'dc.amd' : 'dc.cuda13') }}</span>
          <span class="small text-body-secondary">{{ $t('dc.offeredIn', { n: c.dcs.length, free: c.free }) }}</span>
        </div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          <button v-for="d in c.dcs" :key="d.value" type="button" class="btn btn-sm dc-chip" :class="isChosen(d.value, c.key) ? 'btn-primary' : 'btn-outline-light'" :aria-pressed="isChosen(d.value, c.key)" :disabled="!c.runs" :title="c.runs ? '' : $t('dc.notPickable')" data-testid="dc-chip" :data-dc="d.value" :data-card="c.name" @click="pick(d.value, c)">
            <span class="font-monospace">{{ d.value }}</span><span v-if="d.s3" class="ms-1 small">S3</span><span class="ms-1 small">{{ d.price != null ? `$${d.price}/h` : '' }} {{ d.stock }}</span><span v-if="rankOf(d.value, c.key)" class="badge text-bg-warning ms-1" data-testid="dc-chip-rank" :title="$t('importRound.rankTitle')">{{ rankOf(d.value, c.key) }}</span>
          </button>
        </div>
      </div>
      <div v-if="!shownRows.length" class="small text-body-secondary p-2">{{ $t('dc.nothingListed') }}</div>
    </div>
  </div>
</template>

<script setup>
/**
 * DatacenterTable — the datacenter picker (ADR-026). Nothing is hidden: RunPod's own list of every card each datacenter runs, free or busy, NVIDIA and AMD.
 * Every card is shown whether it is free or in use (Lucas: "if we have to wait we have to wait"): stock is a label, never a reason to hide or dim. The list is by card: the biggest card first and every
 * datacenter that offers it, free ones first; one card at one datacenter is chosen. A Blackwell card is marked "CUDA 13 image" (it boots our -cu13 tag, ADR-030); a card outside our table, or an AMD one, is marked as such. A click chooses the datacenter (v-model); `anyLabel` adds an "Any" row.
 */
import { computed, ref, watch } from 'vue'
import { t } from '../i18n'
const props = defineProps({ list: { type: Array, default: () => [] }, modelValue: { type: String, default: '' }, anyLabel: { type: String, default: '' }, testid: { type: String, default: 'dc-table' }, selectedCard: { type: String, default: '' }, cardLabel: { type: String, default: '' }, gpuTestid: { type: String, default: 'dc-table-gpu' }, multi: { type: Boolean, default: false }, selectedCards: { type: Array, default: () => [] },
  /** A datacenter dropdown next to the text filter (Import Round's Choose Card). It starts on `defaultDc` (a datacenter to pin, e.g. where a volume round's volume lives), else on the datacenters of the person's own network volumes (`volumeDcs`; a pod can only run where a volume lives), else on all of them. */
  dcDropdown: { type: Boolean, default: false }, volumeDcs: { type: Array, default: () => [] }, defaultDc: { type: String, default: '' } })
const emit = defineEmits(['update:modelValue', 'pick', 'auto'])
/** A click chooses the datacenter and, on a card's chip or row, that card too: `pick` carries both ({ dc, card }), the v-model only the datacenter. */
const picked = ref({ dc: '', key: '' })   // the card last clicked here, for a form with no card of its own (the Configuration's datacenter)
const pick = (dc, card = null) => { picked.value = { dc, key: card?.key || '' }; emit('update:modelValue', dc); emit('pick', { dc, card: card && card.runs !== false ? { key: card.key, name: card.name, vram: card.vram } : null }) }
const pickAny = () => { picked.value = { dc: '', key: '' }; emit('update:modelValue', ''); emit('pick', { dc: '', card: null, any: true }) }
/** The chosen card: the form's, else the one clicked here at this datacenter. Exactly one card at one datacenter is marked, never all of a datacenter's. */
/** `multi` (Import Round's Choose Card): several cards of one datacenter, ranked in the order they were clicked; the parent owns the list and each click is a `pick` it toggles. */
const rankOf = (dc, key) => (props.multi && dc === props.modelValue ? props.selectedCards.indexOf(key) + 1 : 0)
const cardKey = computed(() => props.multi ? '' : props.selectedCard || (picked.value.dc === props.modelValue ? picked.value.key : ''))
const isChosen = (dc, key) => props.multi ? rankOf(dc, key) > 0 : !!cardKey.value && dc === props.modelValue && key === cardKey.value
const free = (c) => c.available !== false   // a list from an older core has no flag: every card in it was in stock
const freeIn = (d) => (d.cards || []).filter(free).length
const chosen = computed(() => props.list.find((d) => d.value === props.modelValue) || null)
const filter = ref('')
const VOLUMES = '__volumes'   // the dropdown's value for 'the datacenters of my volumes'
const dcSel = ref(props.defaultDc || (props.volumeDcs.length ? VOLUMES : ''))
// the default can arrive after the volumes are loaded: until the person touches the dropdown it follows the props
let dcTouched = false
watch(() => [props.defaultDc, props.volumeDcs.join(',')], () => { if (!dcTouched) dcSel.value = props.defaultDc || (props.volumeDcs.length ? VOLUMES : '') })
const onDc = () => { dcTouched = true }
/** The datacenters the table works from: all of them, only those of the person's volumes, or just one; the chosen datacenter is always in (a selection never vanishes). With nothing of the volumes listed it falls back to all and says so. */
const volumeMatches = computed(() => props.list.filter((d) => props.volumeDcs.includes(d.value)))
const baseList = computed(() => {
  if (!props.dcDropdown || !dcSel.value) return props.list
  const keep = dcSel.value === VOLUMES ? (volumeMatches.value.length ? volumeMatches.value : props.list) : props.list.filter((d) => d.value === dcSel.value)
  const chosenDc = props.list.find((d) => d.value === props.modelValue)
  return chosenDc && !keep.includes(chosenDc) ? [...keep, chosenDc] : keep
})
const volumesNotListed = computed(() => props.dcDropdown && dcSel.value === VOLUMES && !volumeMatches.value.length)
const dcOptions = computed(() => {
  const o = []
  if (props.volumeDcs.length) o.push({ value: VOLUMES, text: t('dc.filterVolumes', { list: props.volumeDcs.join(', ') }) })
  o.push({ value: '', text: t('dc.filterAllDcs', { n: props.list.length }) })
  for (const d of props.list) o.push({ value: d.value, text: `${d.value}${freeIn(d) ? ` · ${t('dc.freeCards', { n: freeIn(d) })}` : ''}` })
  return o
})
/** The cards whose name, memory or datacenter contains every word typed ("5090", "96 eur", "ada"); the chosen card stays listed either way. */
const shownRows = computed(() => { const w = filter.value.toLowerCase().split(/\s+/).filter(Boolean); return !w.length ? cardRows.value : cardRows.value.filter((c) => w.every((x) => `${c.name} ${c.vram ? c.vram + ' gb' : ''} ${c.cuda === 13 ? 'cuda 13 blackwell' : ''} ${c.dcs.map((d) => d.value).join(' ')}`.toLowerCase().includes(x)) || c.key === cardKey.value) })
const freeDcs = computed(() => baseList.value.filter((d) => freeIn(d)).length)
const cardRows = computed(() => {
  const m = new Map()
  for (const d of baseList.value) for (const c of d.cards || []) {
    const k = c.name
    if (!m.has(k)) m.set(k, { key: c.key, name: c.name, vram: c.vram || 0, runs: c.runs !== false, cuda: c.cuda, why: c.why, free: 0, dcs: [] })
    const e = m.get(k); if (free(c)) e.free++
    e.dcs.push({ value: d.value, s3: d.s3, price: c.price ?? null, stock: c.stock, available: free(c) })
  }
  return [...m.values()].map((c) => ({ ...c, dcs: c.dcs.sort((a, b) => Number(b.available) - Number(a.available) || (a.price ?? 9e9) - (b.price ?? 9e9) || a.value.localeCompare(b.value)) })).sort((a, b) => b.vram - a.vram || b.free - a.free || a.name.localeCompare(b.name))
})
</script>

<style scoped>
.table-wrap { max-height: 26rem; overflow: auto; }
.card-row { padding: 6px 4px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.dc-chip { line-height: 1.2; }
.dc-filter { max-width: 18rem; }
.dc-dc-select { max-width: 22rem; }
.card-row.chosen { background: rgba(80, 140, 255, 0.22); box-shadow: inset 3px 0 0 #508cff; }
</style>
