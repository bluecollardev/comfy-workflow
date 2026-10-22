<template>
  <BModal :model-value="modelValue" size="xl" lazy scrollable ok-only :ok-title="$t('mcp.docsClose')" ok-variant="outline-light" data-testid="mcp-docs-modal" @update:model-value="emit('update:modelValue', $event)" @show="onShow">
    <template #title>
      <span data-testid="mcp-docs-title">{{ $t('mcp.docsTitle', { name: ep.title }) }}</span>
      <McpStatus :ep="ep" class="ms-2 fs-6 align-middle" /> <McpTarget :ep="ep" class="ms-1 fs-6 align-middle" />
    </template>

    <div v-if="probing" class="text-body-secondary py-3" data-testid="mcp-docs-probing"><BSpinner small class="me-2" />{{ $t('mcp.docsProbing') }}</div>
    <BAlert v-else-if="result && !result.ok" :model-value="true" variant="danger" class="mb-0" data-testid="mcp-docs-error"><i class="fa-solid fa-triangle-exclamation me-2"></i><span class="text-break" style="white-space: pre-wrap">{{ result.error || $t('mcp.noAnswer') }}</span></BAlert>
    <template v-else-if="result">
      <BFormInput v-model="query" type="search" :placeholder="$t('mcp.docsSearch')" class="mb-3" data-testid="mcp-docs-search" />
      <div v-if="!groups.length" class="text-body-secondary py-3" data-testid="mcp-docs-empty">{{ query ? $t('mcp.docsNoMatch') : $t('mcp.noTools') }}</div>
      <section v-for="g in groups" :key="g.group" class="mb-3" data-testid="mcp-docs-group" :data-group="g.group">
        <button type="button" class="btn btn-outline-light w-100 text-start d-flex align-items-center" :aria-expanded="isOpen(g.group)" data-testid="mcp-docs-group-toggle" @click="toggle(g.group)">
          <i class="fa-solid me-2" :class="isOpen(g.group) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
          <span class="fw-semibold">{{ groupLabel(g.group) }}</span>
          <BBadge variant="secondary" class="ms-2 fw-normal" data-testid="mcp-docs-group-count">{{ g.tools.length }}</BBadge>
        </button>
        <div v-if="isOpen(g.group)" class="pt-2">
          <div v-for="tool in g.tools" :key="tool.name" class="card mb-2" data-testid="mcp-docs-tool" :data-name="tool.name">
            <div class="card-body py-2">
              <div class="d-flex align-items-center gap-2 mb-1">
                <h6 class="mb-0"><code>{{ tool.name }}</code></h6>
                <BBadge v-if="tool.needsConfirm" variant="warning" class="fw-normal" :title="$t('mcp.needsConfirmHint')" data-testid="mcp-docs-confirm"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('mcp.needsConfirm') }}</BBadge>
              </div>
              <p v-if="tool.text" class="small mb-2" style="white-space: pre-wrap" data-testid="mcp-docs-text">{{ tool.text }}</p>
              <div v-for="(c, i) in tool.calls" :key="i" class="small mb-1" data-testid="mcp-docs-call">
                <span class="text-body-secondary me-2">{{ $t('mcp.comfyCall') }}</span>
                <BBadge v-if="c.method" :variant="METHOD_VARIANT[c.method] || 'secondary'" class="me-1" data-testid="mcp-docs-method">{{ c.method }}</BBadge>
                <code data-testid="mcp-docs-path">{{ c.path }}</code>
              </div>
              <div v-if="tool.params.length" class="mt-2"><McpParams :params="tool.params" /></div>
              <small v-else class="text-body-secondary" data-testid="mcp-docs-no-params">{{ $t('mcp.docsNoParams') }}</small>
            </div>
          </div>
        </div>
      </section>
    </template>
  </BModal>
</template>

<script setup>
/**
 * McpDocsModal: the tools of one MCP endpoint as docs. Opening it uses the endpoint's last probe, or runs the
 * probe itself (spinner, then the tools; a failed probe shows its error). Tools are grouped by the `[group]`
 * tag of their description (untagged pod manager tools by name, see mcpDocs.js), searchable by name and description.
 */
import { computed, ref } from 'vue'
import { useMcpStore } from '../stores/mcp'
import { groupTools } from '../mcpDocs'
import { t, te } from '../i18n'
import McpParams from './McpParams.vue'
import McpStatus from './McpStatus.vue'
import McpTarget from './McpTarget.vue'

const props = defineProps({ modelValue: { type: Boolean, default: false }, ep: { type: Object, required: true } })
const emit = defineEmits(['update:modelValue'])
const store = useMcpStore()

const METHOD_VARIANT = { GET: 'success', POST: 'primary', PUT: 'warning', PATCH: 'warning', DELETE: 'danger' }
const query = ref('')
const opened = ref({})   // group -> true/false once the user toggled it

const probing = computed(() => !!store.probing[props.ep.id])
const result = computed(() => store.results[props.ep.id])
const groups = computed(() => groupTools(result.value?.definitions || [], query.value))
// Many groups start collapsed; a search, or a single group, shows the tools right away.
const isOpen = (g) => (g in opened.value ? opened.value[g] : !!query.value.trim() || groups.value.length === 1)
const toggle = (g) => { opened.value = { ...opened.value, [g]: !isOpen(g) } }
const groupLabel = (g) => (te(`mcp.group.${g}`) ? t(`mcp.group.${g}`) : g)

function onShow() { query.value = ''; opened.value = {}; store.ensure(props.ep.id) }
</script>
