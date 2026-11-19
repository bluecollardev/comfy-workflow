<template>
  <CollapsibleSection v-if="show" id="edl-status" :title="$t('edl.title')" testid="edl-status" :data-loaded="edl.loaded ? 'true' : 'false'">
    <div class="small" data-testid="edl-status-line">{{ line }}</div>
    <div class="d-flex align-items-center gap-2 flex-wrap mt-1">
      <BButton size="sm" variant="outline-primary" :disabled="edl.loading" data-testid="edl-load" @click="edl.load(source.trim() ? { source: source.trim() } : undefined)"><BSpinner v-if="edl.loading" small class="me-1" data-testid="edl-loading" />{{ $t('edl.load') }}</BButton>
    </div>
    <div v-if="edl.error" class="text-danger small mt-1" data-testid="edl-error">{{ edl.error }}</div>
    <details class="small mt-1" data-testid="edl-advanced"><summary>{{ $t('edl.advanced') }}</summary>
      <label class="mb-0 d-block">{{ $t('edl.source') }}<BFormInput v-model="source" size="sm" class="font-monospace" :placeholder="edl.status.source || 'bucket/key or a local file'" autocomplete="off" data-testid="edl-source" /></label></details>
  </CollapsibleSection>
</template>

<script setup>
/** EdlStatus: what EDL the core has loaded ('V11 EDL: 121 events · 63 elements · sha256 7511… · loaded 19 Nov'), the Load button and an optional source under Advanced. Global (Default configuration, Publishing settings); hidden on a core without the EDL. */
import CollapsibleSection from './CollapsibleSection.vue'
import { computed, onMounted, ref } from 'vue'
import { useEdlStore } from '../stores/edl'
import { t } from '../i18n'

const edl = useEdlStore(), source = ref('')
onMounted(() => edl.refresh())
const show = computed(() => edl.seen && !edl.old)
const line = computed(() => {
  const s = edl.status
  if (!s.loaded) return t('edl.none')
  const d = new Date(s.loaded_at), when = Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return t('edl.loadedLine', { events: s.events, elements: s.elements, sha: String(s.sha256 || '').slice(0, 4), when })
})
</script>
