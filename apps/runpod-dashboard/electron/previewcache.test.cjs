'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createPreviewCache, isPreviewSearch } = require('./previewcache.cjs')

const jpg = (n = 40) => ({ status: 200, type: 'image/jpeg', body: Buffer.alloc(n, 7) })

test('only a /view of a .previews folder is a preview (a delivery or a render is never cached here)', () => {
  assert.equal(isPreviewSearch('?filename=a.jpg&subfolder=.previews%2Fclip&type=output'), true)
  assert.equal(isPreviewSearch('?filename=a.jpg&subfolder=.previews/clip/thumbs&type=output'), true)
  assert.equal(isPreviewSearch('?filename=a.jpg&subfolder=.previews/clip/posters&type=output'), true)
  assert.equal(isPreviewSearch('?filename=a.dpx&subfolder=_delivery_v11%2Fclip&type=output'), false)
  assert.equal(isPreviewSearch('?filename=a.jpg&subfolder=x%2F.previews&type=output'), false)
  assert.equal(isPreviewSearch(''), false)
})

test('one fetch per address however many tiles ask, then the memory answers', async () => {
  let calls = 0; const c = createPreviewCache()
  const f = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return jpg() }
  const rs = await Promise.all([c.get('p1?a', f), c.get('p1?a', f), c.get('p1?a', f)])
  assert.equal(calls, 1); assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]); assert.equal(c.stat.deduped, 2)
  assert.equal((await c.get('p1?a', f)).body.length, 40); assert.equal(calls, 1); assert.equal(c.stat.hits, 1)
})

test('at most `concurrency` fetches run at once (a strip of hundreds does not hit the proxy all at the same time)', async () => {
  const c = createPreviewCache({ concurrency: 4 }); let live = 0, peak = 0
  const f = async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 5)); live--; return jpg() }
  await Promise.all(Array.from({ length: 40 }, (_, i) => c.get(`p?${i}`, f)))
  assert.equal(peak, 4); assert.equal(c.stat.fetched, 40)
})

test('only small image answers with HTTP 200 are kept: a 404, a big body and a non-image are fetched again next time', async () => {
  const c = createPreviewCache(); let calls = 0
  const bad = [{ status: 404, type: 'text/plain', body: Buffer.from('no') }, { status: 200, type: 'image/jpeg', body: Buffer.alloc(3 * 1024 * 1024) }, { status: 200, type: 'text/html', body: Buffer.from('<p>') }]
  for (const [i, r] of bad.entries()) { await c.get(`k${i}`, async () => { calls++; return r }); await c.get(`k${i}`, async () => { calls++; return r }) }
  assert.equal(calls, 6); assert.equal(c.stat.hits, 0)
})

test('an entry is trusted only for the limit, and the cache keeps at most `items` entries', async () => {
  let skew = 0; const c = createPreviewCache({ ttlMs: 100, items: 3, now: () => Date.now() + skew }); let calls = 0
  const f = async () => { calls++; return jpg() }
  await c.get('k', f); skew += 50; await c.get('k', f); assert.equal(calls, 1)
  skew += 200; await c.get('k', f); assert.equal(calls, 2)
  for (let i = 0; i < 6; i++) await c.get(`x${i}`, f)
  const before = calls; await c.get('x0', f); assert.equal(calls, before + 1)   // the oldest was dropped
})
