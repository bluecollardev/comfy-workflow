/**
 * Live progress from ComfyUI on a pod (Lucas, 2026-11-21: "a hook into comfy on pod to report progress; these are generations").
 *
 * The app submits every chunk's prompt with a client id (`pod-manager-runflows`). ComfyUI sends the events of a client's prompts on its websocket
 * (`/ws?clientId=<id>`): `execution_start`, `executing` (the node now running; `node: null` ends the prompt), `progress` (value, max), the newer
 * `progress_state` (every node's value/max/state), `executed`, `execution_error` and `status` (queue_remaining). This module keeps one socket per run, turns those
 * events into a small `Live` object (node, its class and title from the graph, step k of n, percent, prompt id) and hands it to `onLive`.
 *
 * It never blocks or fails a run: no socket (the proxy refuses it, a runtime without WebSocket) means `state: 'none'` with a reason, and the caller keeps polling
 * the queue and history as before; a dropped socket reconnects with a growing wait; at most `maxPerSec` events are handled a second per run (binary previews are ignored);
 * `close()` drops the socket when the run ends. Events of a prompt that was already running before the socket opened may not be replayed: the state then reads `waiting`
 * until the next step. Tests give `wsFactory` a fake.
 */
import type { Live } from './jobsregistry.js'

export interface WsLike {
  onopen: ((e: unknown) => void) | null
  onmessage: ((e: { data: unknown }) => void) | null
  onerror: ((e: unknown) => void) | null
  onclose: ((e: { code?: number }) => void) | null
  close(): void
}
export interface LiveOpts {
  /** the pod's ComfyUI address, https://<pod id>-8188.proxy.runpod.net */ baseUrl: string
  clientId: string
  onLive: (l: Live) => void
  wsFactory?: (url: string) => WsLike
  now?: () => number
  /** events handled a second (default 4) */ maxPerSec?: number
  /** waits before the reconnects (default 1, 2, 4, 8, 15, 30, 60 s; the last repeats) */ backoffMs?: number[]
  /** this many failed connects without ever opening: `none` (default 3) */ failAfter?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}
export interface LiveHandle {
  close(): void
  /** the API graph of the prompt being submitted: node id -> class and title */ setGraph(api: Record<string, unknown>): void
  current(): Live
}

export function wsUrl(baseUrl: string, clientId: string): string {
  const b = baseUrl.replace(/\/+$/, '').replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:')
  return `${b}/ws?clientId=${encodeURIComponent(clientId)}`
}
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)

export function start(o: LiveOpts): LiveHandle {
  const now = o.now ?? Date.now, maxPerSec = o.maxPerSec ?? 4, failAfter = o.failAfter ?? 3
  const waits = o.backoffMs ?? [1000, 2000, 4000, 8000, 15_000, 30_000, 60_000]
  const setT = o.setTimer ?? ((fn: () => void, ms: number) => { const t = setTimeout(fn, ms); (t as { unref?: () => void }).unref?.(); return t })
  const clearT = o.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>))
  let graph: Record<string, unknown> = {}
  let cur: Live = { state: 'waiting', ts: now(), reason: 'connecting' }
  let ws: WsLike | null = null, timer: unknown = null, closed = false, everOpen = false, fails = 0
  let windowStart = 0, handled = 0
  const emit = (): void => { try { o.onLive({ ...cur }) } catch { /* the caller's problem never reaches the socket */ } }
  const set = (patch: Partial<Live>): void => { cur = { ...cur, ...patch, ts: now() }; emit() }
  const info = (id: string | undefined): { node?: string; node_class?: string; node_title?: string } => {
    if (!id) return {}
    const n = graph[id] as { class_type?: string; _meta?: { title?: string } } | undefined
    return { node: id, node_class: n?.class_type, node_title: n?._meta?.title }
  }
  const clearStep = { node: undefined, node_class: undefined, node_title: undefined, step: undefined, max: undefined, percent: undefined }
  function handle(raw: string): void {
    let m: { type?: string; data?: Record<string, unknown> }
    try { m = JSON.parse(raw) } catch { return }
    const t = m.type, d = m.data ?? {}
    const terminal = t === 'execution_start' || t === 'execution_error' || t === 'execution_success' || (t === 'executing' && !d.node)
    const tick = now()
    if (tick - windowStart >= 1000) { windowStart = tick; handled = 0 }
    if (!terminal && handled >= maxPerSec) return   // over the cap: a progress tick is dropped, the next one carries the value
    handled++
    const pid = typeof d.prompt_id === 'string' ? d.prompt_id : undefined
    if (t === 'execution_start') set({ state: 'live', prompt_id: pid, started_at: new Date(tick).toISOString(), ...clearStep, reason: undefined })
    else if (t === 'executing') {
      if (!d.node) set({ state: 'waiting', ...clearStep, prompt_id: pid ?? cur.prompt_id, reason: 'between prompts' })
      else set({ state: 'live', ...info(String(d.node)), step: undefined, max: undefined, percent: undefined, prompt_id: pid ?? cur.prompt_id, reason: undefined })
    } else if (t === 'progress') {
      const v = num(d.value), mx = num(d.max)
      if (v !== undefined && mx !== undefined && mx > 0) set({ state: 'live', ...(d.node ? info(String(d.node)) : {}), step: v, max: mx, percent: Math.min(100, Math.round((100 * v) / mx)), prompt_id: pid ?? cur.prompt_id, reason: undefined })
    } else if (t === 'progress_state') {
      const nodes = (d.nodes ?? {}) as Record<string, { value?: number; max?: number; state?: string; node_id?: string; display_node_id?: string }>
      const run = Object.entries(nodes).find(([, n]) => n?.state === 'running')
      if (run) {
        const [id, n] = run, v = num(n.value), mx = num(n.max)
        set({ state: 'live', ...info(String(n.display_node_id ?? n.node_id ?? id)), ...(v !== undefined && mx !== undefined && mx > 0 ? { step: v, max: mx, percent: Math.min(100, Math.round((100 * v) / mx)) } : {}), prompt_id: pid ?? cur.prompt_id, reason: undefined })
      }
    } else if (t === 'execution_error') {
      set({ state: 'live', reason: `execution error${typeof d.exception_message === 'string' ? `: ${d.exception_message.slice(0, 80)}` : ''}`, prompt_id: pid ?? cur.prompt_id })
    } else if (t === 'status') {
      const qr = num(((d.status as { exec_info?: { queue_remaining?: number } } | undefined)?.exec_info)?.queue_remaining)
      if (qr !== undefined) set({ queue_remaining: qr })
    }
  }
  function give(why: string): void {
    if (closed) return
    if (!everOpen && fails >= failAfter) set({ state: 'none', reason: `no live progress (${why})`, ...clearStep })
    else if (everOpen) set({ state: 'waiting', reason: 'reconnecting' })
    timer = setT(() => { timer = null; connect() }, waits[Math.min(Math.max(fails - 1, 0), waits.length - 1)])
  }
  function connect(): void {
    if (closed) return
    let sock: WsLike
    try {
      const make = o.wsFactory ?? ((u: string) => { const W = (globalThis as { WebSocket?: new (u: string) => WsLike }).WebSocket; if (!W) throw new Error('no WebSocket in this runtime'); return new W(u) })
      sock = make(wsUrl(o.baseUrl, o.clientId))
    } catch (e) { fails++; give((e as Error).message); return }
    ws = sock
    sock.onopen = () => { everOpen = true; fails = 0; set({ state: 'waiting', reason: 'waiting for the next step' }) }
    sock.onmessage = (ev) => { if (typeof ev.data === 'string') handle(ev.data) }   // binary frames are previews: ignored
    sock.onerror = () => { /* the close that follows is handled once */ }
    sock.onclose = (ev) => { if (ws === sock) ws = null; if (closed) return; fails++; give(`socket closed${ev?.code ? ` (${ev.code})` : ''}`) }
  }
  connect()
  return {
    close: () => { closed = true; if (timer) { clearT(timer); timer = null } try { ws?.close() } catch { /* already gone */ } ws = null },
    setGraph: (api) => { graph = api && typeof api === 'object' ? api : {} },
    current: () => ({ ...cur }),
  }
}
