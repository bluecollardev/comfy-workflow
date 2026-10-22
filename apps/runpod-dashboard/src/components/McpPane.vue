<template>
  <div data-testid="connect-mcp">
    <p class="text-body-secondary small">{{ $t('mcp.intro') }}</p>

    <BAlert v-if="store.error" :model-value="true" variant="danger" dismissible class="mb-3" data-testid="mcp-error-top" @update:model-value="store.error = null">{{ store.error }}</BAlert>
    <div v-if="store.loading && !store.endpoints.length" class="text-body-secondary py-3"><BSpinner small class="me-2" />{{ $t('mcp.loading') }}</div>
    <div v-else-if="!store.endpoints.length" class="text-body-secondary py-3">{{ $t('mcp.none') }}</div>

    <div v-for="ep in store.endpoints" :key="ep.id" class="card mb-3" data-testid="mcp-endpoint" :data-id="ep.id">
      <div class="card-body">
        <div class="d-flex align-items-start gap-3">
          <i class="fa-solid fa-plug fs-5 text-body-secondary mt-1"></i>
          <div class="flex-grow-1 lh-sm">
            <div class="fw-semibold" data-testid="mcp-title">{{ ep.title }} <code class="small text-body-secondary" data-testid="mcp-name">{{ ep.name }}</code> <McpStatus :ep="ep" class="ms-1 align-middle" /> <McpTarget :ep="ep" class="ms-1 align-middle" /></div>
            <small class="text-body-secondary d-block" data-testid="mcp-purpose">{{ ep.purpose }}</small>
            <small v-if="!ep.exists" class="text-warning d-block" data-testid="mcp-not-built">{{ $t('mcp.notBuilt') }}</small>
          </div>
          <div class="d-flex gap-1 flex-shrink-0 ms-2">
            <BButton size="sm" variant="outline-light" class="text-nowrap" :title="$t('mcp.docsHint')" data-testid="mcp-docs" @click="docsFor = ep.id"><i class="fa-solid fa-book me-1"></i>{{ $t('mcp.docs') }}</BButton>
            <BButton size="sm" variant="outline-light" class="text-nowrap" :disabled="!!store.probing[ep.id]" :title="$t('mcp.checkTitle')" data-testid="mcp-check" @click="store.check(ep.id)">
              <BSpinner v-if="store.probing[ep.id]" small class="me-1" /><i v-else class="fa-solid fa-stethoscope me-1"></i>{{ store.probing[ep.id] ? $t('mcp.checking') : $t('mcp.check') }}
            </BButton>
          </div>
        </div>

        <!-- The bridge's target: a running pod with ComfyUI, the Mac's own, or a typed URL; it flows into the command and every snippet. -->
        <BRow v-if="ep.id === 'comfy-bridge'" class="g-2 align-items-end mt-1" data-testid="mcp-target">
          <BCol md="7">
            <BFormGroup :label="$t('mcp.target')" label-for="mcp-target-select" class="mb-0">
              <BFormSelect id="mcp-target-select" v-model="choice" :options="targetOptions" size="sm" data-testid="mcp-target-select" @update:model-value="onChoice" />
            </BFormGroup>
          </BCol>
          <BCol v-if="choice === CUSTOM" md="5">
            <div class="d-flex gap-1">
              <BFormInput v-model.trim="typed" size="sm" :placeholder="$t('mcp.targetPlaceholder')" data-testid="mcp-target-url" @keydown.enter.prevent="applyTyped" />
              <BButton size="sm" variant="primary" :disabled="!typed" data-testid="mcp-target-apply" @click="applyTyped">{{ $t('mcp.targetApply') }}</BButton>
            </div>
          </BCol>
          <BCol cols="12"><div class="form-text mt-0">{{ $t('mcp.targetHelp') }}</div></BCol>
        </BRow>

        <div class="mt-3">
          <div class="d-flex align-items-center justify-content-between mb-1">
            <small class="text-body-secondary">{{ $t('mcp.command') }}</small>
            <BButton size="sm" variant="outline-light" class="flex-shrink-0 text-nowrap ms-2" data-testid="mcp-copy-command" @click="store.copy(ep.command_line, $t('mcp.whatCommand', { name: ep.title }))"><i class="fa-regular fa-copy me-1"></i>{{ $t('mcp.copy') }}</BButton>
          </div>
          <code class="d-block small p-2 rounded border bg-body text-break" data-testid="mcp-command">{{ ep.command_line }}</code>
        </div>

        <div v-if="store.results[ep.id]" class="mt-2" data-testid="mcp-result" :data-ok="store.results[ep.id].ok ? 'true' : 'false'">
          <template v-if="store.results[ep.id].ok">
            <small class="text-body-secondary d-block" data-testid="mcp-result-facts">{{ store.results[ep.id].tools.length ? $t('mcp.tools', { n: store.results[ep.id].tools.length, ms: store.results[ep.id].ms }) : $t('mcp.noTools') }}</small>
          </template>
          <BBadge v-else variant="danger" class="fw-normal text-wrap text-start" data-testid="mcp-result-error"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ store.results[ep.id].error || $t('mcp.noAnswer') }}</BBadge>
        </div>

        <div class="d-flex align-items-center gap-2 mt-3 mb-2">
          <h6 class="mb-0 small text-uppercase text-body-secondary">{{ $t('mcp.clients') }}</h6>
          <BFormSelect v-model="client" :options="CLIENTS.map((c) => ({ value: c.key, text: $t(c.label) }))" size="sm" style="max-width: 16rem" data-testid="mcp-client-select" />
        </div>
        <div v-for="c in CLIENTS.filter((x) => x.key === client)" :key="c.key" class="mb-2" data-testid="mcp-client" :data-client="c.key">
          <div class="d-flex align-items-start justify-content-between gap-3 mb-1">
            <small class="text-body-secondary lh-sm flex-grow-1 min-w-0" data-testid="mcp-client-hint">{{ $t(c.hint) }}</small>
            <BButton size="sm" variant="outline-light" class="flex-shrink-0 text-nowrap" data-testid="mcp-copy" @click="store.copy(ep.clients[c.key], $t('mcp.whatSnippet', { name: ep.title, client: $t(c.label) }))"><i class="fa-regular fa-copy me-1"></i>{{ $t('mcp.copy') }}</BButton>
          </div>
          <pre class="small p-2 rounded border bg-body mb-0 text-wrap" data-testid="mcp-snippet">{{ ep.clients[c.key] }}</pre>
        </div>
      </div>
    </div>
    <McpDocsModal v-if="docsEp" :model-value="true" :ep="docsEp" @update:model-value="docsFor = ''" />
  </div>
</template>

<script setup>
/**
 * McpPane — the MCP tab of the Connect modal: one card per endpoint (docs/MCP-ENDPOINTS.md) with its
 * purpose, the stdio command, a connection badge (the core spawns every server when the tab is shown and lists its tools), Check
 * (the same probe again, with a toast), Docs (a modal with the tools and their parameters) and a setup snippet per client with a Copy button. The bridge card has the target
 * menu; the store re-asks the core for the snippets whenever it changes. Loads when its tab is shown.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useMcpStore } from '../stores/mcp'
import { t } from '../i18n'
import McpDocsModal from './McpDocsModal.vue'
import McpStatus from './McpStatus.vue'
import McpTarget from './McpTarget.vue'

const props = defineProps({ active: { type: Boolean, default: false } })
const store = useMcpStore()
const docsFor = ref('')   // the endpoint whose Docs modal is open
const docsEp = computed(() => store.endpoints.find((e) => e.id === docsFor.value))

/** The client whose setup shows, one at a time; remembered in this browser. */
const client = ref('claude_code')
try { const saved = localStorage.getItem('runpod-manager.mcp-client'); if (saved) client.value = saved } catch { /* storage blocked */ }
watch(client, (v) => { try { localStorage.setItem('runpod-manager.mcp-client', v) } catch { /* storage blocked */ } })

const CLIENTS = [
  { key: 'claude_code', label: 'mcp.claudeCode', hint: 'mcp.claudeCodeHint' },
  { key: 'claude_desktop', label: 'mcp.claudeDesktop', hint: 'mcp.claudeDesktopHint' },
  { key: 'codex', label: 'mcp.codex', hint: 'mcp.codexHint' },
  { key: 'chatgpt', label: 'mcp.chatgpt', hint: 'mcp.chatgptNote' },
]

const CUSTOM = '__custom__'
const typed = ref('')
// The menu's value: the chosen target's URL, '' for "let the bridge pick", or CUSTOM while a URL is being typed.
const choice = ref('')
const targetOptions = computed(() => [
  { value: '', text: t('mcp.targetAuto') },
  ...store.targets.map((x) => ({ value: x.url, text: `${x.name} · ${x.url}` })),
  { value: CUSTOM, text: t('mcp.targetCustom') },
])
function syncChoice() {
  const url = store.target
  choice.value = !url ? '' : store.targets.some((x) => x.url === url) ? url : CUSTOM
  if (choice.value === CUSTOM) typed.value = url
}
function onChoice(v) {
  if (v === CUSTOM) return   // wait for the typed URL
  store.setTarget(v)
}
function applyTyped() { if (typed.value) store.setTarget(typed.value) }

watch(() => [store.target, store.targets], syncChoice, { deep: true })

// Lazy tab: the pane mounts when its tab is shown, so load on mount; the `active` watch covers a re-show without a remount.
onMounted(async () => { await store.load(); syncChoice(); store.checkAll() })
watch(() => props.active, async (a) => { if (a) { await store.load(); store.checkAll() } })
</script>
