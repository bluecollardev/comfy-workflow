import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
})

export const podAPI = {
  // Get dashboard data
  async getDashboard() {
    const response = await api.get('/dashboard')
    return response.data
  },

  // List all pods
  async getPods() {
    const response = await api.get('/pods')
    return response.data
  },

  // Get specific pod
  async getPod(podId) {
    const response = await api.get(`/pods/${podId}`)
    return response.data
  },

  // Stop pod
  async stopPod(podId) {
    const response = await api.post(`/pods/${podId}/stop`)
    return response.data
  },

  // Resume pod
  async resumePod(podId) {
    const response = await api.post(`/pods/${podId}/resume`)
    return response.data
  },

  // Delete pod
  async deletePod(podId) {
    const response = await api.delete(`/pods/${podId}`)
    return response.data
  },

  // WebSocket for real-time updates
  subscribeToUpdates(callback) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://localhost:8000/ws/pods`)

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      callback(data)
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    return ws
  },
}
