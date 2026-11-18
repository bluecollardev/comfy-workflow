/**
 * The sync run registry (docs/ADR-046, "Sync explorer and logs"): every run of syncrun.run, a person's Sync or an automatic one, is registered here from the SyncEvents it already sends.
 *  active()  the runs in flight, with the files in flight right now, the last files finished, per-folder steps, bytes, rate and time left (from memory, instantly)
 *  recent()  the finished runs, newest first (a small index in ~/.config/runpod-pod-manager/sync-runs.json, kept across a restart)
 *  log()     a run's lines (the rsync / aws output the run classifies, the plan, listing, totals and step events as readable lines, problems as warn or error, the summary);
 *            readable while the run is running
 * Logs are persisted ASYNCHRONOUSLY: lines are buffered and appended to sync-logs/<run_id>.jsonl with fs.promises (never a synchronous call: the core runs in Electron's main process).
 * A run keeps at most 5,000 lines: the first 500 and the last 4,500, with a line that says how many were omitted. Retention: 14 days and 50 MB in all, oldest removed first,
 * pruned at startup and daily, and a deletion can only ever name a `sr-*.jsonl` file inside the sync-logs folder.
 */
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import * as podnames from './podnames.js'
import { syncLogsDir, syncRunsFile } from './paths.js'
import type { SyncEvent, SyncRequest } from './syncrun.js'

export const HEAD_LINES = 500, TAIL_LINES = 4500, MAX_LINES = HEAD_LINES + TAIL_LINES
export const MAX_CURRENT = 8, MAX_RECENT = 20, MAX_INDEX = 200, KEEP_IN_MEMORY = 50
export const LOG_DAYS = 14, LOG_MAX_BYTES = 50 * 1024 * 1024
export const FLUSH_MS = 250, PRUNE_EVERY_MS = 24 * 3600_000

export type Trigger = 'manual' | 'auto-sync:output' | 'auto-sync:feed' | 'auto-sync:reconcile' | 'auto-sync:push' | 'auto-sync:enable'
export interface Line { ts: string; level: 'info' | 'warn' | 'error'; text: string; path?: string }
export interface StepView { key: string; state: 'waiting' | 'running' | 'done' | 'failed'; files_done: number; files_total: number; bytes_done: number; bytes_total: number }
export interface Flight { path: string; bytes_done: number; bytes_total: number; percent: number }
export interface ActiveRun {
  run_id: string; pod_id: string; pod_name: string; direction: 'pull' | 'push'; trigger: Trigger; state: 'queued' | 'running'; started_at: string
  steps: StepView[]; files_done: number; files_total: number; bytes_done: number; bytes_total: number; rate_bps: number; eta_s: number | null; streams: number
  current_files: Flight[]; recent_files: string[]
}
export interface FinishedRun { run_id: string; pod_id: string; pod_name: string; direction: 'pull' | 'push'; trigger: Trigger; state: 'done' | 'failed' | 'cancelled'; started_at: string; finished_at: string; files: number; bytes: number; failed: number; warned: number; summary: string; error: string }
export interface LogPage { run_id: string; lines: Line[]; total: number; truncated: boolean }

interface Run {
  view: ActiveRun; head: Line[]; tail: Line[]; omitted: number; written: number; pending: Line[]; flushing: Promise<void>
  timer: ReturnType<typeof setTimeout> | null; perStream: Map<string, Flight>; sizes: Record<string, number>; stepNow: string; problems: number; failed: number; warned: number; ended: boolean
}
const pad = (a: number) => String(a).padStart(2, '0')
const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`)

export interface Handle { run_id: string; event(e: SyncEvent): void; end(r: { cancelled?: boolean; failed?: number; warned?: number; steps?: number } | null, error?: string): void }

export class Registry {
  private runs = new Map<string, Run>()
  private finished: FinishedRun[] = []
  private ended = new Map<string, Run>()   // the newest few finished runs stay in memory: their log needs no read
  private seq = 0
  private writes = new Set<Promise<void>>()
  private indexWrite: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setInterval> | null = null
  loaded: Promise<void> = Promise.resolve()
  constructor(private o: { now?: () => number; dir?: () => string; file?: () => string } = {}) {}
  private now = () => (this.o.now ?? Date.now)()
  private dir = () => (this.o.dir ?? syncLogsDir)()
  private file = () => (this.o.file ?? syncRunsFile)()
  private iso = (ms = this.now()) => new Date(ms).toISOString()

  /** Read the index of finished runs (after a restart) and prune old logs. Async; a missing or corrupt file starts empty. */
  load(): Promise<void> {
    this.loaded = (async () => {
      try { const j = JSON.parse(await readFile(this.file(), 'utf8')); if (Array.isArray(j?.runs)) this.finished = j.runs.filter((r: FinishedRun) => r && typeof r.run_id === 'string').slice(0, MAX_INDEX) } catch { /* none yet */ }
      await this.prune().catch(() => undefined)
    })()
    return this.loaded
  }
  /** Prune daily while this process is up (idempotent). */
  start(): void { if (this.timer) return; this.timer = setInterval(() => { void this.prune().catch(() => undefined) }, PRUNE_EVERY_MS); if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref() }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null } }

  // ----- a run's life -----

  /** Register a run (queued); the handle takes its events and its end. */
  begin(req: Pick<SyncRequest, 'pod_id' | 'direction' | 'paths' | 'path_sizes' | 'trigger'>): Handle {
    const id = `sr-${this.now().toString(36)}-${(this.seq++).toString(36)}`
    const sizes = req.path_sizes ?? {}
    const view: ActiveRun = {
      run_id: id, pod_id: req.pod_id, pod_name: podnames.get(req.pod_id) || req.pod_id, direction: req.direction, trigger: (req.trigger as Trigger) || 'manual', state: 'queued', started_at: this.iso(),
      steps: [], files_done: 0, files_total: req.paths?.length ?? 0, bytes_done: 0, bytes_total: req.paths ? req.paths.reduce((a, p) => a + (sizes[p] ?? 0), 0) : 0, rate_bps: 0, eta_s: null, streams: 0, current_files: [], recent_files: [],
    }
    const run: Run = { view, head: [], tail: [], omitted: 0, written: 0, pending: [], flushing: Promise.resolve(), timer: null, perStream: new Map(), sizes, stepNow: '', problems: 0, failed: 0, warned: 0, ended: false }
    this.runs.set(id, run)
    this.line(run, 'info', `${view.trigger === 'manual' ? 'Sync' : 'Auto sync'} ${req.direction} on ${view.pod_name} queued${req.paths ? `: ${req.paths.length} files` : ''}`)
    return { run_id: id, event: (e) => { try { this.onEvent(run, e) } catch { /* the registry never breaks a sync */ } }, end: (r, error) => { try { this.finish(run, r, error) } catch { /* ditto */ } } }
  }

  private line(run: Run, level: Line['level'], text: string, path?: string): void {
    const l: Line = { ts: this.iso(), level, text: text.slice(0, 2000), ...(path ? { path } : {}) }
    if (run.head.length < HEAD_LINES) run.head.push(l)
    else { run.tail.push(l); if (run.tail.length > TAIL_LINES) { run.tail.shift(); run.omitted++ } }
    if (run.written < MAX_LINES) { run.written++; run.pending.push(l); this.scheduleFlush(run) }
  }
  private scheduleFlush(run: Run): void {
    if (run.timer) return
    run.timer = setTimeout(() => { run.timer = null; void this.flush(run) }, FLUSH_MS)
    if (typeof run.timer === 'object' && 'unref' in run.timer) run.timer.unref()
  }
  /** Append the buffered lines (fs.promises, one append per flush, chained so they stay in order). */
  flush(run: Run): Promise<void> {
    if (!run.pending.length) return run.flushing
    const lines = run.pending; run.pending = []
    const file = join(this.dir(), `${run.view.run_id}.jsonl`)
    run.flushing = run.flushing.then(async () => { await mkdir(dirname(file), { recursive: true }); await appendFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n') }).catch(() => undefined)
    return run.flushing
  }

  private onEvent(run: Run, e: SyncEvent): void {
    const v = run.view
    if (v.state === 'queued') v.state = 'running'
    switch (e.kind) {
      case 'plan': v.steps = (e.steps ?? []).map((s) => ({ key: s.key, state: 'waiting', files_done: 0, files_total: 0, bytes_done: 0, bytes_total: 0 })); this.line(run, 'info', `Plan: ${v.steps.length} folder${v.steps.length === 1 ? '' : 's'} (${v.steps.map((s) => s.key).join(', ')})`); break
      case 'listing': this.line(run, 'info', `Counting what ${e.key ?? 'the folder'} would copy`); break
      case 'totals': if (e.total_files !== undefined) v.files_total = e.total_files; if (e.total_bytes !== undefined) v.bytes_total = e.total_bytes; this.line(run, 'info', `Totals: ${e.total_files ?? '?'} files, ${e.total_bytes !== undefined ? size(e.total_bytes) : 'size unknown'}`); break
      case 'step': {
        run.stepNow = e.key ?? ''
        const s = v.steps.find((x) => x.key === e.key); if (s) { s.state = 'running'; if (e.total_files !== undefined) s.files_total = e.total_files; if (e.total_bytes !== undefined) s.bytes_total = e.total_bytes }
        if (e.streams) v.streams = e.streams
        this.line(run, 'info', `Folder ${e.key}: ${e.local ?? ''} -> ${e.remote ?? ''}${e.total_files !== undefined ? ` (${e.total_files} files${e.total_bytes !== undefined ? `, ${size(e.total_bytes)}` : ''})` : ''}`); break
      }
      case 'file': {
        const stream = e.stream ?? '.', p = e.path ?? e.text ?? ''
        const prev = run.perStream.get(stream); if (prev) this.done(run, prev)
        run.perStream.set(stream, { path: p, bytes_done: 0, bytes_total: run.sizes[p] ?? 0, percent: 0 })
        if (run.perStream.size > MAX_CURRENT) { const first = run.perStream.keys().next().value as string; const old = run.perStream.get(first)!; run.perStream.delete(first); this.done(run, old) }
        v.current_files = [...run.perStream.values()]
        this.line(run, 'info', p, p); break
      }
      case 'progress': {
        if (e.run_bytes_done !== undefined) v.bytes_done = Math.max(v.bytes_done, e.run_bytes_done)
        if (e.rate_bps !== undefined) v.rate_bps = e.rate_bps
        if (e.eta_s !== undefined) v.eta_s = e.eta_s
        const s = v.steps.find((x) => x.key === e.key); if (s && e.bytes_done !== undefined) s.bytes_done = Math.max(s.bytes_done, e.bytes_done)
        const last = [...run.perStream.values()].pop(); if (last && e.file_percent !== undefined) { last.percent = e.file_percent; last.bytes_done = last.bytes_total ? Math.round(last.bytes_total * e.file_percent / 100) : last.bytes_done }
        break
      }
      case 'problem': run.problems++; this.line(run, 'warn', e.text ?? 'problem'); break
      case 'step-done': {
        const s = v.steps.find((x) => x.key === e.key); const bad = (e.code ?? 0) !== 0 && ![23, 24].includes(e.code ?? 0)
        if (s) { s.state = bad ? 'failed' : 'done'; if (s.files_total === 0) s.files_total = s.files_done }
        if (bad) run.failed++; else if ((e.code ?? 0) !== 0) run.warned++
        this.line(run, bad ? 'error' : (e.code ?? 0) !== 0 ? 'warn' : 'info', `Folder ${e.key} finished${e.code ? ` with code ${e.code}` : ''}`); break
      }
      case 'done': this.line(run, 'info', e.text ?? 'done'); break
      case 'error': this.line(run, 'error', e.text ?? 'error'); break
      default: if (e.text) this.line(run, /^\$ /.test(e.text) ? 'info' : 'info', e.text)   // 'line': the command and the transfer's own lines
    }
  }
  private done(run: Run, f: Flight): void {
    const v = run.view
    v.files_done++; const s = v.steps.find((x) => x.key === run.stepNow); if (s) s.files_done++
    v.recent_files.push(f.path); if (v.recent_files.length > MAX_RECENT) v.recent_files.shift()
  }

  private finish(run: Run, r: { cancelled?: boolean; failed?: number; warned?: number } | null, error?: string): void {
    if (run.ended) return
    run.ended = true
    for (const f of run.perStream.values()) this.done(run, f)
    run.perStream.clear(); run.view.current_files = []
    const v = run.view, state: FinishedRun['state'] = r?.cancelled ? 'cancelled' : error || r?.failed ? 'failed' : 'done'
    const failed = r?.failed ?? run.failed, warned = r?.warned ?? run.warned
    const summary = state === 'cancelled' ? 'Cancelled' : state === 'failed' ? `Failed${error ? `: ${error}` : ` (${failed} folder${failed === 1 ? '' : 's'})`}` : `${v.files_done} file${v.files_done === 1 ? '' : 's'}${v.bytes_done ? ` (${size(v.bytes_done)})` : ''}${warned ? `, ${warned} with warnings` : ''}`
    this.line(run, state === 'failed' ? 'error' : state === 'cancelled' ? 'warn' : 'info', `Run ${state}: ${summary}`)
    const rec: FinishedRun = { run_id: v.run_id, pod_id: v.pod_id, pod_name: v.pod_name, direction: v.direction, trigger: v.trigger, state, started_at: v.started_at, finished_at: this.iso(), files: v.files_done, bytes: v.bytes_done, failed, warned, summary, error: error ?? '' }
    this.runs.delete(v.run_id)
    this.finished.unshift(rec); this.finished.length = Math.min(this.finished.length, MAX_INDEX)
    this.ended.set(v.run_id, run); if (this.ended.size > KEEP_IN_MEMORY) this.ended.delete(this.ended.keys().next().value as string)
    const w = this.persist(run); this.writes.add(w); void w.finally(() => this.writes.delete(w))
  }
  /** Wait for the pending log and index writes (tests, and a clean quit). */
  async settled(): Promise<void> { for (const r of this.runs.values()) await this.flush(r); await Promise.all([...this.writes]) }
  /** At the end: the file holds the first 500 and the last 4,500 lines with the omitted marker; then the index. */
  private async persist(run: Run): Promise<void> {
    try {
      await this.flush(run)
      if (run.omitted > 0) {   // the file got the first 5,000 lines as they came; rewrite it as head, marker, tail
        const file = join(this.dir(), `${run.view.run_id}.jsonl`), tmp = `${file}.tmp`
        await writeFile(tmp, this.lines(run).map((l) => JSON.stringify(l)).join('\n') + '\n'); await rename(tmp, file)
      }
      const snapshot = JSON.stringify({ runs: this.finished })
      this.indexWrite = this.indexWrite.then(async () => { const f = this.file(); await mkdir(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; await writeFile(tmp, snapshot); await rename(tmp, f) }).catch(() => undefined)
      await this.indexWrite
    } catch { /* a log that cannot be written is lost, never a failed sync */ }
  }
  private lines(run: Run): Line[] {
    return run.omitted > 0 ? [...run.head, { ts: run.tail[0]?.ts ?? this.iso(), level: 'warn', text: `${run.omitted} lines omitted` }, ...run.tail] : [...run.head, ...run.tail]
  }

  // ----- the reads -----

  /** The runs in flight, answered from memory. */
  active(): { items: ActiveRun[] } { return { items: [...this.runs.values()].map((r) => ({ ...r.view, steps: r.view.steps.map((s) => ({ ...s })), current_files: r.view.current_files.map((f) => ({ ...f })), recent_files: [...r.view.recent_files] })) } }
  /** The finished runs, newest first. */
  recent(podId?: string, limit = 20): FinishedRun[] { return this.finished.filter((r) => !podId || r.pod_id === podId).slice(0, Math.max(1, Math.min(limit, MAX_INDEX))) }
  /** A run's lines: from memory while it runs and for the newest finished ones, else read from its file. */
  async log(runId: string, o: { offset?: number; limit?: number; level?: string } = {}): Promise<LogPage> {
    const mem = this.runs.get(runId) ?? this.ended.get(runId)
    let all: Line[]
    if (mem) all = this.lines(mem)
    else {
      if (!/^sr-[\w-]+$/.test(runId)) throw Object.assign(new Error(`No such sync run: ${String(runId).slice(0, 60)}`), { status: 404 })
      try { all = (await readFile(join(this.dir(), `${runId}.jsonl`), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line) }
      catch { if (this.finished.some((r) => r.run_id === runId)) all = []; else throw Object.assign(new Error(`No such sync run: ${runId}`), { status: 404 }) }
    }
    const level = o.level && ['info', 'warn', 'error'].includes(o.level) ? o.level : ''
    const rank = { info: 0, warn: 1, error: 2 }
    const kept = level ? all.filter((l) => rank[l.level] >= rank[level as Line['level']]) : all
    const offset = Math.max(0, Math.floor(o.offset ?? 0)), limit = Math.max(1, Math.min(Math.floor(o.limit ?? 500), 2000))
    return { run_id: runId, lines: kept.slice(offset, offset + limit), total: kept.length, truncated: mem ? mem.omitted > 0 : all.some((l) => /lines omitted$/.test(l.text)) }
  }

  // ----- retention -----

  /** Remove log files older than 14 days, then the oldest until the folder is under 50 MB. Only `sr-*.jsonl` files inside the sync-logs folder are ever removed. */
  async prune(o: { now?: number; maxAgeDays?: number; maxBytes?: number } = {}): Promise<{ removed: number }> {
    const dir = resolve(this.dir()), now = o.now ?? this.now()
    let names: string[]
    try { names = await readdir(dir) } catch { return { removed: 0 } }
    const files: { path: string; mtime: number; size: number }[] = []
    for (const n of names) {
      if (!/^sr-[\w-]+\.jsonl$/.test(n)) continue
      const path = resolve(dir, n)
      if (dirname(path) !== dir) continue
      try { const s = await stat(path); if (s.isFile()) files.push({ path, mtime: s.mtimeMs, size: s.size }) } catch { /* gone */ }
    }
    files.sort((a, b) => a.mtime - b.mtime)
    let total = files.reduce((a, f) => a + f.size, 0), removed = 0
    const cut = now - (o.maxAgeDays ?? LOG_DAYS) * 86_400_000, cap = o.maxBytes ?? LOG_MAX_BYTES
    for (const f of files) {
      if (f.mtime >= cut && total <= cap) break
      if (dirname(f.path) !== dir || !/^sr-[\w-]+\.jsonl$/.test(basename(f.path))) continue   // the guard, once more, right before the delete
      await rm(f.path, { force: true }).catch(() => undefined); total -= f.size; removed++
    }
    return { removed }
  }
  /** Forget everything in memory (tests). */
  reset(): void { this.runs.clear(); this.ended.clear(); this.finished = []; this.stop() }
}

export const registry = new Registry()
void registry.load()
registry.start()
