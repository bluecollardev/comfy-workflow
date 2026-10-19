import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { mountsAPI } from '../api/mounts'
import { useToastStore } from './toast'
import { t } from '../i18n'

/**
 * The mount configuration as the API reports it (GET /api/mounts): the config itself, the
 * folder rows with what the project tree declares, the derived links, the mode, and what a
 * runtime receives. The Configuration modal edits a copy and saves through here; the pod form
 * reads the summary, the configured image and the idle default from here.
 */
export const useMountsStore = defineStore('mounts', () => {
  const toast = useToastStore()
  const payload = ref(null)
  const loading = ref(false)
  const error = ref(null)

  const config = computed(() => payload.value?.config || null)
  const folders = computed(() => payload.value?.folders || [])
  const links = computed(() => payload.value?.links || [])
  const mode = computed(() => payload.value?.mode || 'dev')
  const requireSource = computed(() => payload.value?.require_source || 'config')
  const configuredImage = computed(() => config.value?.image || '')
  const configuredIdle = computed(() => config.value?.idle_stop_minutes ?? 30)
  const applyByDefault = computed(() => config.value?.apply_by_default !== false)
  const summary = computed(() => {
    const c = config.value
    if (!c) return ''
    const mapped = folders.value.filter((f) => f.local).length
    return (c.network_volume_id ? t('form.summaryVolume', { id: c.network_volume_id, path: c.mount_path }) : t('form.summaryNoVolume')) + ', ' + t('form.summaryMapped', { mapped, total: folders.value.length, links: links.value.length })
  })

  async function load() {
    loading.value = true
    error.value = null
    try { payload.value = await mountsAPI.get() } catch (e) { error.value = e.response?.data?.detail || e.message } finally { loading.value = false }
    return payload.value
  }

  async function save(body) {
    const r = await toast.run(t('toast.saveConfig'), () => mountsAPI.save(body), { ok: t('toast.configSaved'), onError: (msg) => (error.value = msg) })
    if (r.ok) payload.value = r.value
    return r
  }

  async function reset() {
    const r = await toast.run(t('toast.clearConfig'), () => mountsAPI.reset(), { ok: t('toast.configCleared'), onError: (msg) => (error.value = msg) })
    if (r.ok) payload.value = r.value
    return r
  }

  return { payload, loading, error, config, folders, links, mode, requireSource, configuredImage, configuredIdle, applyByDefault, summary, load, save, reset }
})
