// The persistent preview-image cache (docs/ADR-060): the small JPEG / WebP pictures the Outputs modal shows (the pod's frame previews and thumbs, video posters, image thumbnails) are kept as bytes in IndexedDB,
// so an app refresh or restart shows them with no request. Never a full DPX frame: only what is at most MAX_ITEM bytes. Every access is guarded: with no storage (private window, blocked) it works from memory
// for the session and nothing breaks. Pure (the backend and the fetcher are passed in) except `idbImageBackend` and the shared instance.
export const IMG_VERSION = 1
export const IMG_CAP = 300 * 1024 * 1024
export const MAX_ITEM = 1024 * 1024

/**
 * The cache key of a picture: its address WITHOUT the host (the same pod file is reached through a pod's proxy address, a podfile:// address or a stopped pod's saved record), so path + query. The
 * query holds filename, subfolder, type and the preview size. An s3file:// address has no host to drop (its first segment is the volume), so it is kept whole.
 */
export function imageKey(url) {
  const u = String(url || '')
  if (/^s3file:/i.test(u)) return u
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)$/i.exec(u)
  return m ? m[1] : u
}

export const memoryImageBackend = () => {
  const m = new Map()
  return { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v) }, del: async (k) => { m.delete(k) }, all: async () => [...m].map(([key, v]) => ({ key, at: v.at, size: v.size })), clear: async () => m.clear() }
}

/**
 * The store: `get(key, stamp)` answers a Blob or undefined (a record whose stamp, the file's size and time, differs from the one asked with is stale: dropped, a miss); `set(key, blob, stamp)` keeps it and evicts
 * the least recently used (by `at`, refreshed on every hit) until the total is within `cap`. `forget(part)` drops every record whose key contains `part`. Never throws.
 */
export function createImageCache(backend, { cap = IMG_CAP, maxItem = MAX_ITEM, now = () => Date.now() } = {}) {
  const safe = async (fn, d) => { try { return await fn() } catch { return d } }
  return {
    async get(key, stamp = '') {
      const rec = await safe(() => backend.get(key), undefined)
      if (!rec || !rec.buf) return undefined
      if (stamp && rec.stamp && rec.stamp !== stamp) { await safe(() => backend.del(key)); return undefined }
      safe(() => backend.put(key, { ...rec, at: now() }))   // least-recently-used: a hit is a use
      const b = new Blob([rec.buf], { type: rec.type || 'image/jpeg' }); b.stamp = rec.stamp || ''; return b
    },
    async set(key, blob, stamp = '') {
      if (!blob || !blob.size || blob.size > maxItem || !/^image\//.test(blob.type || '')) return false
      const buf = await blob.arrayBuffer()
      const ok = await safe(async () => { await backend.put(key, { v: IMG_VERSION, buf, type: blob.type, size: blob.size, stamp: stamp || '', at: now() }); return true }, false)
      if (!ok) return false
      const all = await safe(() => backend.all(), [])
      let total = all.reduce((n, r) => n + (r.size || 0), 0)
      if (total > cap) for (const r of [...all].sort((a, b) => a.at - b.at)) { if (total <= cap) break; if (r.key === key) continue; await safe(() => backend.del(r.key)); total -= r.size || 0 }
      return true
    },
    async forget(part) { const all = await safe(() => backend.all(), []); for (const r of all) if (String(r.key).includes(part)) await safe(() => backend.del(r.key)) },
    async stats() { const all = await safe(() => backend.all(), []); return { count: all.length, bytes: all.reduce((n, r) => n + (r.size || 0), 0) } },
    clear: () => safe(() => backend.clear()),
  }
}

/** IndexedDB as that backend: pictures in `imgs`, their times and sizes in `idx` (finding the oldest never reads a picture). The version is in the database name, so a new version starts clean. With no IndexedDB it works from memory. */
export function idbImageBackend(dbName = `pod-manager-images-v${IMG_VERSION}`) {
  const mem = memoryImageBackend()
  let dbp = null
  const open = () => (dbp ||= new Promise((res) => {
    try {
      const r = indexedDB.open(dbName, 1)
      r.onupgradeneeded = () => { for (const n of ['imgs', 'idx']) { try { if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n) } catch { /* exists */ } } }
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null)
    } catch { res(null) }
  }))
  const run = async (stores, mode, fn) => {
    const db = await open(); if (!db) return { ok: false }
    return new Promise((res) => { try { const t = db.transaction(stores, mode); let out; fn(...stores.map((s) => t.objectStore(s)), (v) => { out = v }); t.oncomplete = () => res({ ok: true, out }); t.onerror = () => res({ ok: false }); t.onabort = () => res({ ok: false }) } catch { res({ ok: false }) } })
  }
  return {
    async get(k) { const m = await mem.get(k); if (m) return m; const r = await run(['imgs'], 'readonly', (s, set) => { const q = s.get(k); q.onsuccess = () => set(q.result && typeof q.result === 'object' ? q.result : undefined) }); return r.out },
    async put(k, v) { const r = await run(['imgs', 'idx'], 'readwrite', (s, i) => { s.put(v, k); i.put({ at: v.at, size: v.size }, k) }); if (!r.ok) await mem.put(k, v) },
    async del(k) { await mem.del(k); await run(['imgs', 'idx'], 'readwrite', (s, i) => { s.delete(k); i.delete(k) }) },
    async all() {
      const r = await run(['idx'], 'readonly', (i, set) => { const keys = i.getAllKeys(), vals = i.getAll(); let k, v; const fin = () => { if (k && v) set(k.map((key, n) => ({ key, at: v[n]?.at || 0, size: v[n]?.size || 0 }))) }; keys.onsuccess = () => { k = keys.result; fin() }; vals.onsuccess = () => { v = vals.result; fin() } })
      const seen = new Map((r.out || []).map((x) => [x.key, x]))
      for (const x of await mem.all()) if (!seen.has(x.key)) seen.set(x.key, x)
      return [...seen.values()]
    },
    async clear() { await mem.clear(); await run(['imgs', 'idx'], 'readwrite', (s, i) => { s.clear(); i.clear() }) },
  }
}

let shared = null
export const sharedImages = () => (shared ||= createImageCache(idbImageBackend()))

// A bounded number of fetches at once, and one fetch for the same address however many tiles ask.
/** Pod preview JPEGs are tiny (a few KB), so their fetches are latency-bound: 16 at once (Lucas, 2026-11-25: faster). */
const FETCHES = 16
const live = new Map()
let running = 0
const waiting = []
const pump = () => { while (running < FETCHES && waiting.length) { const w = waiting.shift(); running++; w().finally(() => { running--; pump() }) } }
// `order` (a page position, smaller = nearer the top-left) puts a fetch ahead of later-placed ones, so the pictures load top to bottom; none goes last, in arrival order. A short settle lets a burst of tiles queue before the first starts.
const limited = (fn, order = null) => new Promise((res, rej) => {
  const w = Object.assign(() => fn().then(res, rej), { order: typeof order === 'number' ? order : Infinity })
  let i = waiting.length; while (i > 0 && waiting[i - 1].order > w.order) i--
  waiting.splice(i, 0, w); clearTimeout(timer); timer = setTimeout(pump, 25)
})
let timer = null

/**
 * The picture at `url` as a Blob: from the cache with no request, else fetched once (through `fallback`, the app's own reader, when the page cannot fetch the address) and kept. Resolves `null` when it cannot be
 * had (the caller then lets the <img> load the address itself, exactly as before). `stamp` is the file's size and time when the caller knows them: a different one is a miss.
 */
export function loadImage(url, { stamp = '', fallback, cache = sharedImages(), order = null } = {}) {
  const id = imageKey(url) + (stamp ? `#${stamp}` : '')
  const have = live.get(id); if (have) return have
  const p = (async () => {
    const hit = await cache.get(imageKey(url), stamp); if (hit) return hit
    return limited(async () => {
      let blob = null
      try {
        const r = await fetch(url)
        if (r.ok) blob = await r.blob()
      } catch {
        try { const r = await fallback?.(url); if (r && r.status >= 200 && r.status < 300 && r.bytes) blob = new Blob([r.bytes], { type: r.contentType || (/webp/.test(url) ? 'image/webp' : 'image/jpeg') }) } catch { blob = null }
      }
      if (!blob) return null
      if (/^image\//.test(blob.type)) await cache.set(imageKey(url), blob, stamp)
      return blob
    }, order)
  })().finally(() => live.delete(id))
  live.set(id, p)
  return p
}
