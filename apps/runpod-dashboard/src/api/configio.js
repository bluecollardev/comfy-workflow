import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Export and import of the Default Configuration as a JSON file (docs/ADR-023). The core over IPC in the app, where the file dialogs are the native ones
// (window.core.files, picked in the main process); the same calls over HTTP against the fake API in a browser, where the file is a download and an <input type=file>.
const ipc = core && {
  export: (includeSecrets) => core.invoke('configio', 'export', [{ includeSecrets: includeSecrets === true }]),   // only an explicit true carries the keys
  suggestedName: () => core.invoke('configio', 'suggestedName'),
  plan: (file) => core.invoke('configio', 'plan', [file]),
  apply: (file, sections) => core.invoke('configio', 'apply', [file, sections]),
  undo: () => core.invoke('configio', 'undo'),
  backups: () => core.invoke('configio', 'backups'),
}
const http = {
  async export(includeSecrets) { const { data } = await axios.get(`${API_BASE}/configio/export`, { params: { secrets: includeSecrets === true ? 1 : 0 } }); return data },
  async suggestedName() { const d = new Date(); return `pod-manager-config-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json` },
  async plan(file) { const { data } = await axios.post(`${API_BASE}/configio/plan`, { file }); return data },
  async apply(file, sections) { const { data } = await axios.post(`${API_BASE}/configio/apply`, { file, sections }); return data },
  async undo() { const { data } = await axios.post(`${API_BASE}/configio/undo`); return data },
  async backups() { const { data } = await axios.get(`${API_BASE}/configio/backups`); return data },
}
export const configioAPI = ipc || http

/** Save text as a file the user names: the native Save dialog in the app (resolves { path } or { canceled: true }), a download in a browser. */
export async function saveTextFile(name, text) {
  if (core?.files) return core.files.saveText(name, text)
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { path: name }
}

/** The native Open dialog (resolves { name, text } or { canceled: true }); in a browser the page uses its own <input type=file> instead (see ConfigIoPanel). */
export const openTextFile = () => (core?.files ? core.files.openText() : null)
export const hasNativeFiles = () => !!core?.files
