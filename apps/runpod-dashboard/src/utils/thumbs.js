// Previews of DPX sequences (docs/ADR-045, ADR-037): the FIRST frame of a sequence, decoded to about 320 px, kept as a small WebP/JPEG data URL in IndexedDB.
// A frame is ~50 MB, so this is lazy and bounded: one sequence at a time, only a click loads one (a tile that scrolls away while loading is cancelled), a preview already in the cache shows at once, and a finished
// thumbnail is fetched once ever (volume + folder + first file, whatever address served it). Everything here is pure (the cache and the producer are passed in) except `idbBackend` and `produceDpxThumb`.
import { DpxError, drawToCanvas, loadDpx, problemOfError } from './dpx.js'

/** How many tiles may load by themselves per modal open: NONE (Lucas, 2026-11-17, after trying automatic loading: 'let's click the button, this causes too much loading'). A preview already in the cache still shows at once with no fetch; every other tile waits for a click on its Load preview button (or Load all previews in the modal header). A number or Infinity turns automatic loading back on. */
export const AUTO_CAP = 0
export const THUMB_WIDTH = 320

/**
 * The cache key of a sequence's thumbnail: which volume (or, with none, which pod) and which file, NEVER which address served it: the same sequence reached through a running pod,
 * a stopped pod's saved record or the S3 volume source shares one thumbnail. Size and time are not in the key (a pod's history does not know them); they are kept in the record, and a
 * file whose size is now known and differs from the record's is treated as changed (a miss).
 */
/** A small concurrency limiter: `run(fn)` starts fn when fewer than `max` are running (122 cache lookups do not open 122 transactions at once). */
export function createLimiter(max = 8) {
  let live = 0
  const waiting = []
  const next = () => { while (live < max && waiting.length) { const w = waiting.shift(); live++; Promise.resolve().then(w.fn).then(w.res, w.rej).finally(() => { live--; next() }) } }
  return (fn) => new Promise((res, rej) => { waiting.push({ fn, res, rej }); next() })
}
export const thumbKey = (scope, file) => [scope || '', file.subfolder || '', file.filename].join('|')
export const MAX_THUMBS = 500

/** The record of a finished preview: the image, or the empty-frame verdict (a decoded frame that is black or flat), with the file's size and time when known. */
const stale = (rec, job) => !!(job && rec && rec.bytes != null && job.bytes != null && rec.bytes !== job.bytes)

/** A store of thumbnails with a cap: the oldest are evicted. `backend`: { get, put, del, all() -> [{ key, at }], clear }. Never throws. */
export function createStore(backend, { cap = MAX_THUMBS, now = () => Date.now() } = {}) {
  let n = null
  const safe = async (fn, d) => { try { return await fn() } catch { return d } }
  return {
    get: (k) => safe(() => backend.get(k), undefined),
    async set(k, rec) {
      await safe(() => backend.put(k, { ...rec, at: now() }))
      const all = await safe(() => backend.all(), [])
      n = all.length
      if (all.length > cap) { const drop = [...all].sort((a, b) => a.at - b.at).slice(0, all.length - cap); for (const d of drop) await safe(() => backend.del(d.key)); n = cap }
    },
    async count() { n = (await safe(() => backend.all(), [])).length; return n },
    /** Every key in the cache from the one index read (no image is read): which previews exist, cheaply. */
    async keys() { return (await safe(() => backend.all(), [])).map((r) => r.key) },
    async clear() { await safe(() => backend.clear()); n = 0 },
  }
}
export const memoryBackend = () => {
  const m = new Map()
  return { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v) }, del: async (k) => { m.delete(k) }, all: async () => [...m].map(([key, v]) => ({ key, at: v.at })), clear: async () => m.clear(), m }
}

/** IndexedDB as that backend (records in `thumbs`, their times in `idx`, so finding the oldest never reads the images). With no IndexedDB (a blocked or private window) it works from memory and keeps nothing across restarts. */
export function idbBackend(dbName = 'pod-manager-thumbs') {
  const mem = memoryBackend()
  let dbp = null
  const open = () => (dbp ||= new Promise((res) => {
    try {
      const r = indexedDB.open(dbName, 2)
      r.onupgradeneeded = () => { for (const n of ['thumbs', 'idx']) { try { if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n) } catch { /* exists */ } } }
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null)
    } catch { res(null) }
  }))
  const run = async (stores, mode, fn) => {
    const db = await open(); if (!db) return undefined
    return new Promise((res) => { try { const t = db.transaction(stores, mode); let out; fn(...stores.map((s) => t.objectStore(s)), (v) => { out = v }); t.oncomplete = () => res(out); t.onerror = () => res(undefined); t.onabort = () => res(undefined) } catch { res(undefined) } })
  }
  const asObj = (v) => (v && typeof v === 'object' ? v : undefined)
  return {
    async get(k) { const m = mem.m.get(k); if (m) return m; let v; await run(['thumbs'], 'readonly', (s, set) => { const q = s.get(k); q.onsuccess = () => set((v = asObj(q.result))) }); return v },
    async put(k, v) { mem.m.set(k, v); await run(['thumbs', 'idx'], 'readwrite', (s, i) => { s.put(v, k); i.put(v.at, k) }) },
    async del(k) { mem.m.delete(k); await run(['thumbs', 'idx'], 'readwrite', (s, i) => { s.delete(k); i.delete(k) }) },
    async all() {
      let out
      await run(['idx'], 'readonly', (i, set) => { const keys = i.getAllKeys(), vals = i.getAll(); vals.onsuccess = () => { keys.onsuccess = () => set((out = keys.result.map((key, n) => ({ key, at: vals.result[n] })))) } })
      if (out) return out
      return mem.all()
    },
    async clear() { mem.m.clear(); await run(['thumbs', 'idx'], 'readwrite', (s, i) => { s.clear(); i.clear() }) },
  }
}

/**
 * The preview controller. `produce(job, signal)` fetches and decodes one thumbnail: resolve `{ url }`, or `{ empty: true, reason }` for an empty first frame (never cached), or throw.
 * `request(key, job, { manual })` answers `{ status }`: `ready` (+ url; from the cache with no fetch, or produced), `empty`, `error` (+ reason), `capped` (an automatic request beyond the cap: show Load preview), `aborted`.
 */
/** Put a job in the queue by its page position (`order`, smaller = nearer the top-left), after any earlier job with the same or a smaller order; jobs with no order go last, in arrival order. Previews load top to bottom (Lucas, 2026-11-25). */
export function enqueue(queue, j) {
  const o = (x) => (typeof x.order === 'number' ? x.order : Infinity)
  let i = queue.length
  while (i > 0 && o(queue[i - 1]) > o(j)) i--
  queue.splice(i, 0, j)
}
/** A tile's page position as one number: its top then its left within the nearest scrolling ancestor (scroll offset included), so it does not change as the list scrolls. */
export function elementOrder(el) {
  if (!el?.getBoundingClientRect) return null
  let p = el.parentElement
  while (p && p !== document.body && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement
  const r = el.getBoundingClientRect(), b = p && p !== document.body ? p.getBoundingClientRect() : { top: 0, left: 0 }, st = p && p !== document.body ? p.scrollTop : (window.scrollY || 0)
  return Math.round(r.top - b.top + st) * 100000 + Math.max(0, Math.round(r.left - b.left))
}
export function createThumbs({ cache, produce, concurrency = 1, autoCap = AUTO_CAP }) {
  const queue = [], running = new Set(), jobs = new Map()
  let autoUsed = 0
  const pump = () => {
    while (running.size < concurrency && queue.length) {
      const j = queue.shift()
      if (j.aborted) continue
      running.add(j)
      Promise.resolve().then(() => produce(j.job, j.ctrl.signal)).then(async (r) => {
        if (j.aborted) return j.resolve({ status: 'aborted' })
        const meta = { bytes: j.job?.bytes ?? null, modified: j.job?.modified ?? null }
        if (r && r.empty) { if (r.verdict) { try { await cache.set(j.key, { empty: true, reason: r.reason || '', ...meta }) } catch { /* no storage */ } } return j.resolve({ status: 'empty', reason: r.reason || '' }) }   // a decoded blank frame keeps its verdict; a missing or short file may be fixed, so it is asked again
        try { await cache.set(j.key, { url: r.url, ...(r.header ? { header: r.header } : {}), ...meta }) } catch { /* the tile works without storage */ }
        j.resolve({ status: 'ready', url: r.url, ...(r.header ? { header: r.header } : {}) })
      }).catch((e) => j.resolve(j.aborted || e?.name === 'AbortError' ? { status: 'aborted' } : { status: 'error', reason: e?.message || String(e), ...(e?.code ? { code: e.code } : {}) }))
        .finally(() => { running.delete(j); jobs.delete(j.key); pump() })
    }
  }
  return {
    /** A look at the cache and nothing else: `ready` / `empty` (+ cached: true) on a hit that is not stale (same bytes check as request), else `none`. Never queues, never fetches, never counts against the automatic cap. */
    async peek(key, job) {
      let hit
      try { hit = await cache.get(key) } catch { hit = undefined }
      if (hit && !stale(hit, job)) return hit.empty ? { status: 'empty', reason: hit.reason || '', cached: true } : { status: 'ready', url: hit.url, cached: true, ...(hit.header ? { header: hit.header } : {}) }
      return { status: 'none' }
    },
    async request(key, job, { manual = false, refresh = false, order = null } = {}) {
      let hit
      if (!refresh) { try { hit = await cache.get(key) } catch { hit = undefined } }   // refresh: the saved one is not read; the new one replaces it, and a failure leaves the old one where it is
      if (hit && !stale(hit, job)) return hit.empty ? { status: 'empty', reason: hit.reason || '', cached: true } : { status: 'ready', url: hit.url, cached: true, ...(hit.header ? { header: hit.header } : {}) }
      const have = jobs.get(key)
      if (have) return have.promise
      if (!manual && autoUsed >= autoCap) return { status: 'capped' }
      if (!manual) autoUsed++
      const j = { key, job, order, ctrl: new AbortController(), aborted: false }
      j.promise = new Promise((res) => { j.resolve = res })
      jobs.set(key, j); enqueue(queue, j); pump()
      return j.promise
    },
    /** Stop one sequence's preview (queued or running): the tile scrolled away. A cap slot it took is given back. */
    abort(key) { const j = jobs.get(key); if (!j) return; j.aborted = true; j.ctrl.abort(); jobs.delete(key); const i = queue.indexOf(j); if (i >= 0) { queue.splice(i, 1); j.resolve({ status: 'aborted' }) } },
    abortAll() { for (const k of [...jobs.keys()]) this.abort(k) },
    /** A modal opens: the automatic cap starts again. */
    reset() { autoUsed = 0 },
    /** A Set of the keys that have a record (a finished preview or an empty verdict): one index read, nothing fetched. */
    async keys() { try { return new Set((await cache.keys?.()) ?? []) } catch { return new Set() } },
    count: () => cache.count?.() ?? 0,
    clear: () => cache.clear?.(),
    get autoUsed() { return autoUsed },
    get active() { return jobs.size },
  }
}

/** The time limits (ms): first byte of a frame 30 s, the whole thumbnail 120 s, a list call 45 s. A test shortens them with `window.__THUMB_TIMEOUTS__ = { firstByte, whole, list }`. */
export const thumbTimeouts = () => ({ firstByte: 30_000, whole: 120_000, list: 45_000, ...(globalThis.__THUMB_TIMEOUTS__ || {}) })
/** A promise that gives up: rejects with a `code: 'timeout'` error after `ms`. */
export const withTimeout = (p, ms, what = 'The call') => new Promise((res, rej) => { const t = setTimeout(() => rej(Object.assign(new Error(`${what} did not answer in ${Math.round(ms / 1000)} s`), { code: 'timeout' })), ms); Promise.resolve(p).then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) }) })
const coded = (code, message) => Object.assign(new Error(message), { code })

/**
 * Fetch the first frame, decode it to ~320 px and make a small data URL; a blank frame (black, flat) is `{ empty: true, verdict: true }`. Every step has a limit and ends in a result or an
 * error with a `code` the tile turns into a sentence: `timeout`, `restart` (the running app has no s3file:// yet), `keys` (409 from the volume source), `pod404` (the pod does not serve the file).
 */
export async function produceDpxThumb({ url, fallback }, signal) {
  const T = thumbTimeouts(), ac = new AbortController(), isS3 = /^s3file:/.test(url)
  let timedOut = 0
  const onAbort = () => ac.abort()
  signal?.addEventListener('abort', onAbort)
  const whole = setTimeout(() => { timedOut = T.whole; ac.abort() }, T.whole)
  const first = setTimeout(() => { timedOut = T.firstByte; ac.abort() }, T.firstByte)
  const guarded = fallback && ((u) => new Promise((res, rej) => { ac.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }); Promise.resolve(fallback(u)).then(res, rej) }))
  let frame
  try { frame = await loadDpx(url, { signal: ac.signal, maxWidth: THUMB_WIDTH, fallback: guarded, onProgress: () => clearTimeout(first) }) } catch (e) {
    if (e?.name === 'AbortError') { if (timedOut && !signal?.aborted) throw coded('timeout', `No answer after ${Math.round(timedOut / 1000)} s`); throw e }
    if (e instanceof DpxError) {
      if (e.kind === 'network' && isS3) throw coded('restart', e.message)
      if (e.kind === 'http' && isS3 && e.status === 409) throw coded('keys', e.message)
      if (e.kind === 'missing' && !isS3) throw coded('pod404', e.message)
    }
    const p = problemOfError(e); if (p) return { empty: true, reason: p.kind }
    throw e
  } finally { clearTimeout(first); clearTimeout(whole); signal?.removeEventListener('abort', onAbort) }
  if (frame.problem) return { empty: true, reason: frame.problem.kind, verdict: true, stats: frame.stats || null }
  const c = document.createElement('canvas')
  drawToCanvas(c, frame)
  let url2 = c.toDataURL('image/webp', 0.75)
  if (!url2.startsWith('data:image/webp')) url2 = c.toDataURL('image/jpeg', 0.75)
  return { url: url2, ...(frame.header ? { header: { transfer: frame.header.transfer, colorimetric: frame.header.colorimetric } } : {}) }   // the header's colour fields ride with the preview: the tile's chips need them and a preview is the only thing that downloads a frame
}
/** The app's own byte reader for the page's fallback; an answer that is not a file (the running app predates s3file://) is an error, never an empty file. */
export const appReader = (core) => (core?.files?.read ? async (u) => {
  if (!/^(podfile|s3file):/.test(u)) throw new Error('the request failed')
  const r = await core.files.read(/^podfile:/.test(u) ? u.replace(/^podfile:\/\//, 'https://') : u)
  if (!r || r.ok === false || typeof r.status !== 'number') throw new Error(r?.error?.message || 'the app could not read the file')
  return r
} : undefined)

let shared = null
/** The one controller every gallery shares (the cap is per modal open: the Outputs modal calls reset()). */
export const sharedThumbs = () => (shared ||= createThumbs({ cache: createStore(idbBackend()), produce: produceDpxThumb }))
