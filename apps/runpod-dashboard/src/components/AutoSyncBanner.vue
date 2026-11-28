<template>
  <!-- Auto sync (docs/ADR-046 section 5): what is coming to this PC by itself, in the band under the nav bar, above the summary cards. -->
  <div v-if="rows.length || auto.paused" class="autosync-banner" data-testid="autosync-banner">
    <BAlert v-if="auto.paused && !rows.length" :model-value="true" variant="secondary" class="mb-0 rounded-0 border-start-0 border-end-0 py-2 small" data-testid="autosync-paused">
      <i class="fa-solid fa-circle-pause me-1"></i>{{ $t('autosync.paused') }}
      <a href="#" class="ms-2" data-testid="autosync-resume" @click.prevent="run(() => auto.pause(false))">{{ $t('autosync.resume') }}</a>
    </BAlert>
    <BAlert
      v-for="(it, n) in rows"
      :key="it.pod_id"
      :model-value="true"
      :variant="variant(it)"
      class="mb-0 rounded-0 border-start-0 border-end-0 py-2 small"
      data-testid="autosync-item"
      :data-state="it.state"
      :data-pod="it.pod_id"
      :data-percent="it.state === 'syncing' ? percent(it) : undefined"
    >
      <div class="d-flex flex-wrap align-items-center gap-2">
        <span class="flex-grow-1 text-break" :class="{ 'cursor-pointer': true }" role="button" data-testid="autosync-row" @click="openSync(it)">
          <i :class="icon(it)" class="me-1"></i>
          <strong data-testid="autosync-pod">{{ it.pod_name || it.pod_id }}</strong>:
          <span data-testid="autosync-text">{{ text(it) }}</span>
        </span>
        <template v-if="it.state === 'needs_approval'">
          <BButton size="sm" variant="success" data-testid="autosync-approve-yes" @click="run(() => auto.approve(it.pod_id, true))">{{ $t('autosync.pullYes') }}</BButton>
          <BButton size="sm" variant="outline-secondary" data-testid="autosync-approve-no" @click="run(() => auto.approve(it.pod_id, false))">{{ $t('autosync.skip') }}</BButton>
        </template>
        <template v-else-if="it.state === 'error'">
          <BButton size="sm" variant="outline-danger" data-testid="autosync-retry" @click="run(() => auto.syncNow(it.pod_id))">{{ $t('autosync.retry') }}</BButton>
          <BButton size="sm" variant="outline-secondary" data-testid="autosync-dismiss" @click="run(() => auto.dismiss(it.pod_id))">{{ $t('autosync.dismiss') }}</BButton>
        </template>
        <a v-if="n === 0" href="#" class="text-nowrap" data-testid="autosync-pause" @click.prevent="run(() => auto.pause(!auto.paused))">{{ auto.paused ? $t('autosync.resume') : $t('autosync.pause') }}</a>
      </div>
      <BProgress v-if="it.state === 'syncing'" :value="percent(it)" :max="100" height="6px" variant="success" striped animated class="mt-1" data-testid="autosync-bar" :data-percent="percent(it)" />
      <div v-if="it.conflicts && it.conflicts.length" class="small text-body-secondary mt-1" :title="conflictTitle(it)" data-testid="autosync-conflicts">
        <i class="fa-solid fa-code-compare me-1"></i>{{ $t('autosync.conflicts', { n: it.conflicts.length }) }}
      </div>
    </BAlert>
  </div>
</template>

<script setup>
/**
 * The Auto sync banner: one row per pod while a pull is waiting, running, waiting for a yes, failed, or has just finished
 * (a done row leaves by itself after DONE_MS, read against the clock). A click on a row opens that pod's Sync window.
 */
import { computed, ref } from 'vue'
import { openSyncForPod } from '../utils/syncfor'
import { useAutosyncStore } from '../stores/autosync'
import { usePodsStore } from '../stores/pods'
import { useToastStore } from '../stores/toast'
import { fmtBytes, fmtRate, percent, visible } from '../utils/autosync'
import { t } from '../i18n'

const DONE_MS = 8000   // a test shortens it: window.__autosyncDoneMs
const auto = useAutosyncStore()
const pods = usePodsStore()
const toast = useToastStore()
const doneMs = () => (typeof window !== 'undefined' && Number(window.__autosyncDoneMs)) || DONE_MS
const rows = computed(() => auto.items.filter((i) => visible(i, auto.now, doneMs())))

const variant = (it) => ({ done: 'success', error: 'danger', needs_approval: 'warning', syncing: 'info', waiting: 'light' })[it.state] || 'info'
const icon = (it) => ({ done: 'fa-solid fa-circle-check', error: 'fa-solid fa-triangle-exclamation', needs_approval: 'fa-solid fa-circle-question', syncing: 'fa-solid fa-cloud-arrow-down', waiting: 'fa-regular fa-clock' })[it.state] || 'fa-solid fa-cloud-arrow-down'
const label = (it) => (it.direction === 'push' ? 'push' : 'pull')
function text(it) {
  if (it.state === 'syncing') {
    const parts = [t(`autosync.${label(it)}Progress`), t('autosync.files', { done: it.files_done ?? 0, total: it.files_total ?? 0 })]
    if (it.bytes_total) parts.push(t('autosync.bytes', { done: fmtBytes(it.bytes_done), total: fmtBytes(it.bytes_total) }))
    if (fmtRate(it.rate_bps)) parts.push(fmtRate(it.rate_bps))
    if (it.current) parts.push(it.current)
    return parts.join(' · ')
  }
  if (it.state === 'waiting') return t('autosync.waiting', { pod: it.pod_name || it.pod_id })
  if (it.state === 'done') return it.summary || t('autosync.done')
  if (it.state === 'needs_approval') return t('autosync.approve', { size: fmtBytes(it.pending_bytes), pod: it.pod_name || it.pod_id })
  if (it.state === 'error') return [it.error || t('autosync.failed'), it.current && t('autosync.failedFile', { file: it.current })].filter(Boolean).join(' · ')
  return ''
}
const conflictTitle = (it) => it.conflicts.slice(0, 5).map((c) => `${c.path}${c.reason ? ` (${c.reason})` : ''}`).join('\n') + (it.conflicts.length > 5 ? '\n…' : '')

const run = async (fn) => { try { await fn() } catch (e) { toast.error(e?.message || String(e)) } }
const openSync = (it) => openSyncForPod(it.pod_id)
</script>
