import axios from 'axios';
import { core } from './bridge';

// Dev server (Vite on :5173) talks to the API cross-origin; a production build is served by the
// API itself (and by the Electron app), so it uses the same origin — no CORS, OAuth lands home.
export const API_BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:8000/api' : '/api');

const toRequest = (podData) => ({
  name: podData.name,
  gpu: podData.gpu,
  gpu_count: podData.gpuCount || 1,
  data_center_id: podData.dataCenterId || null,   // a choice without a network volume; with one, the volume's datacenter wins
  instance_type: podData.instanceType || 'spot',
  volume_gb: podData.volumeGb ?? 0,
  disk_gb: podData.diskGb || 20,
  image: podData.image || 'configured',
  idle_stop_minutes: podData.idleStopMinutes ?? null,
  env_vars: podData.envVars || {},
  build_args: podData.buildArgs || {},
  pip_requirements: podData.pipRequirements || '',
  custom_nodes: podData.customNodes || [],
  start_ssh: podData.startSsh !== false,
  start_jupyter: podData.startJupyter === true,
  apply_mounts: podData.applyMounts !== false,
  config: podData.config || null,   // this pod's own configuration (the Default Configuration's shape), or the default
});

// Inside Electron every call goes to the core over IPC; in a browser, to the API over HTTP.
const ipc = core && {
  listPods: () => core.invoke('pods', 'list'),
  getPod: (id) => core.invoke('pods', 'get', [id]),
  createPod: (podData) => core.invoke('pods', 'create', [toRequest(podData)]),
  gpus: (dc) => core.invoke('pods', 'gpus', [dc || '']),
  volume: (id) => core.invoke('pods', 'volume', [id || '']),
  datacenters: (fresh) => core.invoke('pods', 'datacenters', [!!fresh]),
  setIdle: (id, minutes) => core.invoke('pods', 'setIdle', [id, minutes]),
  stopPod: (id) => core.invoke('pods', 'stop', [id]),
  resumePod: (id) => core.invoke('pods', 'resume', [id]),
  deletePod: (id) => core.invoke('pods', 'remove', [id]),
  getDashboard: () => core.invoke('pods', 'dashboard'),
  details: (id) => core.invoke('pods', 'details', [id]),
  recreate: (id) => core.invoke('pods', 'recreate', [id]),
  config: (id) => core.invoke('pods', 'config', [id]),
  setConfig: (id, config) => core.invoke('pods', 'setConfig', [id, config]),
};

const http = {
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
    const { data } = await axios.post(`${API_BASE}/pods`, toRequest(podData));
    return data;
  },

  // The GPU menu the API allows (16-24 GB cards, cheapest first)
  async gpus(dc) {
    const { data } = await axios.get(`${API_BASE}/gpus`, { params: dc ? { dc } : {} });
    return data;
  },
  async volume(id) {
    const { data } = await axios.get(`${API_BASE}/volumes/${encodeURIComponent(id)}`);
    return data;
  },
  async datacenters(fresh) {
    const { data } = await axios.get(`${API_BASE}/datacenters`, { params: fresh ? { fresh: 1 } : undefined });
    return data;
  },

  // Watch a pod for idleness (minutes > 0) or stop watching it (0)
  async setIdle(podId, minutes) {
    const { data } = await axios.put(`${API_BASE}/pods/${podId}/idle`, null, { params: { minutes } });
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

  // Same pod, new host: for a stopped pod whose host has no free GPU
  async recreate(id) {
    const { data } = await axios.post(`${API_BASE}/pods/${id}/recreate`);
    return data;
  },

  // A pod's own configuration (null = the Default Configuration), and setting or clearing it
  async config(id) {
    const { data } = await axios.get(`${API_BASE}/pods/${id}/config`);
    return data;
  },
  async setConfig(id, config) {
    const { data } = await axios.put(`${API_BASE}/pods/${id}/config`, config);
    return data;
  },

  // The pod as RunPod describes it: status text, price, place, card, console link
  async details(id) {
    const { data } = await axios.get(`${API_BASE}/pods/${id}/details`);
    return data;
  },
};

export const podsAPI = ipc || http;
