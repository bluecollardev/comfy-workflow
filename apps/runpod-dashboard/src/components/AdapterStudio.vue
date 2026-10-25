<template>
  <BModal :model-value="studio.open" lazy unmount-lazy fullscreen no-header no-footer no-close-on-esc no-close-on-backdrop body-class="p-0" modal-class="studio-modal" data-testid="studio-modal" @update:model-value="(v) => { if (!v) requestClose() }">
    <div class="studio" data-testid="studio">
      <header class="bar">
        <AppBrand class="me-3" />
        <span class="text-body-secondary me-3">|</span>
        <i class="fa-solid fa-code me-2"></i>
        <strong class="me-3">{{ $t('studio.title') }}</strong>
        <template v-if="studio.id">
          <BFormInput :model-value="studio.name" size="sm" class="name" :disabled="studio.builtin" :placeholder="$t('studio.name')" :title="studio.builtin ? $t('studio.builtinName') : $t('studio.nameHint')" data-testid="studio-name" @update:model-value="studio.setName" />
          <span class="mx-1 text-body-secondary">/</span>
          <BFormInput :model-value="studio.id" size="sm" class="slug font-monospace" :disabled="studio.builtin" :title="studio.builtin ? $t('studio.builtinName') : $t('studio.idHint')" data-testid="studio-id" @update:model-value="studio.setId" />
        </template>
        <BBadge v-if="studio.builtin" variant="secondary" class="fw-normal ms-2" data-testid="studio-builtin-badge">{{ studio.modified ? $t('studio.builtinModified') : $t('studio.builtIn') }}</BBadge>
        <div class="ms-auto d-flex align-items-center gap-1">
          <div class="btn-group btn-group-sm me-2" role="group" :aria-label="$t('studio.view')" data-testid="studio-views">
            <button v-for="v in VIEWS" :key="v.key" type="button" class="btn btn-outline-light" :class="{ active: studio.view === v.key }" :title="$t(`studio.view_${v.key}`)" :aria-label="$t(`studio.view_${v.key}`)" :aria-pressed="studio.view === v.key" :data-testid="`studio-view-${v.key}`" @click="studio.view = v.key"><i class="fa-solid" :class="v.icon"></i></button>
          </div>
          <button type="button" class="btn btn-sm btn-outline-light me-1" :class="{ active: studio.wrap }" :title="studio.wrap ? $t('studio.wrapOff') : $t('studio.wrapOn')" :aria-label="$t('studio.wrap')" :aria-pressed="studio.wrap" data-testid="studio-wrap" @click="studio.wrap = !studio.wrap"><i class="fa-solid fa-text-width"></i></button>
          <BButton size="sm" variant="outline-light" :disabled="studio.isNew" :title="$t('studio.documentHint')" data-testid="studio-document" @click="studio.documentIt()"><i class="fa-solid fa-book me-1"></i>{{ $t('studio.document') }}</BButton>
          <BButton v-if="studio.modified" size="sm" variant="outline-warning" :title="$t('studio.resetHint')" data-testid="studio-reset" @click="studio.resetBuiltin()"><i class="fa-solid fa-rotate-left me-1"></i>{{ $t('studio.reset') }}</BButton>
          <BButton size="sm" variant="primary" :disabled="studio.saving || (!studio.dirty && !studio.isNew)" data-testid="studio-save" @click="studio.save()"><BSpinner v-if="studio.saving" small class="me-1" /><i v-else class="fa-solid fa-floppy-disk me-1"></i>{{ $t('studio.save') }}</BButton>
          <BButton size="sm" variant="outline-light" class="ms-1" :aria-label="$t('import.close')" data-testid="studio-close" @click="requestClose"><i class="fa-solid fa-xmark"></i></BButton>
        </div>
      </header>

      <BAlert v-if="studio.error" :model-value="true" variant="danger" dismissible class="m-2 py-1 small" data-testid="studio-error" @update:model-value="studio.error = null">{{ studio.error }}</BAlert>

      <div class="grid">
        <aside class="col-explorer"><StudioExplorer @open="openOther" @new="newOther" /></aside>

        <main class="col-editor">
          <div class="tabs" role="tablist" data-testid="studio-tabs">
            <button type="button" class="tab" :class="{ active: studio.tab === 'code' }" role="tab" data-testid="studio-tab-code" @click="studio.tab = 'code'"><i class="fa-brands fa-js me-1"></i>{{ studio.id || 'adapter' }}.mjs<span v-if="studio.dirtyCode" class="dirty" data-testid="studio-dirty-code">●</span></button>
            <button type="button" class="tab" :class="{ active: studio.tab === 'prompt' }" role="tab" data-testid="studio-tab-prompt" @click="studio.tab = 'prompt'"><i class="fa-solid fa-feather me-1"></i>{{ $t('studio.prompt') }}<span v-if="studio.dirtyPrompt" class="dirty" data-testid="studio-dirty-prompt">●</span></button>
            <button v-if="studio.viewing" type="button" class="tab" :class="{ active: studio.tab === 'file' }" role="tab" data-testid="studio-tab-file" @click="studio.tab = 'file'"><i class="fa-solid fa-file-lines me-1"></i>{{ studio.viewing.path.split('/').pop() }}<span class="x" :title="$t('import.close')" data-testid="studio-file-close" @click.stop="closeFile">×</span></button>
          </div>
          <div class="crumb" data-testid="studio-path">{{ studio.tab === 'prompt' ? promptPath : studio.tab === 'file' ? studio.viewing?.path : (studio.filePath || $t('studio.notSavedYet')) }}</div>

          <div class="work" :class="`mode-${studio.tab === 'code' ? studio.view : 'code'}`">
            <section v-show="studio.tab !== 'code' || studio.view !== 'preview'" class="pane code-pane">
              <CodeEditor v-if="studio.tab === 'code'" v-model="studio.code" :read-only="false" :wrap="studio.wrap" testid="studio-code" @cursor="cursor = $event" />
              <div v-else-if="studio.tab === 'prompt'" class="prompt-wrap">
                <div class="small text-body-secondary px-3 pt-2" data-testid="studio-prompt-hint">{{ $t('studio.promptHint') }}</div>
                <CodeEditor v-model="studio.prompt" language="md" :wrap="studio.wrap" testid="studio-prompt" @cursor="cursor = $event" />
              </div>
              <div v-else-if="studio.viewing" class="viewer" data-testid="studio-viewer">
                <div class="small text-body-secondary px-3 py-1">{{ fmt(studio.viewing.bytes) }} · {{ $t(`studio.kind_${studio.viewing.kind}`) }}<span v-if="studio.viewing.truncated"> · {{ $t('studio.fileCut') }}</span></div>
                <CodeEditor v-if="studio.viewing.kind === 'text' || studio.viewing.kind === 'json'" :model-value="studio.viewing.text" :language="studio.viewing.kind === 'json' ? 'js' : 'md'" read-only :wrap="studio.wrap" testid="studio-viewer-code" />
                <div v-else-if="studio.viewing.kind === 'image'" class="p-3 text-center"><img :src="studio.viewing.data_url" class="img-fluid" :alt="studio.viewing.path" data-testid="studio-viewer-image" /></div>
                <div v-else class="p-3 text-body-secondary" data-testid="studio-viewer-binary">{{ $t('studio.binary', { path: studio.viewing.path }) }}</div>
              </div>
            </section>
            <section v-if="studio.tab === 'code' && studio.view !== 'code'" class="pane preview-pane"><StudioPreview /></section>
          </div>

          <div class="problems" data-testid="studio-problems">
            <div class="ph"><i class="fa-solid fa-circle-exclamation me-1"></i>{{ $t('studio.problems') }} <span class="count" data-testid="studio-problem-count">{{ studio.problems.length }}</span></div>
            <div v-for="(p, i) in studio.problems" :key="i" class="pi text-warning" data-testid="studio-problem">{{ p }}</div>
            <div v-if="!studio.problems.length" class="pi text-success" data-testid="studio-structure-ok"><i class="fa-solid fa-circle-check me-1"></i>{{ $t('adapters.structureOk') }}</div>
          </div>
          <footer class="status" data-testid="studio-status">
            <span>{{ $t('studio.lineCol', { line: cursor.line, col: cursor.col }) }}</span>
            <span>{{ studio.tab === 'prompt' ? 'Markdown' : 'JavaScript' }}</span>
            <span data-testid="studio-wrap-state">{{ studio.wrap ? $t('studio.wrapState') : $t('studio.noWrapState') }}</span>
            <span v-if="studio.row" class="font-monospace" data-testid="studio-sha">{{ studio.row.sha256.slice(0, 10) }}</span>
            <span class="ms-auto" :class="studio.dirty ? 'text-warning' : 'text-success'" data-testid="studio-saved-state">{{ studio.dirty ? $t('studio.modified') : $t('studio.savedState') }}</span>
            <span :class="studio.valid ? 'text-success' : 'text-warning'" data-testid="studio-valid">{{ studio.valid ? $t('studio.valid') : $t('studio.notValid') }}</span>
          </footer>
        </main>

        <aside class="col-chat"><StudioChat /></aside>
      </div>
    </div>
  </BModal>
</template>

<script setup>
/**
 * AdapterStudio — one modal, laid out like an IDE, for Edit, New adapter and Write an adapter with Claude (docs/ADR-009): the adapters and
 * the attached package on the left; the adapter's code, its prompt and the package's files in tabs, with Code, Preview and Split as icon
 * buttons; the chat with Claude on the right. Save is explicit. The prompt is the person's too.
 */
import { computed, ref } from 'vue'
import { t } from '../i18n'
import { useStudioStore } from '../stores/studio'
import { fmtBytes as fmt } from '../utils/studioTree'
import AppBrand from './AppBrand.vue'
import CodeEditor from './CodeEditor.vue'
import StudioChat from './StudioChat.vue'
import StudioExplorer from './StudioExplorer.vue'
import StudioPreview from './StudioPreview.vue'

const studio = useStudioStore()
const cursor = ref({ line: 1, col: 1 })
const VIEWS = [{ key: 'code', icon: 'fa-code' }, { key: 'preview', icon: 'fa-eye' }, { key: 'split', icon: 'fa-table-columns' }]
const promptPath = computed(() => (studio.filePath ? studio.filePath.replace(/\.mjs$/, '.prompt.md') : `${studio.id}.prompt.md`))
const requestClose = () => studio.close()
const closeFile = () => { studio.tab = 'code'; studio.viewing = null }
/** Switching adapters leaves unsaved edits behind: ask first, as closing does. */
async function openOther(id) { if (id === studio.id && !studio.isNew) return; if (studio.dirty && !window.confirm($tConfirm())) return; await studio.openAdapter(id, { folder: studio.folder }) }
async function newOther() { if (studio.dirty && !window.confirm($tConfirm())) return; await studio.openNew({ folder: studio.folder }) }
const $tConfirm = () => t('studio.confirmClose')
</script>

<style>
.studio-modal .modal-content { background: #1b1d22; border-radius: 0; }
.modal.over-studio { z-index: 1085 !important; }   /* Default Configuration opened from inside the Studio (the Claude key) */
.studio-modal .modal-body { display: flex; min-height: 0; }
</style>
<style scoped>
.studio { display: flex; flex-direction: column; width: 100%; height: calc(100vh - 0px); color: #d6dbe3; background: #1b1d22; }
.bar { display: flex; align-items: center; padding: 6px 12px; background: #15171b; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
.bar .name { width: 14rem; } .bar .slug { width: 11rem; }
.grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 250px minmax(0, 1fr) 380px; }
.col-explorer, .col-chat { min-height: 0; overflow: hidden; border-right: 1px solid rgba(255, 255, 255, 0.08); }
.col-chat { border-right: 0; border-left: 1px solid rgba(255, 255, 255, 0.08); }
.col-editor { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.tabs { display: flex; background: #15171b; overflow-x: auto; }
.tab { background: none; border: 0; color: #9aa4b2; padding: 6px 14px; font-size: 12px; border-right: 1px solid rgba(255, 255, 255, 0.06); white-space: nowrap; }
.tab.active { background: #1b1d22; color: #fff; border-top: 2px solid #4c8dff; }
.tab .dirty { color: #f2c94c; margin-left: 6px; } .tab .x { margin-left: 8px; opacity: 0.6; } .tab .x:hover { opacity: 1; }
.crumb { font-size: 11px; color: #7f8a99; padding: 3px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); font-family: ui-monospace, Menlo, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.work { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr; }
.work.mode-split { grid-template-columns: 1fr 1fr; }
.pane { min-height: 0; min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
.pane.preview-pane { border-left: 1px solid rgba(255, 255, 255, 0.08); overflow: auto; background: #1e2127; }
.work.mode-preview .code-pane { display: none; }
.code-pane > * { flex: 1; min-height: 0; }
.prompt-wrap { display: flex; flex-direction: column; } .prompt-wrap > :last-child { flex: 1; min-height: 0; }
.viewer { display: flex; flex-direction: column; } .viewer > :last-child { flex: 1; min-height: 0; overflow: auto; }
.problems { max-height: 9rem; overflow: auto; background: #15171b; border-top: 1px solid rgba(255, 255, 255, 0.08); font-size: 12px; }
.problems .ph { padding: 3px 12px; color: #8a9bb0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.problems .count { background: rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 0 6px; margin-left: 4px; }
.problems .pi { padding: 1px 14px; }
.status { display: flex; gap: 16px; padding: 2px 12px; background: #2d5fd0; color: #fff; font-size: 11px; }
.status .text-success, .status .text-warning { color: #fff !important; }
@media (max-width: 991px) { .grid { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr) 40vh; overflow: auto; } .col-explorer { max-height: 30vh; } }
</style>
