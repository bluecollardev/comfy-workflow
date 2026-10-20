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
}

export const mountsAPI = ipc || http
