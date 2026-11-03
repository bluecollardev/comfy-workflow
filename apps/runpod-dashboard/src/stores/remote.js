import { defineStore } from 'pinia'
import { ref } from 'vue'
import { remoteAPI } from '../api/remote'
import { errorText, useToastStore } from './toast'
import { t } from '../i18n'

/** Connect › MCP › Remote servers (docs/ADR-019): BH's console: its URL, whether a key is saved, and Check. */
export const useRemoteStore = defineStore('remote', () => {
  const toast = useToastStore()
  const status = ref(null)    // { name, url, key_set, key_hint }
  const result = ref(null)    // { ok, tools, error, who, role, hint, ms }
  const checking = ref(false)
  const saving = ref(false)
  const error = ref(null)

  async function load() { try { status.value = await remoteAPI.status() } catch (e) { error.value = errorText(e) } }
  async function check() {
    checking.value = true; error.value = null
    try { result.value = await remoteAPI.check() } catch (e) { result.value = { ok: false, tools: [], error: errorText(e) } } finally { checking.value = false }
  }
  async function saveKey(key) {
    saving.value = true; error.value = null
    try { status.value = await remoteAPI.setKey(key); toast.success(t(key ? 'remoteMcp.saved' : 'remoteMcp.removed')); result.value = null; if (key) await check() }
    catch (e) { error.value = errorText(e) } finally { saving.value = false }
  }
  return { status, result, checking, saving, error, load, check, saveKey }
})
