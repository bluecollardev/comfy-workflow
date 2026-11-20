import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The library (docs/ADR-044): where rounds come from. A source only lists; every source answers with the same item shape, so Import Round does not care where a round lives.
// The BH bucket (`panama-s3`) is the first source. The core over IPC in the app; HTTP against the fake API in a browser.
// A core started before the library existed answers "no core call library.*": the window still works, with BH as the only source, until the app is relaunched.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.message || e))
const BH = { id: 'panama-s3', name: 'BH (Panama bucket)', hint: '', available: true, reason: '' }
const ipc = core && {
  async sources() { try { return await core.invoke('library', 'sources') } catch (e) { if (noCall(e)) return [BH]; throw e } },
  async list(source, opts) {
    try { return await core.invoke('library', 'list', [source || '', opts || {}]) }
    catch (e) { if (noCall(e) && (!source || source === BH.id)) return core.invoke('panama', 'rounds'); throw e }   // the same rounds, in the old shape the window also reads
  },
  // A volume source (ADR-044): can it be used now, one round described by the round adapter, one round's models checked. All read-only.
  async status(source, opts) { try { return await core.invoke('library', 'status', [source || '', opts || {}]) } catch (e) { if (noCall(e)) return { available: false, reason: 'Restart the app to list volumes (its core is older than this window)' }; throw e } },
  round: (volumeId, round, opts) => core.invoke('library', 'round', [volumeId || '', round, opts || {}]),
  preflight: (volumeId, round, opts) => core.invoke('library', 'preflight', [volumeId || '', round, opts || {}]),
  /** A round (or one shot) of the volume as a read-only tree: { entries: [{ path, dir, bytes, files? }], files, bytes, truncated }. */
  roundFiles: (volumeId, round, shot) => core.invoke('library', 'roundFiles', [volumeId || '', round, shot || '', {}]),
}
const http = {
  async sources() { const { data } = await axios.get(`${API_BASE}/library/sources`); return data },
  async list(source, opts) { const { data } = await axios.get(`${API_BASE}/library/items`, { params: { source: source || undefined, volume_id: opts?.volume_id || undefined } }); return data },
  async status(source, opts) { const { data } = await axios.get(`${API_BASE}/library/status`, { params: { source: source || undefined, volume_id: opts?.volume_id || undefined } }); return data },
  async round(volumeId, round) { const { data } = await axios.get(`${API_BASE}/library/round`, { params: { volume_id: volumeId || undefined, round } }); return data },
  async roundFiles(volumeId, round, shot) { const { data } = await axios.get(`${API_BASE}/library/round-files`, { params: { volume_id: volumeId || undefined, round, shot: shot || undefined } }); return data },
  async preflight(volumeId, round, opts) { const { data } = await axios.post(`${API_BASE}/library/preflight`, { volume_id: volumeId || undefined, round, ...opts }); return data },
}
export const libraryAPI = ipc || http
