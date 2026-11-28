<template>
  <BModal :model-value="open" :title="$t('volumes.bhExploreTitle', { bucket })" size="xl" scrollable lazy ok-only :ok-title="$t('volumes.bhClose')" ok-variant="outline-light" data-testid="bucket-modal" @update:model-value="(v) => !v && $emit('close')" @show="go('')">
    <div v-if="!local" class="small text-body-secondary mb-2"><i class="fa-solid fa-lock me-1"></i>{{ $t('volumes.bhReadOnly') }}</div>
    <div v-else class="small text-body-secondary mb-2" data-testid="local-explorer-note"><i class="fa-solid fa-lock me-1"></i>{{ $t('volumes.localNote') }}</div>
    <nav class="d-flex align-items-center flex-wrap gap-1 mb-2 small" data-testid="bucket-crumbs" aria-label="breadcrumb">
      <template v-for="(c, i) in crumbs" :key="c.prefix">
        <i v-if="i" class="fa-solid fa-chevron-right text-body-secondary" style="font-size: 0.65rem"></i>
        <BButton v-if="i < crumbs.length - 1" size="sm" variant="link" class="p-0" data-testid="bucket-crumb" :data-prefix="c.prefix" @click="go(c.prefix)"><i v-if="!i" class="fa-solid fa-bucket me-1"></i>{{ c.label }}</BButton>
        <span v-else class="fw-semibold" data-testid="bucket-crumb-current" :data-prefix="c.prefix"><i v-if="!i" class="fa-solid fa-bucket me-1"></i>{{ c.label }}</span>
      </template>
    </nav>
    <BAlert v-if="error" :model-value="true" variant="danger" data-testid="bucket-error">{{ error }}
      <BButton variant="link" size="sm" class="p-0 ms-2 align-baseline" data-testid="bucket-retry" @click="go(prefix)"><i class="fa-solid fa-rotate-right me-1"></i>{{ $t('volumes.bhRetry') }}</BButton>
    </BAlert>
    <BFormInput v-model="filter" size="sm" class="mb-2" :placeholder="$t('volumes.bhFilter')" :aria-label="$t('volumes.bhFilter')" data-testid="bucket-filter" />
    <div v-if="loading" class="small text-body-secondary" data-testid="bucket-loading"><BSpinner small class="me-2" />{{ $t('volumes.bhLoading') }}</div>
    <template v-else-if="!error">
      <BAlert v-if="listing?.truncated" :model-value="true" variant="warning" class="small py-2" data-testid="bucket-truncated">{{ $t('volumes.bhTruncated') }}</BAlert>
      <div class="explorer rounded p-2" data-testid="bucket-list">
        <div class="d-flex gap-2 small text-body-secondary border-bottom pb-1 mb-1"><span class="flex-grow-1">{{ $t('volumes.bhName') }}</span><span class="col-size text-end">{{ $t('volumes.bhSize') }}</span><span class="col-date">{{ $t('volumes.bhModified') }}</span></div>
        <div v-for="r in pageRows" :key="r.key" class="d-flex align-items-center gap-2 small row-line" data-testid="bucket-row" :data-kind="r.dir ? 'folder' : 'file'" :data-name="r.name">
          <i class="fa-regular" :class="r.dir ? 'fa-folder text-warning' : 'fa-file text-body-secondary'"></i>
          <BButton v-if="r.dir" variant="link" size="sm" class="p-0 font-monospace name text-start flex-grow-1" data-testid="bucket-folder" @click="go(r.prefix)">{{ r.name }}</BButton>
          <span v-else class="font-monospace name flex-grow-1" :title="r.key">{{ r.name }}</span>
          <span class="col-size text-end text-body-secondary">{{ r.dir ? '' : fmt(r.bytes) }}</span>
          <span class="col-date text-body-secondary">{{ r.dir ? '' : (r.modified || '').replace('T', ' ').slice(0, 16) }}</span>
        </div>
        <div v-if="!rows.length" class="small text-body-secondary p-2" data-testid="bucket-empty">{{ $t('volumes.bhEmpty') }}</div>
        <div v-else-if="!matching.length" class="small text-body-secondary p-2" data-testid="bucket-nomatch">{{ $t('volumes.bhNoMatch') }}</div>
      </div>
      <div v-if="pages > 1" class="d-flex align-items-center justify-content-center gap-2 mt-2 small" data-testid="bucket-pager">
        <BButton size="sm" variant="outline-light" :disabled="page <= 1" data-testid="bucket-prev" @click="page--"><i class="fa-solid fa-chevron-left me-1"></i>{{ $t('volumes.bhPrev') }}</BButton>
        <span data-testid="bucket-page">{{ $t('volumes.bhPage', { page, pages }) }}</span>
        <BButton size="sm" variant="outline-light" :disabled="page >= pages" data-testid="bucket-next" @click="page++">{{ $t('volumes.bhNext') }}<i class="fa-solid fa-chevron-right ms-1"></i></BButton>
      </div>
    </template>
  </BModal>
</template>

<script setup>
/**
 * BucketExplorerModal: the BH exchange bucket, one folder at a time, read-only (core panama.browse: only ever `aws s3 ls`). Click a folder to go in,
 * the breadcrumb goes back up; size and modified per file, a text filter, and pages of 100 for a big folder.
 */
import { computed, ref } from 'vue'
import { panamaAPI } from '../api/panama'
import { storageAPI } from '../api/storage'
import { localOutputsAPI } from '../api/localoutputs'
import { errorText } from '../stores/toast'
import { fmtBytes as fmt } from '../utils/studioTree'

const PAGE = 100
const props = defineProps({ /** this PC's ComfyUI-Shared (the core can list its output/ folder only, so that is where it starts) */ local: Boolean, open: { type: Boolean, default: false }, bucket: { type: String, default: '' }, /** a storage adapter id: browse that adapter's bucket (core storagebrowse) instead of the BH exchange bucket */ storageId: { type: String, default: '' } })
defineEmits(['close'])
const prefix = ref(''), listing = ref(null), error = ref(''), loading = ref(false), filter = ref(''), page = ref(1)
let seq = 0
const crumbs = computed(() => {
  const parts = prefix.value.split('/').filter(Boolean)
  return [{ label: '/', prefix: '' }, ...parts.map((p, i) => ({ label: p, prefix: parts.slice(0, i + 1).join('/') + '/' }))]
})
const rows = computed(() => listing.value ? [...listing.value.folders.map((f) => ({ dir: true, name: f.name, prefix: f.prefix, key: f.prefix })), ...listing.value.files.map((f) => ({ dir: false, ...f }))] : [])
const matching = computed(() => { const q = filter.value.trim().toLowerCase(); return q ? rows.value.filter((r) => r.name.toLowerCase().includes(q)) : rows.value })
const pages = computed(() => Math.max(1, Math.ceil(matching.value.length / PAGE)))
const pageRows = computed(() => matching.value.slice((Math.min(page.value, pages.value) - 1) * PAGE, Math.min(page.value, pages.value) * PAGE))
/** A storage listing (folders as names, files without keys) in the shape the BH bucket's listing has. */
const asPanama = (r, p) => ({ ...r, folders: r.folders.map((n) => ({ name: n, prefix: `${r.prefix ?? p}${n}/` })), files: r.files.map((f) => ({ ...f, key: `${r.prefix ?? p}${f.name}` })) })
async function go(p) {
  const mine = ++seq
  loading.value = true; error.value = ''; filter.value = ''; page.value = 1
  try { const r = props.local ? asPanama(await localOutputsAPI.browse(p), p) : props.storageId ? asPanama(await storageAPI.browse(props.storageId, p), p) : await panamaAPI.browse(p); if (mine !== seq) return; listing.value = r; prefix.value = r.prefix ?? p } catch (e) { if (mine !== seq) return; prefix.value = p; error.value = errorText(e) } finally { if (mine === seq) loading.value = false }
}
</script>

<style scoped>
.explorer { background: #20232a; max-height: 60vh; overflow: auto; }
.row-line { padding-top: 0.15rem; padding-bottom: 0.15rem; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-size { width: 6rem; flex: none; }
.col-date { width: 8.5rem; flex: none; }
</style>
