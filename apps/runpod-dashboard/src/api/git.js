import axios from 'axios';
import { API_BASE } from './pods';

export const gitAPI = {
  // ----- OAuth accounts -----

  // → { accounts: [{id, provider, host, username, name, avatar_url, ...}], providers: [{id, label, host, configured}] }
  async listAccounts() {
    const { data } = await axios.get(`${API_BASE}/git-accounts`);
    return data;
  },

  async disconnect(accountId) {
    await axios.delete(`${API_BASE}/git-accounts/${accountId}`);
  },

  // Browser navigates here; the provider sends it back to the UI with ?provider=&connected= or &error=
  connectUrl(provider) {
    return `${API_BASE}/auth/${provider}/start`;
  },

  // ----- repositories attached to the project -----

  // → { repositories: [{id, url, branch, name, host}] }
  async listRepositories() {
    const { data } = await axios.get(`${API_BASE}/repositories`);
    return data;
  },

  async attachRepository(url, branch) {
    const { data } = await axios.post(`${API_BASE}/repositories`, { url, branch: branch || null });
    return data;
  },

  async detachRepository(repoId) {
    await axios.delete(`${API_BASE}/repositories/${repoId}`);
  },

  // ----- live lookups (autocomplete) -----

  // Repos visible to all connected accounts → { repos: [{name, url, default_branch, private, account, provider}] }
  async searchRepos(q = '') {
    const { data } = await axios.get(`${API_BASE}/repos/search`, { params: { q } });
    return data;
  },

  // → { default, branches: string[] }
  async listBranches(url) {
    const { data } = await axios.get(`${API_BASE}/repos/branches`, { params: { url } });
    return data;
  },

  // Top-level folders of a repo → { url, branch, folders: string[] }
  async listRepoFolders(url, branch) {
    const { data } = await axios.get(`${API_BASE}/repos/folders`, { params: { url, branch } });
    return data;
  },
};
