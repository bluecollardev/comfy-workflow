<template>
  <div class="dc-table" :data-testid="testid" :data-value="modelValue">
    <div class="small mb-2" data-testid="dc-table-chosen">
      <span class="text-body-secondary">{{ $t('dc.chosen') }}</span>
      <strong class="font-monospace ms-1">{{ modelValue || anyLabel || $t('dc.none') }}</strong>
      <span v-if="chosen?.s3" class="badge text-bg-secondary fw-normal ms-1" :title="$t('config.cardsS3')">S3</span>
      <span v-if="modelValue && chosen?.cards?.length" class="text-body-secondary ms-2" data-testid="dc-table-chosen-cards">{{ chosen.cards.map((c) => `${c.name}${c.vram ? ` ${c.vram} GB` : ''} ${c.stock}`).join(' · ') }}</span>
      <span v-else-if="modelValue && chosen" class="text-body-secondary ms-2" data-testid="dc-table-chosen-empty">{{ $t('dc.noneListed') }}</span>
    </div>
    <div class="d-flex align-items-center gap-3 mb-2 flex-wrap">
      <div class="btn-group btn-group-sm" role="group">
        <button type="button" class="btn" :class="view === 'card' ? 'btn-primary' : 'btn-outline-light'" data-testid="dc-view-card" @click="view = 'card'">{{ $t('dc.byCard') }}</button>
        <button type="button" class="btn" :class="view === 'dc' ? 'btn-primary' : 'btn-outline-light'" data-testid="dc-view-dc" @click="view = 'dc'">{{ $t('dc.byDatacenter') }}</button>
      </div>
      <span class="small text-body-secondary">{{ $t('dc.summary', { n: freeDcs, cards: cardRows.length }) }}</span>
    </div>

    <!-- By card: the biggest card first, and where it is free right now -->
    <div v-if="view === 'card'" class="table-wrap" data-testid="dc-by-card">
      <div v-for="c in cardRows" :key="c.name" class="card-row" data-testid="dc-card-row" :data-card="c.name">
        <div class="d-flex align-items-baseline gap-2 flex-wrap">
          <strong>{{ c.name }}</strong>
          <span class="text-body-secondary small">{{ c.vram ? `${c.vram} GB` : '' }}</span>
          <span v-if="c.cuda === 13" class="badge text-bg-info fw-normal" :title="$t('dc.cu13Tip')" data-testid="dc-card-cu13">{{ $t('dc.cu13image') }}</span>
          <span v-if="!c.runs" class="badge text-bg-warning fw-normal" :title="$t(c.why === 'amd' ? 'dc.amdTip' : 'dc.needsNewImage')">{{ $t(c.why === 'amd' ? 'dc.amd' : 'dc.cuda13') }}</span>
          <span class="small text-body-secondary">{{ $t('dc.offeredIn', { n: c.dcs.length, free: c.free }) }}</span>
        </div>
        <div class="d-flex flex-wrap gap-1 mt-1">
          <button v-for="d in c.dcs" :key="d.value" type="button" class="btn btn-sm dc-chip" :class="d.value === modelValue ? 'btn-primary' : 'btn-outline-light'" data-testid="dc-chip" :data-dc="d.value" :data-card="c.name" @click="pick(d.value)">
            <span class="font-monospace">{{ d.value }}</span><span v-if="d.s3" class="ms-1 small">S3</span><span class="ms-1 small">{{ d.price != null ? `$${d.price}/h` : '' }} {{ d.stock }}</span>
          </button>
        </div>
      </div>
      <div v-if="!cardRows.length" class="small text-body-secondary p-2">{{ $t('dc.nothingListed') }}</div>
    </div>

    <!-- By datacenter: every datacenter, most free cards first -->
    <div v-else class="table-wrap" data-testid="dc-by-dc">
      <table class="table table-sm table-hover small mb-1 align-middle">
        <thead class="text-body-secondary">
          <tr><th>{{ $t('dc.colDatacenter') }}</th><th>{{ $t('dc.colCards') }}</th><th class="text-end">{{ $t('config.cardsVram') }}</th><th class="text-end">{{ $t('config.cardsPrice') }}</th><th>{{ $t('config.cardsStock') }}</th></tr>
        </thead>
        <tbody>
          <tr v-if="anyLabel" class="dc-row first" :class="{ chosen: !modelValue }" role="button" tabindex="0" data-testid="dc-table-row" data-dc="" @click="pick('')" @keydown.enter="pick('')">
            <td colspan="5">{{ anyLabel }}</td>
          </tr>
          <template v-for="d in dcRows" :key="d.value">
            <tr v-for="(c, i) in d.shown" :key="d.value + c.key + i" class="dc-row" :class="{ chosen: d.value === modelValue, first: i === 0 }" role="button" tabindex="0" data-testid="dc-table-row" :data-dc="d.value" @click="pick(d.value)" @keydown.enter="pick(d.value)">
              <td class="font-monospace"><template v-if="i === 0">{{ d.value }}<span v-if="d.s3" class="badge text-bg-secondary fw-normal ms-1" :title="$t('config.cardsS3')">S3</span><span class="text-body-secondary ms-1">· {{ freeIn(d) }}/{{ d.cards.length }}</span></template></td>
              <td>{{ c.name }}<span v-if="c.cuda === 13" class="badge text-bg-info fw-normal ms-1" :title="$t('dc.cu13Tip')" data-testid="dc-table-cu13">{{ $t('dc.cu13image') }}</span><span v-if="!c.runs" class="badge text-bg-warning fw-normal ms-1" data-testid="dc-table-newimage" :title="$t(c.why === 'amd' ? 'dc.amdTip' : 'dc.needsNewImage')">{{ $t(c.why === 'amd' ? 'dc.amd' : 'dc.cuda13') }}</span></td>
              <td class="text-end">{{ c.vram ? `${c.vram} GB` : '' }}</td>
              <td class="text-end">{{ c.price != null ? `$${c.price}/h` : '' }}</td>
              <td>{{ c.stock }}</td>
            </tr>
            <tr v-if="!d.shown.length" class="dc-row first" :class="{ chosen: d.value === modelValue }" role="button" tabindex="0" data-testid="dc-table-row" :data-dc="d.value" @click="pick(d.value)" @keydown.enter="pick(d.value)">
              <td class="font-monospace">{{ d.value }}<span v-if="d.s3" class="badge text-bg-secondary fw-normal ms-1">S3</span></td>
              <td colspan="4" class="text-body-secondary">{{ $t('dc.noneListed') }}</td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
/**
 * DatacenterTable — the datacenter picker (ADR-026). Nothing is hidden: RunPod's own list of every card each datacenter runs, free or busy, NVIDIA and AMD.
 * Every card is shown whether it is free or in use (Lucas: "if we have to wait we have to wait"): stock is a label, never a reason to hide or dim. "By card" lists the biggest card first and every
 * datacenter that offers it, free ones first; "By datacenter" lists each datacenter's cards, free ones first. A Blackwell card is marked "CUDA 13 image" (it boots our -cu13 tag, ADR-030); a card outside our table, or an AMD one, is marked as such. A click chooses the datacenter (v-model); `anyLabel` adds an "Any" row.
 */
import { computed, ref } from 'vue'
const props = defineProps({ list: { type: Array, default: () => [] }, modelValue: { type: String, default: '' }, anyLabel: { type: String, default: '' }, testid: { type: String, default: 'dc-table' } })
const emit = defineEmits(['update:modelValue'])
const view = ref('card')
const pick = (v) => emit('update:modelValue', v)
const free = (c) => c.available !== false   // a list from an older core has no flag: every card in it was in stock
const freeIn = (d) => (d.cards || []).filter(free).length
const chosen = computed(() => props.list.find((d) => d.value === props.modelValue) || null)
const freeDcs = computed(() => props.list.filter((d) => freeIn(d)).length)
const cardRows = computed(() => {
  const m = new Map()
  for (const d of props.list) for (const c of d.cards || []) {
    const k = c.name
    if (!m.has(k)) m.set(k, { name: c.name, vram: c.vram || 0, runs: c.runs !== false, cuda: c.cuda, why: c.why, free: 0, dcs: [] })
    const e = m.get(k); if (free(c)) e.free++
    e.dcs.push({ value: d.value, s3: d.s3, price: c.price ?? null, stock: c.stock, available: free(c) })
  }
  return [...m.values()].map((c) => ({ ...c, dcs: c.dcs.sort((a, b) => Number(b.available) - Number(a.available) || (a.price ?? 9e9) - (b.price ?? 9e9) || a.value.localeCompare(b.value)) })).sort((a, b) => b.vram - a.vram || b.free - a.free || a.name.localeCompare(b.name))
})
const dcRows = computed(() => {
  const rows = props.list.map((d) => ({ ...d, shown: d.cards || [] }))
  if (props.modelValue && !props.list.some((d) => d.value === props.modelValue)) rows.push({ value: props.modelValue, s3: false, cards: [], shown: [] })   // a saved id the list lacks still shows
  return rows
})
</script>

<style scoped>
.table-wrap { max-height: 26rem; overflow: auto; }
.card-row { padding: 6px 4px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.dc-chip { line-height: 1.2; }
.dc-row { cursor: pointer; }
.dc-row.first td { border-top: 1px solid rgba(255, 255, 255, 0.12); }
.dc-row.chosen td { background: rgba(80, 140, 255, 0.28); }
</style>
