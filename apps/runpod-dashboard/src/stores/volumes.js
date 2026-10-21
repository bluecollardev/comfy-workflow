import { defineStore } from 'pinia'
import { ref } from 'vue'
import { volumesAPI } from '../api/volumes'
import { useToastStore } from './toast'
import { useMountsStore } from './mounts'
import { t } from '../i18n'

/** The account's network volumes as the Volumes modal shows them; every action toasts and reloads the list. */
export const useVolumesStore = defineStore('volumes', () => {
  const toast = useToastStore()
  const mounts = useMountsStore()
  const volumes = ref([])
  const loading = ref(false)
  const error = ref(null)
  const busyId = ref(null)

  async function load() {
    loading.value = true; error.value = null
    try { volumes.value = (await volumesAPI.list()) || [] } catch (e) { error.value = e.response?.data?.detail || e.message } finally { loading.value = false }
  }
  async function act(id, label, action, ok) {
    busyId.value = id; error.value = null
    const r = await toast.run(t(label), action, { ok, onError: (msg) => (error.value = msg) })
    busyId.value = null
    if (r.ok) await load()
    return r
  }
  const create = (input) => act(null, 'toast.createVolume', () => volumesAPI.create(input), t('toast.volumeCreated', { name: input.name }))
  const resize = (v, size_gb) => act(v.id, 'toast.resizeVolume', () => volumesAPI.resize(v.id, size_gb), t('toast.volumeResized', { name: v.name, size: size_gb }))
  const remove = async (v) => { const r = await act(v.id, 'toast.deleteVolume', () => volumesAPI.remove(v.id), t('toast.volumeDeleted', { name: v.name })); if (r.ok) mounts.load(); return r }
  const useAsDefault = async (v) => { const r = await act(v.id, 'toast.defaultVolume', () => volumesAPI.useAsDefault(v.id), t('toast.volumeDefault', { name: v.name, dc: v.datacenter })); if (r.ok) mounts.load(); return r }
  return { volumes, loading, error, busyId, load, create, resize, remove, useAsDefault }
})
