import axios from 'axios';

// Dev server (Vite on :5173) talks to the API cross-origin; a production build is served by the
// API itself (and by the Electron app), so it uses the same origin — no CORS, OAuth lands home.
export const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:8000/api' : '/api');

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
      gpu_count: podData.gpuCount || 1,
      instance_type: podData.instanceType || 'on-demand',
      volume_gb: podData.volumeGb || 50,
      disk_gb: podData.diskGb || 20,
      image: podData.image || 'prebuilt',
      env_vars: podData.envVars || {},
      build_args: podData.buildArgs || {},
      pip_requirements: podData.pipRequirements || '',
      custom_nodes: podData.customNodes || [],
      start_ssh: podData.startSsh !== false,
      start_jupyter: podData.startJupyter === true,
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
