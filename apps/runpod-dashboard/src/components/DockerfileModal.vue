<template>
  <BModal :model-value="modelValue" :title="$t('dockerfile.title')" size="xl" scrollable lazy ok-only :ok-title="$t('dockerfile.close')" ok-variant="outline-light" data-testid="dockerfile-modal" @update:model-value="emit('update:modelValue', $event)" @show="open">
    <BFormGroup :label="$t('dockerfile.image')" label-for="dockerfile-image" class="mb-3">
      <BFormSelect id="dockerfile-image" v-model="current" :options="options" data-testid="dockerfile-image" @update:model-value="load" />
    </BFormGroup>
    <div v-if="loading" class="text-center text-body-secondary py-4" data-testid="dockerfile-loading"><BSpinner small class="me-2" />{{ $t('dockerfile.loading') }}</div>
    <div v-if="view" v-show="!loading">
      <BAlert v-if="view.error" :model-value="true" variant="warning" class="small py-2" data-testid="dockerfile-error"><i class="fa-solid fa-triangle-exclamation me-2"></i>{{ $t('dockerfile.error', { error: view.error }) }}</BAlert>
      <BTabs lazy content-class="pt-3" @activate-tab="(i) => (tab = TABS[i] || 'built')">
        <BTab :title="$t('dockerfile.built')" :active="tab === 'built'" :disabled="!view.built" data-testid="dockerfile-tab-built">
          <BAlert :model-value="true" variant="info" class="small py-2"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('dockerfile.builtHint') }}</BAlert>
          <div class="d-flex justify-content-end mb-1"><BButton size="sm" variant="outline-light" data-testid="dockerfile-copy-built" @click="copy(view.built)"><i class="fa-regular fa-copy me-1"></i>{{ $t('mcp.copy') }}</BButton></div>
          <pre class="small bg-body-tertiary rounded p-2 mb-0 dockerfile-text" data-testid="dockerfile-built">{{ view.built }}</pre>
        </BTab>
        <BTab :title="$t('dockerfile.source')" :active="tab === 'source'" data-testid="dockerfile-tab-source">
          <BAlert v-if="view.source" :model-value="true" variant="info" class="small py-2"><i class="fa-solid fa-circle-info me-2"></i>{{ view.source_kind === 'repo' ? $t('dockerfile.sourceHint', { path: view.source_path }) : $t('dockerfile.sourceGithub', { path: view.source_path }) }}</BAlert>
          <BAlert v-else :model-value="true" variant="warning" class="small py-2" data-testid="dockerfile-source-note"><i class="fa-solid fa-triangle-exclamation me-2"></i>{{ view.source_note || $t('dockerfile.noSource') }}<a v-if="view.source_url" :href="view.source_url" target="_blank" rel="noopener" class="ms-2" data-testid="dockerfile-source-link">{{ $t('dockerfile.openRepo') }} <i class="fa-solid fa-arrow-up-right-from-square fa-xs"></i></a></BAlert>
          <template v-if="view.source">
            <div class="d-flex justify-content-end gap-2 mb-1">
              <a v-if="view.source_kind === 'github'" :href="view.source_path" target="_blank" rel="noopener" class="btn btn-sm btn-outline-light" data-testid="dockerfile-source-link"><i class="fa-brands fa-github me-1"></i>{{ $t('dockerfile.openRepo') }}</a>
              <BButton size="sm" variant="outline-light" data-testid="dockerfile-copy-source" @click="copy(view.source)"><i class="fa-regular fa-copy me-1"></i>{{ $t('mcp.copy') }}</BButton>
            </div>
            <pre class="small bg-body-tertiary rounded p-2 mb-0 dockerfile-text" data-testid="dockerfile-source">{{ view.source }}</pre>
          </template>
        </BTab>
        <BTab :title="$t('dockerfile.config')" :active="tab === 'config'" data-testid="dockerfile-tab-config">
          <dl class="row small mb-0" data-testid="dockerfile-config">
            <dt class="col-sm-3 text-body-secondary fw-normal">{{ $t('dockerfile.created') }}</dt><dd class="col-sm-9">{{ view.created || '—' }}</dd>
            <dt class="col-sm-3 text-body-secondary fw-normal">{{ $t('dockerfile.entrypoint') }}</dt><dd class="col-sm-9"><code>{{ view.entrypoint.join(' ') || '—' }}</code></dd>
            <dt class="col-sm-3 text-body-secondary fw-normal">{{ $t('dockerfile.cmd') }}</dt><dd class="col-sm-9"><code>{{ view.cmd.join(' ') || '—' }}</code></dd>
            <dt class="col-sm-3 text-body-secondary fw-normal">{{ $t('dockerfile.workdir') }}</dt><dd class="col-sm-9"><code>{{ view.workdir || '—' }}</code></dd>
            <dt class="col-sm-3 text-body-secondary fw-normal">{{ $t('dockerfile.ports') }}</dt><dd class="col-sm-9"><code>{{ view.ports.join(', ') || '—' }}</code></dd>
            <dt class="col-sm-3 text-body-secondary fw-normal">{{ $t('dockerfile.env') }}</dt>
            <dd class="col-sm-9"><div v-for="e in view.env" :key="e" class="font-monospace text-break" data-testid="dockerfile-env">{{ e }}</div><span v-if="!view.env.length">—</span></dd>
            <dt class="col-sm-3 text-body-secondary fw-normal">{{ $t('dockerfile.labels') }}</dt>
            <dd class="col-sm-9"><div v-for="(v, k) in view.labels" :key="k" class="font-monospace text-break" data-testid="dockerfile-label">{{ k }}={{ v }}</div><span v-if="!Object.keys(view.labels).length">—</span></dd>
          </dl>
        </BTab>
      </BTabs>
    </div>
  </BModal>
</template>

<script setup>
/**
 * DockerfileModal — what an image is made of. A menu of the images the form can boot (the configured one, the stock one,
 * a typed one); picking one swaps the content: the Dockerfile reconstructed from the image's build history (from the
 * registry, nothing pulled), the repo's source Dockerfile, and the image's config (env, ports, entrypoint, labels).
 */
import { computed, ref } from 'vue'
import { imagesAPI } from '../api/images'
import { useToastStore } from '../stores/toast'
import { useMountsStore } from '../stores/mounts'
import { t } from '../i18n'

const props = defineProps({ modelValue: Boolean, image: { type: String, default: '' }, custom: { type: String, default: '' }, thisPod: Boolean })
const emit = defineEmits(['update:modelValue'])
const mounts = useMountsStore()
const toast = useToastStore()
const PREBUILT = 'ashleykza/comfyui:latest'

const options = computed(() => {
  const list = []
  const configured = props.image || mounts.configuredImage
  if (configured) list.push({ value: configured, text: t(props.thisPod ? 'dockerfile.optThisPod' : 'dockerfile.optConfigured', { ref: configured }) })
  if (!list.some((o) => o.value === PREBUILT)) list.push({ value: PREBUILT, text: t('dockerfile.optPrebuilt', { ref: PREBUILT }) })
  if (props.custom && !list.some((o) => o.value === props.custom)) list.push({ value: props.custom, text: t('dockerfile.optCustom', { ref: props.custom }) })
  return list
})
const current = ref('')
const TABS = ['built', 'source', 'config']
const tab = ref('built')   // kept across image swaps: you stay on the tab you were reading
const view = ref(null)
const loading = ref(false)

async function load(image) {
  loading.value = true   // the last view stays mounted (hidden) so the active tab survives the swap
  try { view.value = await imagesAPI.dockerfile(image) } catch (e) { view.value = { image, error: e.response?.data?.detail || e.message, built: null, source: null, source_path: null, env: [], ports: [], entrypoint: [], cmd: [], labels: {}, workdir: '', created: null } }
  loading.value = false
}
function open() { current.value = props.custom || props.image || options.value[0]?.value || ''; load(current.value) }
async function copy(text) {
  try { await navigator.clipboard.writeText(text || ''); toast.info(t('dockerfile.copied')) } catch { /* clipboard blocked */ }
}
</script>

<style scoped>
.dockerfile-text { max-height: 55vh; overflow: auto; white-space: pre; }
</style>
