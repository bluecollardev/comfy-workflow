import axios from 'axios'
import { API_BASE } from './pods'

// Mount configuration: the binc-PC paths a pod must make resolve and where on its volume they
// live. Defaults come from shared/shapes/mount-points.json; the API stores edits in
// ~/.config/runpod-pod-manager/mounts.json. See docs/MOUNT-POINTS.md.
export const mountsAPI = {
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
}
