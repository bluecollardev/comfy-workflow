import axios from 'axios';
import { API_BASE } from './pods';
import { core } from './bridge';

// Git accounts (OAuth) and the repositories attached to the project. Inside Electron the core
// answers over IPC (git.ts, repositories.ts); in a browser the API over HTTP. Same names and
// shapes either way, except connecting: over HTTP the page follows a link and the provider
// redirects back to it; in Electron `connect` runs the whole round-trip (system browser,
// loopback callback) and resolves with the account.
const ipc = core && {
  // ----- OAuth accounts -----
  listAccounts: () => core.invoke('git', 'accounts'),
  disconnect: (accountId) => core.invoke('git', 'disconnect', [accountId]),
  connectUrl: () => undefined,   // no link to follow in Electron: `connect` opens the browser itself
  connect: (provider) => core.invoke('git', 'connect', [provider]),   // → the connected account {id, provider, host, username, ...}
  // ----- repositories attached to the project -----
  listRepositories: () => core.invoke('repositories', 'list'),
  attachRepository: (url, branch) => core.invoke('repositories', 'add', [url, branch || null]),
  detachRepository: (repoId) => core.invoke('repositories', 'remove', [repoId]),
  // ----- live lookups (autocomplete) -----
  searchRepos: (q = '') => core.invoke('repositories', 'search', [q]),
  listBranches: (url) => core.invoke('repositories', 'branches', [url]),
  listRepoFolders: (url, branch) => core.invoke('repositories', 'folders', [url, branch]),
};

const http = {
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

export const gitAPI = ipc || http;
