/**
 * Remote MCP servers this app USES (docs/ADR-019), as opposed to the two it provides (mcp.ts). The first is BH's Panama console
 * (`/api/mcp`, Bearer key made on its /connect page, tools by role). The key is a secret in the settings file, shown by its last four
 * characters only; the URL must be https (http only for 127.0.0.1, for tests); a redirect is never followed with the key.
 */
import { bad } from './errors.js'
import * as settings from './settings.js'
import { probeHttp, type ProbeResult } from './mcp.js'

export const DEFAULT_URL = 'https://panama-console.beinghuman.studio/api/mcp'
export const url = () => settings.lookup('PANAMA_CONSOLE_URL') || DEFAULT_URL
const key = () => settings.lookup('PANAMA_CONSOLE_KEY')

export function checkUrl(u: string): string {
  let x: URL
  try { x = new URL(u) } catch { throw bad(`Not a URL: ${u}`) }
  if (x.protocol === 'https:' || (x.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(x.hostname))) return u
  throw bad('The console URL must be https (http is allowed only for 127.0.0.1)')
}

export function status() {
  const k = key()
  return { name: 'Panama console', url: url(), key_set: !!k, key_hint: k ? `••••${k.slice(-4)}` : '' }
}

/** Save (or with null remove) the key. */
export function setKey(value: string | null) {
  settings.set({ panama_console_key: value })
  return status()
}

export interface RemoteCheck extends ProbeResult { who: string | null; role: string | null; hint: string | null }

/** Check: initialize + tools/list with the key, then whoami when the server has it. Says why when it fails (no key, 401, 403). */
export async function check(timeoutMs = 15_000): Promise<RemoteCheck> {
  const k = key()
  const empty = { tools: [], definitions: [], ms: 0, who: null, role: null }
  if (!k) return { ok: false, error: 'No console key yet: make one on the console\'s Connect page and paste it here.', hint: 'no-key', ...empty }
  const u = checkUrl(url())
  const auth = { Authorization: `Bearer ${k}` }
  const r = await probeHttp(u, timeoutMs, auth)
  const hint = r.ok ? null : /HTTP 401/.test(r.error || '') ? 'bad-key' : /HTTP 403/.test(r.error || '') ? 'role' : 'unreachable'
  let who: string | null = null, role: string | null = null
  if (r.ok && r.tools.includes('whoami')) {
    try {
      const res = await fetch(u, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...auth },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'whoami', arguments: {} } }) })
      const text = await res.text()
      const json = JSON.parse(text.trimStart().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data:')) || '').slice(5))
      const inner = JSON.parse(json?.result?.content?.[0]?.text || '{}')
      who = inner.name || inner.email || null; role = inner.role || null
    } catch { /* whoami is a nicety; the tool list already proved the key */ }
  }
  return { ...r, who, role, hint }
}
