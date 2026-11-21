'use strict'
// A pool and a memory cache for the pod's PREVIEW images (ADR-055 section 15). The Outputs strips and grids ask /view for hundreds of tiny JPEGs (`.previews/<folder>/<frame>.jpg`, `.../thumbs/`, `.../posters/`);
// the podfile:// handler used to fetch each from RunPod's proxy every time, without limit, and sent no caching header. Here: at most `concurrency` fetches at once, one fetch per address however many tiles ask,
// and a memory LRU kept for `ttlMs` (a preview is written once; Skip Existing unticked makes it again, so it is trusted only for a while). Only small image answers (HTTP 200, under 2 MB) are kept. `fetcher()` is passed in.
const MAX_ITEM = 2 * 1024 * 1024
/** A /view search that is a preview: subfolder starts with `.previews/` (never a delivery or a render). */
const isPreviewSearch = (search) => { try { return /^\.previews\//.test(new URL(`http://x/view${search}`).searchParams.get('subfolder') || '') } catch { return false } }

function createPreviewCache({ concurrency = 8, items = 1500, ttlMs = 30 * 60e3, now = () => Date.now() } = {}) {
  const mem = new Map(), inflight = new Map(), waiting = []
  let live = 0
  const stat = { hits: 0, fetched: 0, deduped: 0, max_live: 0 }
  const pump = () => {
    while (live < concurrency && waiting.length) {
      const w = waiting.shift(); live++; stat.max_live = Math.max(stat.max_live, live)
      Promise.resolve().then(w.fn).then(w.res, w.rej).finally(() => { live--; pump() })
    }
  }
  const run = (fn) => new Promise((res, rej) => { waiting.push({ fn, res, rej }); pump() })
  return {
    stat,
    clear() { mem.clear() },
    /** `fetcher()` -> { status, type, body: Buffer }, called only on a miss, through the pool, once per key at a time. */
    async get(key, fetcher) {
      const m = mem.get(key)
      if (m && now() - m.at <= ttlMs) { stat.hits++; mem.delete(key); mem.set(key, m); return m }
      if (inflight.has(key)) { stat.deduped++; return inflight.get(key) }
      const p = run(async () => {
        const r = await fetcher(); stat.fetched++
        if (r.status === 200 && r.body && r.body.length > 0 && r.body.length <= MAX_ITEM && /^image\//.test(r.type || '')) { mem.set(key, { ...r, at: now() }); while (mem.size > items) mem.delete(mem.keys().next().value) }
        return r
      }).finally(() => inflight.delete(key))
      inflight.set(key, p)
      return p
    },
  }
}
module.exports = { createPreviewCache, isPreviewSearch, MAX_ITEM }
