import { API_BASE } from './pods'
import { core } from './bridge'

// A pod's log stream: pushed over IPC inside Electron, an EventSource against the API in a browser.
// `subscribe(id, opts, onEvent)` returns a stop function; onEvent gets { event } lines, { end } or { error }.
export function subscribe(id, opts, onEvent) {
  if (core?.logs) {
    const off = core.logs.onEvent((p) => { if (p.id === id) onEvent(p) })
    core.logs.start(id, opts).catch((e) => onEvent({ error: e.message }))
    return () => { off(); core.logs.stop(id) }
  }
  const q = new URLSearchParams()
  if (opts.tail != null) q.set('tail', String(opts.tail))
  if (opts.source) q.set('source', opts.source)
  const es = new EventSource(`${API_BASE}/pods/${id}/logs?${q}`)
  es.onmessage = (m) => { try { onEvent({ event: JSON.parse(m.data) }) } catch { onEvent({ event: { source: 'system', line: m.data, ts: '' } }) } }
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) onEvent({ end: true }) }
  return () => es.close()
}
