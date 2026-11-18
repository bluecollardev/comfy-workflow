/**
 * Auto sync, the push half (docs/ADR-046 section 3): a watcher on this PC's mapped ComfyUI-Shared folders in the pod's `sync_shared` (default input, models, workflows).
 * Node's recursive `fs.watch` (FSEvents on macOS) tells which files changed; the callback ONLY records the path and re-arms the debounce (nothing slow runs in it);
 * after DEBOUNCE_MS (10 s) of quiet the collected paths are handed over to be pushed (additive, a `paths` sync: never plates, never the project tree).
 * The watcher, the timer and the clock are injected, so the tests run with a fake watcher and a fake clock. No file is read or written here.
 */
import { watch as fsWatch } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { excluded } from './syncrun.js'

export const DEBOUNCE_MS = 10_000
export interface Timer { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void }
export const realTimer: Timer = { set: (fn, ms) => { const h = setTimeout(fn, ms); if (typeof h === 'object' && 'unref' in h) h.unref(); return h }, clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
export type WatchFn = (dir: string, onChange: (filename: string | null) => void) => { close(): void }
/** The real watcher: recursive (macOS and Windows; an error is thrown on a platform that cannot, and the caller reports it). */
export const nodeWatch: WatchFn = (dir, onChange) => fsWatch(dir, { recursive: true, persistent: false }, (_event, name) => onChange(name ? String(name) : null))

/** Whether a changed path (relative to ComfyUI-Shared, `input/a/b.png`) is worth pushing: in one of the chosen folders, not OS litter, git, caches. */
export const relevant = (rel: string, dirs: string[]): boolean => {
  const parts = rel.split('/')
  return parts.length >= 2 && dirs.includes(parts[0]) && !parts.some((p) => !p || p === '..' || excluded(p))
}

/** Collects paths and flushes them once, DEBOUNCE_MS after the last one. add() only records and re-arms. */
export class Collector {
  private paths = new Set<string>()
  private handle: unknown = null
  private closed = false
  /** when the pending paths will be flushed (ms since the epoch) and when the last change came: for the sync explorer */
  dueAt = 0
  lastChangeAt = 0
  constructor(private o: { onFlush: (paths: string[]) => void | Promise<void>; delayMs?: number; timer?: Timer; now?: () => number }) {}
  get pending(): number { return this.paths.size }
  /** The paths waiting, and how many are under a folder (`input`). */
  list(): string[] { return [...this.paths] }
  pendingIn(dir: string): number { let n = 0; for (const p of this.paths) if (p.startsWith(`${dir}/`)) n++; return n }
  msLeft(): number { return this.paths.size ? Math.max(0, this.dueAt - (this.o.now ?? Date.now)()) : 0 }
  add(path: string): void {
    if (this.closed) return
    this.paths.add(path)
    const nowMs = (this.o.now ?? Date.now)(); this.lastChangeAt = nowMs; this.dueAt = nowMs + (this.o.delayMs ?? DEBOUNCE_MS)
    const t = this.o.timer ?? realTimer
    if (this.handle !== null) t.clear(this.handle)
    this.handle = t.set(() => { void this.flush() }, this.o.delayMs ?? DEBOUNCE_MS)
  }
  /** Hand over what was collected (also callable at once). Never throws. */
  async flush(): Promise<void> {
    this.handle = null
    const list = [...this.paths].sort(); this.paths.clear()
    if (!list.length) return
    try { await this.o.onFlush(list) } catch { /* the controller reports its own failures */ }
  }
  close(): void { this.closed = true; if (this.handle !== null) (this.o.timer ?? realTimer).clear(this.handle); this.handle = null; this.paths.clear() }
}

/** A running watch on a root for some folders. */
export class PushWatch {
  private watchers: { close(): void }[] = []
  /** the folders actually watched (those that exist) */
  started: string[] = []
  constructor(readonly root: string, readonly dirs: string[], readonly collector: Collector, private watch: WatchFn = nodeWatch) {}
  async start(): Promise<string[]> {
    const started: string[] = []
    for (const d of this.dirs) {
      try { await access(join(this.root, d)) } catch { continue }   // a folder that does not exist yet is not watched
      this.watchers.push(this.watch(join(this.root, d), (name) => { if (name) { const rel = `${d}/${name.split('\\').join('/')}`; if (relevant(rel, this.dirs)) this.collector.add(rel) } }))
      started.push(d)
    }
    this.started = started
    return started
  }
  close(): void { for (const w of this.watchers) { try { w.close() } catch { /* already closed */ } } this.watchers = []; this.collector.close() }
}
