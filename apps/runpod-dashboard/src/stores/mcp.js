import { defineStore } from 'pinia'
import { ref } from 'vue'
import { mcpAPI } from '../api/mcp'
import { errorText, useToastStore } from './toast'
import { t } from '../i18n'

/**
 * The Connect › MCP tab: the two endpoints as the core describes them (program path, command, one snippet
 * per client), the bridge's target menu, and Check per endpoint. The target is the bridge's ComfyUI URL:
 * changing it asks the core for the endpoints again, so every snippet carries it; '' means the bridge
 * picks the first running pod itself when a client launches it.
 */
export const useMcpStore = defineStore('mcp', () => {
  const toast = useToastStore()
  const endpoints = ref([])
  const targets = ref([])
  const target = ref('')
  const loading = ref(false)
  const error = ref(null)
  const probing = ref({})   // endpoint id -> true while Check runs
  const results = ref({})   // endpoint id -> { ok, tools, error, ms }

  async function load() {
    loading.value = true; error.value = null
    try {
      targets.value = (await mcpAPI.targets().catch(() => [])) || []
      if (!target.value && targets.value.length) target.value = targets.value[0].url
      endpoints.value = (await mcpAPI.endpoints(target.value)) || []
    } catch (e) { error.value = errorText(e) } finally { loading.value = false }
  }

  /** A new target for the bridge: the snippets change, so a Check on the bridge is no longer current. */
  async function setTarget(url) {
    target.value = (url || '').trim()
    delete results.value['comfy-bridge']
    error.value = null
    try { endpoints.value = (await mcpAPI.endpoints(target.value)) || [] } catch (e) { error.value = errorText(e) }
  }

  /** Check: the core spawns the server and lists its tools; a server that does not answer is a failure toast too. */
  async function check(id) {
    const ep = endpoints.value.find((e) => e.id === id)
    const name = ep?.title || id
    probing.value = { ...probing.value, [id]: true }
    const r = await toast.run(t('toast.mcpCheck', { name }), async () => {
      const p = await mcpAPI.probe(id, target.value)
      if (!p?.ok) { const e = new Error(p?.error || t('mcp.noAnswer')); e.probe = p; throw e }
      return p
    }, { ok: t('toast.mcpChecked', { name }) })
    probing.value = { ...probing.value, [id]: false }
    results.value = { ...results.value, [id]: r.ok ? r.value : (r.error?.probe || { ok: false, tools: [], error: errorText(r.error), ms: 0 }) }
    return results.value[id]
  }

  /** Copy a snippet; the toast names what went to the clipboard. */
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); toast.info(t('mcp.copied', { what })) } catch (e) { toast.error(t('mcp.copyFailed', { error: errorText(e) })) }
  }

  return { endpoints, targets, target, loading, error, probing, results, load, setTarget, check, copy }
})
