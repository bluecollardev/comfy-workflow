<template>
  <div class="mt-1" data-testid="edl-flags" :data-blocked="blocked ? 'true' : 'false'">
    <div v-for="f in flags" :key="f.code" class="alert py-0 px-2 mb-1" :class="isBlock(f) ? 'alert-danger' : f.level === 'info' ? 'alert-info' : 'alert-warning'" data-testid="edl-flag" :data-code="f.code" :data-level="isBlock(f) ? 'block' : f.level === 'info' ? 'info' : 'warn'">
      <span>{{ f.code === 'not-in-edl' ? $t('edl.notInEdl') : f.message }}</span>
      <template v-if="f.code === 'frames-differ-from-edl'">
        <div data-testid="edl-frames-line">{{ $t('edl.frames', { n: row.frames ?? row.frame_count ?? '', m: row.expected_frames ?? '', speed: speedText }) }}</div>
        <label class="d-flex align-items-center gap-2 mb-0"><input type="checkbox" class="form-check-input mt-0" :checked="override" :data-testid="`edl-override-${stem}`" @change="$emit('update:override', $event.target.checked)" />{{ $t('edl.override') }}</label>
        <div class="text-body-secondary" data-testid="edl-override-note">{{ $t('edl.overrideNote') }}</div>
      </template>
      <template v-if="f.code === 'ambiguous-edl-element' && candidates.length">
        <select class="form-select form-select-sm mt-1" style="width: auto" data-testid="edl-candidates" @change="$event.target.value && $emit('pick', $event.target.value)"><option value="">{{ $t('edl.pick') }}</option><option v-for="c in candidates" :key="c" :value="c">{{ c }}</option></select>
      </template>
    </div>
    <div v-if="blocked" class="text-danger" data-testid="edl-skipped">{{ $t('edl.skipped') }}</div>
  </div>
</template>

<script setup>
/** SeqFlags: the EDL's flags of one sequence (docs/ADR-050): block flags in red (the sequence will be skipped), warnings in amber, notes (info: the DPX header disagrees with the OCIO record) in blue; a frame-count difference says by how much and offers an override for this run; not-in-EDL has none; an ambiguous element offers its candidates. */
import { computed } from 'vue'
import { t } from '../i18n'

const props = defineProps({ flags: { type: Array, default: () => [] }, row: { type: Object, default: () => ({}) }, stem: { type: String, default: '' }, override: { type: Boolean, default: false }, candidates: { type: Array, default: () => [] } })
defineEmits(['update:override', 'pick'])
const isBlock = (f) => f.level === 'block' && !(f.code === 'frames-differ-from-edl' && props.override)
const blocked = computed(() => props.flags.some(isBlock))
const speedText = computed(() => { const s = props.row?.edl_element?.speeds; return Array.isArray(s) && s.length ? t('edl.speed', { s: s.join(', ') }) : '' })
</script>
