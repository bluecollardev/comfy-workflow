import axios from 'axios'
import { API_BASE } from './pods'
import { core } from './bridge'

// Mount configuration: the three folders mapped on this PC (project tree, plates, ComfyUI-Shared)
// and how a pod gets them. The API stores the mapping in ~/.config/runpod-pod-manager/mounts.json
// and derives everything else. See docs/MOUNT-POINTS.md.
const ipc = core && {
  get: () => core.invoke('mounts', 'get'),
  save: (config) => core.invoke('mounts', 'put', [config]),
  reset: () => core.invoke('mounts', 'reset'),
  // The derived rows for a configuration that is not saved: a pod's own configuration being edited
  preview: (config) => core.invoke('mounts', 'preview', [config]),
  dirs: (path = '', hidden = false) => core.invoke('mounts', 'dirs', [path, hidden]),
  volumes: () => core.invoke('mounts', 'volumes', []),
}

const http = {
  async get() {
    const { data } = await axios.get(`${API_BASE}/mounts`)
    return data
  },
  async save(config) {
    const { data } = await axios.put(`${API_BASE}/mounts`, config)
    return data
  },
  async reset() {
    const { data } = await axios.delete(`${API_BASE}/mounts`)
    return data
  },
  async preview(config) {
    const { data } = await axios.post(`${API_BASE}/mounts/preview`, config)
    return data
  },
  // Folder picker: subfolders of a folder on this PC; empty path = home.
  async dirs(path = '', hidden = false) {
    const { data } = await axios.get(`${API_BASE}/fs/dirs`, { params: { path, hidden } })
    return data
  },
  // The mounted volumes (v1.5.1): name, path, link, target, size_bytes, free_bytes, readable, reason
  async volumes() {
    const { data } = await axios.get(`${API_BASE}/fs/volumes`)
    return data
  },
}

const base = ipc || http
/** The volumes list; a core older than v1.5.1 has no such call: an empty list, quietly (the Volumes section hides). */
const volumes = async () => { try { const r = await base.volumes(); return Array.isArray(r) ? r : [] } catch (e) { if (/no core call/i.test(String(e?.response?.data?.detail || e?.message || e))) return []; throw e } }
export const mountsAPI = { ...base, volumes }
