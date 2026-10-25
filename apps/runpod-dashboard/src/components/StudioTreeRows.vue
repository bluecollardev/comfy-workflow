<template>
  <div class="tree-rows" role="tree" :data-testid="testid">
    <div v-for="r in rows" :key="r.path" class="tree-row" :class="{ active: r.path === active, dir: r.dir }" role="treeitem" :data-testid="`${testid}-row`" :data-path="r.path" :data-dir="r.dir ? 'true' : 'false'" :data-status="r.status || ''" :style="{ paddingLeft: `${6 + r.depth * 14}px` }" @click="r.dir ? $emit('toggle', r.path) : $emit('pick', r.path)">
      <i class="fa-solid fa-fw me-1 tree-icon" :class="r.dir ? (r.open ? 'fa-folder-open' : 'fa-folder') : 'fa-file-lines'"></i>
      <span class="tree-label text-truncate">{{ r.label }}</span>
      <span v-if="r.dir && r.counts" class="tree-badges ms-auto">
        <span v-if="r.counts.copy" class="b-copy" :title="$t('studio.treeCopy')">{{ r.counts.copy }}</span>
        <span v-if="r.counts.left" class="b-left" :title="$t('studio.treeLeft')">{{ r.counts.left }}</span>
        <span v-if="r.counts.unmatched" class="b-unmatched" :title="$t('studio.treeUnmatched')">{{ r.counts.unmatched }}</span>
      </span>
      <span v-else-if="r.dir && r.files != null" class="tree-size ms-auto">{{ r.files }}</span>
      <span v-else-if="!r.dir" class="ms-auto d-flex align-items-center gap-2">
        <span v-if="r.status === 'copy'" class="tree-to text-truncate" :title="(r.to || []).join(', ')"><i class="fa-solid fa-arrow-right me-1"></i>{{ (r.to || [])[0] }}</span>
        <span v-else-if="r.status === 'left'" class="b-left">{{ $t('studio.leftInPlace') }}</span>
        <span v-else-if="r.status === 'unmatched'" class="b-unmatched">{{ $t('studio.notMatched') }}</span>
        <span v-if="r.bytes" class="tree-size">{{ fmt(r.bytes) }}</span>
      </span>
    </div>
    <div v-if="!rows.length" class="tree-empty">{{ empty }}</div>
  </div>
</template>

<script setup>
import { fmtBytes as fmt } from '../utils/studioTree'
defineProps({ rows: { type: Array, default: () => [] }, active: { type: String, default: '' }, empty: { type: String, default: '' }, testid: { type: String, default: 'tree' } })
defineEmits(['toggle', 'pick'])
</script>

<style scoped>
.tree-rows { font-size: 12px; user-select: none; }
.tree-row { display: flex; align-items: center; gap: 2px; padding: 2px 8px 2px 6px; cursor: pointer; white-space: nowrap; line-height: 1.5; }
.tree-row:hover { background: rgba(255, 255, 255, 0.06); }
.tree-row.active { background: rgba(80, 140, 255, 0.25); }
.tree-icon { color: #8a9bb0; font-size: 11px; }
.tree-row.dir .tree-icon { color: #d2a85a; }
.tree-label { min-width: 0; }
.tree-size { color: #7f8a99; font-size: 11px; }
.tree-to { color: #6fcf97; font-size: 11px; max-width: 14rem; }
.tree-badges span, .b-copy, .b-left, .b-unmatched { font-size: 10px; border-radius: 8px; padding: 0 6px; margin-left: 3px; }
.b-copy { background: rgba(111, 207, 151, 0.2); color: #6fcf97; }
.b-left { background: rgba(160, 160, 160, 0.2); color: #b0b6c0; }
.b-unmatched { background: rgba(242, 153, 74, 0.22); color: #f2994a; }
.tree-empty { color: #7f8a99; padding: 8px; font-size: 12px; }
</style>
