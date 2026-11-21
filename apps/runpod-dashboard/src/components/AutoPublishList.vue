<template>
  <div class="mt-2" :data-testid="testid" :data-open="open ? 'true' : 'false'" :data-count="count">
    <div class="d-flex align-items-center gap-2 small">
      <span class="fw-semibold" :data-testid="`${testid}-title`">{{ title }}</span>
      <BButton variant="link" size="sm" class="p-0 ms-auto" :aria-expanded="open ? 'true' : 'false'" :data-testid="`${testid}-toggle`" @click="open = !open">{{ open ? $t('autopublish.list.collapse') : $t('autopublish.list.expand') }}</BButton>
    </div>
    <div v-show="open" class="border rounded small" :data-testid="`${testid}-body`">
      <slot :rows="shown" />
      <div v-if="rows.length > shown.length" class="d-flex align-items-center gap-2 px-2 py-1">
        <span class="text-body-secondary" :data-testid="`${testid}-shown`">{{ $t('autopublish.lists.shown', { shown: shown.length, total: rows.length }) }}</span>
        <BButton variant="link" size="sm" class="p-0" :data-testid="`${testid}-more`" @click="limit += PAGE">{{ $t('autopublish.list.more', { n: Math.min(PAGE, rows.length - shown.length) }) }}</BButton>
        <BButton variant="link" size="sm" class="p-0" :data-testid="`${testid}-all`" @click="all = true">{{ $t('autopublish.lists.all') }}</BButton>
      </div>
    </div>
  </div>
</template>

<script setup>
/** AutoPublishList: one list of the Queue's Auto-publish section: a title row with the count and a Show / Hide control, then the rows 25 at a time (Show More, Show All). The rows come from the slot. */
import { computed, ref } from 'vue'

const PAGE = 25
const props = defineProps({ title: { type: String, required: true }, rows: { type: Array, default: () => [] }, startOpen: { type: Boolean, default: false }, testid: { type: String, required: true } })
const open = ref(props.startOpen), limit = ref(PAGE), all = ref(false)
const count = computed(() => props.rows.length)
const shown = computed(() => (all.value ? props.rows : props.rows.slice(0, limit.value)))
</script>
