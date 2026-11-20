import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AUTO_CAP, createStore, createThumbs, memoryBackend, thumbKey } from './thumbs.js'

const memCache = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v) }, m } }
const gate = () => { let go; const p = new Promise((r) => { go = r }); return { p, go } }

test('thumbKey: volume, folder and first file; never the address that served it, never the size', () => {
  const f = { subfolder: 'a/b', filename: 'x.0000.dpx', bytes: 5, modified: 't' }
  assert.equal(thumbKey('vol', f), 'vol|a/b|x.0000.dpx')
  assert.equal(thumbKey('vol', f), thumbKey('vol', { subfolder: 'a/b', filename: 'x.0000.dpx' }))   // a pod's history does not know the size: same key
  assert.notEqual(thumbKey('vol', f), thumbKey('other', f))
  assert.equal(thumbKey('', { subfolder: '', filename: 'a.dpx' }), '||a.dpx')
})

test('runs one at a time', async () => {
  let live = 0, peak = 0
  const t = createThumbs({ autoCap: Infinity, cache: memCache(), produce: async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return { url: 'data:x' } } })
  const rs = await Promise.all(['a', 'b', 'c'].map((k) => t.request(k, { k })))
  assert.deepEqual(rs.map((r) => r.status), ['ready', 'ready', 'ready']); assert.equal(peak, 1)
})

test('with a cap set (autoCap: 6) only the first 6 automatic requests load; the rest are capped until asked by a click', async () => {
  let fetched = 0
  const t = createThumbs({ cache: memCache(), produce: async () => { fetched++; return { url: 'data:x' } }, autoCap: 6 })
  const rs = []; for (let i = 0; i < 8; i++) rs.push(await t.request(`k${i}`, {}))
  assert.deepEqual(rs.map((r) => r.status), ['ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'capped', 'capped']); assert.equal(fetched, 6)
  assert.equal((await t.request('k7', {}, { manual: true })).status, 'ready'); assert.equal(fetched, 7)
  t.reset(); assert.equal((await t.request('k6', {})).status, 'ready')
})
test('by default nothing loads by itself: a cached tile shows at once, any other waits for a click, and a click loads it', async () => {
  let fetched = 0
  const cache = memCache(); await cache.set('k-cached', { url: 'data:cached' })
  const t = createThumbs({ cache, produce: async () => { fetched++; return { url: 'data:x' } } })
  assert.equal(AUTO_CAP, 0)
  const hit = await t.request('k-cached', { url: 'u' })
  assert.deepEqual([hit.status, hit.cached], ['ready', true]); assert.equal(fetched, 0)   // the cache is free
  const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => t.request(`k${i}`, { url: `u${i}` })))
  assert.deepEqual([...new Set(rs.map((r) => r.status))], ['capped']); assert.equal(fetched, 0)   // nothing fetched without a click
  const clicked = await t.request('k0', { url: 'u0' }, { manual: true })
  assert.equal(clicked.status, 'ready'); assert.equal(fetched, 1)
})

test('a cache hit means no fetch and does not use a cap slot', async () => {
  const cache = memCache(); cache.m.set('hit', { url: 'data:cached' })
  let fetched = 0
  const t = createThumbs({ cache, produce: async () => { fetched++; return { url: 'data:new' } }, autoCap: 1 })
  assert.deepEqual(await t.request('hit', {}), { status: 'ready', url: 'data:cached', cached: true }); assert.equal(fetched, 0); assert.equal(t.autoUsed, 0)
  await t.request('a', {}); await t.request('a', {})   // second one is a cache hit now
  assert.equal(fetched, 1); assert.equal(cache.m.get('a').url, 'data:new')
})

test('a decoded blank frame keeps its verdict (no fetch next time); a missing file and an error are not cached', async () => {
  const cache = memCache(); let fetched = 0
  const t = createThumbs({ autoCap: Infinity, cache, produce: async (j) => { fetched++; if (j.blank) return { empty: true, reason: 'black', verdict: true }; if (j.gone) return { empty: true, reason: 'missing' }; throw new Error('boom') } })
  assert.deepEqual(await t.request('e', { blank: true }), { status: 'empty', reason: 'black' })
  assert.deepEqual(await t.request('e', { blank: true }), { status: 'empty', reason: 'black', cached: true }); assert.equal(fetched, 1)
  assert.equal((await t.request('g', { gone: true })).status, 'empty')
  assert.deepEqual(await t.request('f', {}), { status: 'error', reason: 'boom' })
  assert.deepEqual([...cache.m.keys()], ['e'])
})

test('create then reopen (a new controller on the same store) is zero fetches', async () => {
  const backend = memoryBackend()
  let fetched = 0
  const mk = () => createThumbs({ autoCap: Infinity, cache: createStore(backend), produce: async () => { fetched++; return { url: 'data:img' } } })
  assert.equal((await mk().request('v|s|f.dpx', { url: 'a' })).status, 'ready'); assert.equal(fetched, 1)
  const again = await mk().request('v|s|f.dpx', { url: 'a' })   // after a restart: a new controller, the persisted store
  assert.deepEqual(again, { status: 'ready', url: 'data:img', cached: true }); assert.equal(fetched, 1)
})

test('the same key reached through two different bases is one fetch', async () => {
  const urls = []
  const t = createThumbs({ autoCap: Infinity, cache: createStore(memoryBackend()), produce: async (j) => { urls.push(j.url); return { url: 'data:img' } } })
  const key = thumbKey('vol1', { subfolder: 'p/s', filename: 'a.0000.dpx' })
  await t.request(key, { url: 'podfile://pod-a.proxy.runpod.net/view?x' }, { manual: true })
  const r = await t.request(key, { url: `s3file://vol1/${encodeURIComponent('comfy-shared/output/p/s/a.0000.dpx')}`, bytes: 49768064 }, { manual: true })
  assert.equal(r.cached, true); assert.equal(urls.length, 1)
})

test('a file whose size is now known and differs from the record is fetched again', async () => {
  let fetched = 0
  const t = createThumbs({ autoCap: Infinity, cache: createStore(memoryBackend()), produce: async () => { fetched++; return { url: 'data:img' } } })
  await t.request('k', { bytes: 10 }, { manual: true }); await t.request('k', { bytes: 10 }, { manual: true }); assert.equal(fetched, 1)
  await t.request('k', { bytes: 11 }, { manual: true }); assert.equal(fetched, 2)
})

test('the store keeps at most its cap and evicts the oldest; count and clear', async () => {
  let clock = 0
  const st = createStore(memoryBackend(), { cap: 3, now: () => ++clock })
  for (const k of ['a', 'b', 'c', 'd', 'e']) await st.set(k, { url: k })
  assert.equal(await st.count(), 3)
  assert.equal(await st.get('a'), undefined); assert.equal(await st.get('b'), undefined)
  assert.equal((await st.get('e')).url, 'e')
  await st.clear(); assert.equal(await st.count(), 0)
})

test('abort stops a queued and a running preview', async () => {
  const g = gate(); let seen = null
  const t = createThumbs({ autoCap: Infinity, cache: memCache(), produce: (j, signal) => { seen = signal; return g.p.then(() => ({ url: 'data:x' })) } })
  const a = t.request('a', {}), b = t.request('b', {})
  await new Promise((r) => setTimeout(r, 2))
  t.abort('b'); assert.equal((await b).status, 'aborted')
  t.abort('a'); assert.equal(seen.aborted, true); g.go()
  assert.equal((await a).status, 'aborted')
  assert.equal(t.active, 0)
})

test('a storage that throws does not stop the tile', async () => {
  const t = createThumbs({ autoCap: Infinity, cache: { get: async () => { throw new Error('no idb') }, set: async () => { throw new Error('no idb') } }, produce: async () => ({ url: 'data:x' }) })
  assert.deepEqual(await t.request('a', {}), { status: 'ready', url: 'data:x' })
})

test('withTimeout ends a hung call with a timeout code and passes a quick one through', async () => {
  const { withTimeout } = await import('./thumbs.js')
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'The listing'), (e) => e.code === 'timeout' && /did not answer/.test(e.message))
  assert.equal(await withTimeout(Promise.resolve(7), 20), 7)
})

test('a preview carries the header colour fields of the first frame, and the cache keeps them (the colour chips of the tile need them)', async () => {
  let made = 0
  const t = createThumbs({ autoCap: Infinity, cache: memCache(), produce: async () => { made++; return { url: 'data:x', header: { transfer: 2, colorimetric: 2 } } } })
  assert.deepEqual(await t.request('k', {}), { status: 'ready', url: 'data:x', header: { transfer: 2, colorimetric: 2 } })
  assert.deepEqual(await t.request('k', {}), { status: 'ready', url: 'data:x', cached: true, header: { transfer: 2, colorimetric: 2 } })
  assert.deepEqual(await t.peek('k', {}), { status: 'ready', url: 'data:x', cached: true, header: { transfer: 2, colorimetric: 2 } })
  assert.equal(made, 1)
  const plain = createThumbs({ autoCap: Infinity, cache: memCache(), produce: async () => ({ url: 'data:y' }) })
  assert.deepEqual(await plain.request('k', {}), { status: 'ready', url: 'data:y' })   // no header: no key
})
