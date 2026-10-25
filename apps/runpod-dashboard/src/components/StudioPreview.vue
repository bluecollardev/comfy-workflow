<template>
  <div class="preview" data-testid="studio-preview">
    <section class="mb-3" data-testid="studio-preview-doc">
      <h6>{{ $t('studio.whatItDoes') }}</h6>
      <pre v-if="headerWords" class="doc" data-testid="studio-preview-header">{{ headerWords }}</pre>
      <div v-else class="text-warning small" data-testid="studio-preview-nodoc"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('studio.noHeader') }}</div>
    </section>

    <div v-if="!studio.folder" class="text-body-secondary small" data-testid="studio-preview-nofolder">{{ $t('studio.previewNoFolder') }}</div>
    <div v-else-if="studio.isNew" class="text-body-secondary small" data-testid="studio-preview-unsaved">{{ $t('studio.previewSaveFirst') }}</div>
    <div v-else-if="studio.planning" class="text-body-secondary small"><BSpinner small class="me-2" />{{ $t('studio.previewRunning') }}</div>
    <BAlert v-else-if="studio.planError" :model-value="true" variant="danger" class="small py-2" data-testid="studio-preview-error">{{ studio.planError }}</BAlert>
    <template v-else-if="studio.plan">
      <div class="d-flex flex-wrap gap-2 mb-2 small" data-testid="studio-preview-summary">
        <BBadge v-for="(v, kind) in studio.plan.summary.by_kind" :key="kind" variant="secondary" class="fw-normal" :data-kind="kind">{{ $t(`import.kinds.${kind}`) }} {{ v.files }} · {{ fmt(v.bytes) }}</BBadge>
        <BBadge variant="secondary" class="fw-normal">{{ $t('import.leftInPlace', { n: studio.plan.summary.notes }) }}</BBadge>
        <BBadge :variant="studio.plan.fenced ? 'success' : 'warning'" class="fw-normal">{{ studio.plan.fenced ? $t('import.fenced') : $t('import.notFenced') }}</BBadge>
      </div>
      <div v-for="(f, i) in studio.plan.findings" :key="i" class="small" :class="f.level === 'problem' ? 'text-danger' : f.level === 'warn' ? 'text-warning' : 'text-body-secondary'" data-testid="studio-preview-finding"><i class="fa-solid me-1" :class="f.level === 'info' ? 'fa-circle-info' : 'fa-triangle-exclamation'"></i>{{ f.text }}</div>
      <div class="cols mt-2">
        <div>
          <h6>{{ $t('studio.package') }}</h6>
          <StudioTreeRows :rows="sourceRows" :empty="$t('studio.noTree')" testid="studio-preview-source" @toggle="toggle(collapsedSrc, $event)" @pick="studio.openFile($event)" />
          <div v-if="studio.tree?.truncated" class="small text-body-secondary mt-1">{{ $t('studio.treeCut', { shown: studio.tree.entries.length, total: studio.tree.total }) }}</div>
        </div>
        <div>
          <h6>{{ $t('studio.destination') }}</h6>
          <StudioTreeRows :rows="destRows" :empty="$t('studio.nothingCopied')" testid="studio-preview-dest" @toggle="toggle(collapsedDst, $event)" />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
/** StudioPreview — what the adapter does: its own words (the documentation header), the plan by kind, the package as a tree with what happens to each file, and the destination tree (docs/ADR-009, decision 9). */
import { computed, reactive } from 'vue'
import { useStudioStore, headerText } from '../stores/studio'
import { annotate, destEntries, fmtBytes as fmt, treeRows } from '../utils/studioTree'
import StudioTreeRows from './StudioTreeRows.vue'

const studio = useStudioStore()
const collapsedSrc = reactive(new Set()); const collapsedDst = reactive(new Set())
const toggle = (set, p) => (set.has(p) ? set.delete(p) : set.add(p))
const headerWords = computed(() => headerText(studio.header))
const sourceRows = computed(() => treeRows(studio.tree?.entries || [], collapsedSrc, annotate(studio.tree?.entries || [], studio.plan?.ops || [])))
const destRows = computed(() => treeRows(destEntries(studio.plan?.ops || []), collapsedDst))
</script>

<style scoped>
.preview { padding: 12px 14px; overflow: auto; height: 100%; }
.preview h6 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a9bb0; margin-bottom: 4px; }
.doc { white-space: pre-wrap; font-size: 12px; background: rgba(255, 255, 255, 0.04); border-radius: 4px; padding: 8px 10px; margin: 0; color: #cfd6e0; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 1100px) { .cols { grid-template-columns: 1fr; } }
</style>
