<template>
  <div v-if="show" data-testid="autopublish-lists">
    <AutoPublishList v-if="running.length" testid="autopublish-list-running" :title="$t('autopublish.lists.running', { n: running.length })" :rows="running" start-open>
      <template #default="{ rows }">
        <div v-for="r in rows" :key="r.key" class="d-flex align-items-center gap-2 px-2 py-1 border-bottom flex-wrap" data-testid="autopublish-list-row" :data-key="r.key">
          <span class="badge text-bg-info fw-normal"><BSpinner small class="me-1" />{{ $t('autopublish.lists.state.rendering') }}</span>
          <span class="font-monospace text-truncate" style="min-width: 0; max-width: 24rem" :title="r.stem">{{ r.stem }}</span>
          <span class="text-body-secondary">{{ $t('autopublish.gen.since', { when: ago(r.started_at) }) }}</span>
          <span class="text-body-secondary font-monospace">{{ r.job_id }}</span>
          <span class="ms-auto"><AutoPublishOutputsLink :row="folderRow(r.key)" /></span>
        </div>
      </template>
    </AutoPublishList>
    <AutoPublishList v-if="generated.length" testid="autopublish-list-generated" :title="$t('autopublish.lists.generated', { n: generated.length })" :rows="generated">
      <template #default="{ rows }">
        <div v-for="g1 in rows" :key="g1.key" class="d-flex align-items-center gap-2 px-2 py-1 border-bottom flex-wrap" data-testid="autopublish-list-row" :data-key="g1.key" :data-state="g1.state">
          <span class="badge fw-normal" :class="chip(g1.state)">{{ $t(`autopublish.lists.state.${g1.state}`) }}</span>
          <span class="font-monospace text-truncate" style="min-width: 0; max-width: 24rem" :title="g1.stem">{{ g1.stem }}</span>
          <span class="text-body-secondary">{{ hhmm(g1.at) }}</span>
          <span class="ms-auto"><AutoPublishOutputsLink :row="folderRow(g1.key)" /></span>
        </div>
      </template>
    </AutoPublishList>
    <AutoPublishList v-if="notGenerated.length" testid="autopublish-list-not-generated" :title="$t('autopublish.lists.notGenerated', { n: notGenerated.length })" :rows="notGenerated">
      <template #default="{ rows }">
        <div v-for="(s, i) in rows" :key="`${s.stem}|${i}`" class="px-2 py-1 border-bottom" data-testid="autopublish-list-row"><span class="font-monospace">{{ s.stem }}</span>: {{ s.reason }}</div>
      </template>
    </AutoPublishList>
    <AutoPublishList v-if="uploaded.length" testid="autopublish-list-uploaded" :title="$t('autopublish.lists.uploaded', { n: uploaded.length })" :rows="uploaded">
      <template #default="{ rows }">
        <div v-for="u in rows" :key="`${u.shot}/${u.version}`" class="d-flex align-items-center gap-2 px-2 py-1 border-bottom flex-wrap" data-testid="autopublish-list-row" :data-shot="u.shot" :data-version="u.version">
          <span class="badge text-bg-success fw-normal">{{ $t('autopublish.lists.state.uploaded') }}</span>
          <span>{{ u.shot }} {{ versionTag(u.version) }}</span>
          <span class="text-body-secondary">{{ hhmm(u.at) }}</span>
          <span v-if="u.manual" class="badge text-bg-secondary fw-normal">{{ $t('autopublish.lists.manual') }}</span>
          <span v-if="u.already" class="badge text-bg-secondary fw-normal">{{ $t('autopublish.lists.already') }}</span>
          <span class="ms-auto"><AutoPublishOutputsLink :row="{ shot: u.shot, version: u.version, files: 1 }" /></span>
        </div>
      </template>
    </AutoPublishList>
    <AutoPublishList v-if="skipped.length" testid="autopublish-list-skipped" :title="$t('autopublish.lists.skipped', { n: skipped.length })" :rows="skipped">
      <template #default="{ rows }">
        <div v-for="(s, i) in rows" :key="`${s.shot}/${s.version}|${i}`" class="d-flex align-items-center gap-2 px-2 py-1 border-bottom flex-wrap" data-testid="autopublish-list-row" :data-shot="s.shot" :data-version="s.version">
          <span>{{ s.shot }} {{ versionTag(s.version) }}</span><span class="text-body-secondary">{{ s.reason }}</span>
          <span class="ms-auto"><AutoPublishOutputsLink :row="{ shot: s.shot, version: s.version }" /></span>
        </div>
      </template>
    </AutoPublishList>
  </div>
</template>

<script setup>
/** AutoPublishLists: the lists the core's status carries that the Queue's Auto-publish section did not show: what is rendering now, every render started today with where it stands, what Auto-generate left alone and why, what was uploaded today and what was skipped and why. Each is one collapsible list with its count (AutoPublishList); only what is rendering starts open. */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useAutopublishStore } from '../stores/autopublish'
import { t } from '../i18n'
import { agoText, versionTag, folderOf } from '../utils/autopublish'
import AutoPublishList from './AutoPublishList.vue'
import AutoPublishOutputsLink from './AutoPublishOutputsLink.vue'

const ap = useAutopublishStore()
const gen = computed(() => ap.status?.generate || null)
const arr = (v) => (Array.isArray(v) ? v : [])
const running = computed(() => arr(gen.value?.running))
const generated = computed(() => arr(gen.value?.generated).slice().reverse())   // newest first
const notGenerated = computed(() => arr(gen.value?.skipped).filter((s) => !/colou?r/i.test(s.reason || '')))
const uploaded = computed(() => arr(ap.status?.watching?.uploaded).slice().reverse())
const skipped = computed(() => arr(ap.status?.watching?.skipped))
const show = computed(() => !ap.old && !!ap.status && !!(running.value.length || generated.value.length || notGenerated.value.length || uploaded.value.length || skipped.value.length))
const now = ref(Date.now()), tick = setInterval(() => { now.value = Date.now() }, 15000)
onBeforeUnmount(() => clearInterval(tick))
const ago = (iso) => agoText(iso, t, now.value)
const hhmm = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString() }
const chip = (s) => (s === 'done' ? 'text-bg-success' : s === 'failed' ? 'text-bg-danger' : s === 'rendering' ? 'text-bg-info' : 'text-bg-secondary')
const folderRow = (key) => ({ folder: folderOf(key), files: 1 })
</script>
