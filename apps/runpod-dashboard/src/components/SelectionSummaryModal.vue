<template>
  <BModal :model-value="open" :title="$t('outputs.render.summaryTitle')" size="xl" scrollable lazy ok-only :ok-title="$t('outputs.render.colourDone')" ok-variant="outline-light" data-testid="selection-summary-modal" @update:model-value="(v) => { if (!v) $emit('close') }">
    <div class="mb-2" data-testid="selection-summary-count">{{ $t('outputs.render.selectedCount', { n: rows.length, m: total }) }}</div>
    <div v-if="!rows.length" class="text-body-secondary" data-testid="selection-summary-none">{{ $t('outputs.render.summaryNone') }}</div>
    <template v-else>
      <div class="d-flex gap-2 flex-wrap mb-2" data-testid="selection-summary-colours">
        <span v-for="g in groups" :key="g.label" class="badge fw-normal" :class="g.src === 'none' ? 'text-bg-warning' : 'text-bg-secondary'" data-testid="selection-summary-colour-group" :data-count="g.count">{{ g.label }}: {{ g.count }}</span>
      </div>
      <div class="table-responsive">
        <table class="table table-sm align-middle small mb-0" data-testid="selection-summary-table">
          <thead><tr><th>{{ $t('outputs.render.colSequence') }}</th><th>{{ $t('outputs.render.colClip') }}</th><th>{{ $t('outputs.render.colColour') }}</th><th v-if="anyEdl">{{ $t('outputs.render.colEdl') }}</th><th>{{ $t('outputs.render.colOutputs') }}</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.key" data-testid="selection-summary-row" :data-name="r.name">
              <td class="font-monospace text-break">{{ r.name }}</td>
              <td class="font-monospace text-break">{{ r.clip }}</td>
              <td :class="r.colour?.src === 'none' ? 'text-warning' : ''">{{ r.colour ? (r.colour.how ? `${r.colour.name} (${r.colour.how})` : r.colour.name) : '' }}</td>
              <td v-if="anyEdl">{{ r.edl === 'match' ? $t('edl.matches') : r.edl ? $t('edl.notIn') : '' }}</td>
              <td class="font-monospace text-break"><div v-for="n in r.outputs" :key="n">{{ n }}</div></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </BModal>
</template>

<script setup>
/**
 * SelectionSummaryModal: everything that is selected to be generated, across all pages and whatever the filter shows: the clip name each will get, the colour and why,
 * the EDL match when an EDL is loaded and the output files; and how many sequences use each colour.
 */
import { computed } from 'vue'
const props = defineProps({ open: { type: Boolean, default: false }, rows: { type: Array, default: () => [] }, total: { type: Number, default: 0 } })
defineEmits(['close'])
const anyEdl = computed(() => props.rows.some((r) => r.edl))
const groups = computed(() => { const m = new Map(); for (const r of props.rows) { const c = r.colour, label = c ? (c.how ? `${c.name} (${c.how})` : c.name) : '—'; const g = m.get(label) || { label, count: 0, src: c?.src || '' }; g.count++; m.set(label, g) } return [...m.values()] })
</script>
