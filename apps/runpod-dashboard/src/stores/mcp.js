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
  const results = ref({})   // endpoint id -> { ok, tools, definitions, error, ms }

  async function load() {
    loading.value = true; error.value = null
    try {
      targets.value = (await mcpAPI.targets().catch(() => [])) || []
      if (!target.value && targets.value.length) target.value = targets.value[0].url
      endpoints.value = (await mcpAPI.endpoints(target.value)) || []
    } catch (e) { error.value = errorText(e) } finally { loading.value = false }
  }

  /** A new target for the bridge: the snippets change, so the last probe of the bridge is stale; probe it again. */
  async function setTarget(url) {
    target.value = (url || '').trim()
    delete results.value['comfy-bridge']
    delete inflight['comfy-bridge']; probing.value = { ...probing.value, 'comfy-bridge': false }
    error.value = null
    try { endpoints.value = (await mcpAPI.endpoints(target.value)) || [] } catch (e) { error.value = errorText(e) }
    if (target.value) probe('comfy-bridge')
  }

  const inflight = {}   // endpoint id -> the running probe, shared by Check, Docs and the automatic probe

  /** The probe itself, no toast: the core spawns the server and lists its tools. Always resolves to a result. */
  function probe(id) {
    if (inflight[id]) return inflight[id]
    probing.value = { ...probing.value, [id]: true }
    const run = (async () => {
      let r
      try {
        const p = await mcpAPI.probe(id, target.value)
        r = p?.ok ? p : { tools: [], definitions: [], ms: 0, ...p, ok: false, error: p?.error || t('mcp.noAnswer') }
      } catch (e) { r = { ok: false, tools: [], definitions: [], error: errorText(e), ms: 0 } }
      if (inflight[id] === run) {   // a target change in between makes this answer stale
        delete inflight[id]
        probing.value = { ...probing.value, [id]: false }
        results.value = { ...results.value, [id]: r }
      }
      return r
    })()
    inflight[id] = run
    return run
  }

  /** Check: probe, and say how it went in a toast. */
  async function check(id) {
    const name = endpoints.value.find((e) => e.id === id)?.title || id
    const r = await probe(id)
    if (r.ok) toast.success(t('toast.mcpChecked', { name }))
    else toast.error(t('toast.failedWith', { label: t('toast.mcpCheck', { name }), error: r.error }))
    return r
  }

  /** What Docs needs: the last result, or a probe of its own. */
  const ensure = (id) => results.value[id] || probe(id)

  /** The automatic probe when the tab is shown: every endpoint with no result yet (the bridge only with a target). */
  function checkAll() {
    for (const ep of endpoints.value) {
      if (results.value[ep.id] || inflight[ep.id]) continue
      if (ep.id === 'comfy-bridge' && !ep.target) continue
      probe(ep.id)
    }
  }

  /** Copy a snippet; the toast names what went to the clipboard. */
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); toast.info(t('mcp.copied', { what })) } catch (e) { toast.error(t('mcp.copyFailed', { error: errorText(e) })) }
  }

  return { endpoints, targets, target, loading, error, probing, results, load, setTarget, check, ensure, checkAll, copy }
})
