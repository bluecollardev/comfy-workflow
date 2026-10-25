<template>
  <div class="explorer" data-testid="studio-explorer">
    <div class="sec-head">
      <span>{{ $t('studio.adapters') }}</span>
      <button type="button" class="icon-btn ms-auto" :title="$t('studio.newAdapter')" data-testid="studio-new" @click="$emit('new')"><i class="fa-solid fa-plus"></i></button>
    </div>
    <div class="list">
      <div v-for="a in imports.adapters" :key="a.id" class="item" :class="{ active: a.id === studio.id && !studio.isNew }" role="button" tabindex="0" data-testid="studio-adapter" :data-id="a.id" @click="$emit('open', a.id)" @keydown.enter="$emit('open', a.id)">
        <i class="fa-solid fa-fw me-1" :class="a.builtin ? 'fa-lock' : 'fa-file-code'"></i>
        <span class="text-truncate">{{ a.name }}</span>
        <span v-if="a.modified" class="dot" :title="$t('studio.modifiedBuiltin')" data-testid="studio-modified-dot"></span>
      </div>
      <div v-if="studio.isNew" class="item active" data-testid="studio-adapter-new"><i class="fa-solid fa-fw me-1 fa-file-circle-plus"></i><span class="text-truncate">{{ studio.name || studio.id }}</span><small class="ms-auto text-body-secondary">{{ $t('studio.unsaved') }}</small></div>
    </div>

    <div class="sec-head mt-2">
      <span>{{ $t('studio.package') }}</span>
      <button v-if="studio.folder" type="button" class="icon-btn ms-auto" :title="$t('studio.detach')" data-testid="studio-detach" @click="studio.attach('')"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="px-2 pb-2">
      <div class="d-flex gap-1">
        <BFormInput v-model.trim="typed" size="sm" class="font-monospace" :placeholder="$t('import.folderPlaceholder')" data-testid="studio-folder" @keydown.enter.prevent="attach" />
        <BButton size="sm" variant="outline-light" :title="$t('import.browse')" data-testid="studio-browse" @click="picker = true"><i class="fa-regular fa-folder-open"></i></BButton>
        <BButton size="sm" variant="primary" :disabled="!typed" :title="$t('studio.attach')" data-testid="studio-attach" @click="attach"><i class="fa-solid fa-link"></i></BButton>
      </div>
      <div v-if="studio.treeError" class="text-danger small mt-1" data-testid="studio-tree-error">{{ studio.treeError }}</div>
    </div>
    <div class="tree-scroll">
      <StudioTreeRows v-if="studio.folder" :rows="rows" :active="studio.tab === 'file' ? studio.viewing?.path : ''" :empty="$t('studio.noTree')" testid="studio-package" @toggle="toggle" @pick="studio.openFile($event)" />
      <div v-else class="small text-body-secondary p-2" data-testid="studio-nopackage">{{ $t('studio.attachHint') }}</div>
      <div v-if="studio.tree?.truncated" class="small text-body-secondary px-2">{{ $t('studio.treeCut', { shown: studio.tree.entries.length, total: studio.tree.total }) }}</div>
    </div>
    <FolderPicker v-model="picker" :title="$t('import.pickTitle')" :start="studio.folder" memory-key="studio" @choose="(p) => { typed = p; attach() }" />
  </div>
</template>

<script setup>
/** StudioExplorer — the adapters (built-ins locked, a dot on a modified one) and the attached package as a tree; a file opens in the viewer. */
import { computed, reactive, ref, watch } from 'vue'
import { useImportsStore } from '../stores/imports'
import { useStudioStore } from '../stores/studio'
import { annotate, treeRows } from '../utils/studioTree'
import FolderPicker from './FolderPicker.vue'
import StudioTreeRows from './StudioTreeRows.vue'

defineEmits(['open', 'new'])
const studio = useStudioStore()
const imports = useImportsStore()
const typed = ref(studio.folder)
const picker = ref(false)
const collapsed = reactive(new Set())
const toggle = (p) => (collapsed.has(p) ? collapsed.delete(p) : collapsed.add(p))
const attach = () => studio.attach(typed.value)
watch(() => studio.folder, (f) => { typed.value = f })
const rows = computed(() => treeRows(studio.tree?.entries || [], collapsed, annotate(studio.tree?.entries || [], studio.plan?.ops || [])))
</script>

<style scoped>
.explorer { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #20232a; font-size: 12px; }
.sec-head { display: flex; align-items: center; padding: 6px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #8a9bb0; }
.list { max-height: 30%; overflow: auto; }
.item { display: flex; align-items: center; padding: 3px 10px; cursor: pointer; color: #cfd6e0; }
.item:hover { background: rgba(255, 255, 255, 0.06); }
.item.active { background: rgba(80, 140, 255, 0.25); }
.item .dot { width: 7px; height: 7px; border-radius: 50%; background: #f2c94c; margin-left: 6px; flex-shrink: 0; }
.icon-btn { background: none; border: 0; color: #9aa4b2; padding: 0 4px; cursor: pointer; }
.icon-btn:hover { color: #fff; }
.tree-scroll { flex: 1; min-height: 0; overflow: auto; }
</style>
