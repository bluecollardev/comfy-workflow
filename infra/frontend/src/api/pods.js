import axios from 'axios';

const API_BASE = 'http://localhost:8000/api';

export const podsAPI = {
  // List all pods
  async listPods() {
    const { data } = await axios.get(`${API_BASE}/pods`);
    return data;
  },

  // Get single pod
  async getPod(podId) {
    const { data } = await axios.get(`${API_BASE}/pods/${podId}`);
    return data;
  },

  // Create new pod
  async createPod(podData) {
    const { data } = await axios.post(`${API_BASE}/pods`, {
      name: podData.name,
      gpu: podData.gpu,
      volume_gb: podData.volumeGb,
      disk_gb: podData.diskGb,
      image: podData.image,
    });
    return data;
  },

  // Stop a pod
  async stopPod(podId) {
    const { data } = await axios.post(`${API_BASE}/pods/${podId}/stop`);
    return data;
  },

  // Resume a pod
  async resumePod(podId) {
    const { data } = await axios.post(`${API_BASE}/pods/${podId}/resume`);
    return data;
  },

  // Delete a pod
  async deletePod(podId) {
    const { data } = await axios.delete(`${API_BASE}/pods/${podId}`);
    return data;
  },

  // Get dashboard stats
  async getDashboard() {
    const { data } = await axios.get(`${API_BASE}/dashboard`);
    return data;
  },
};
