// The DPX decoder (src/utils/dpx.js) on DPX bytes made here: both byte orders, 8/10/12/16 bit, RGB/RGBA/luma, padding, downscaling, errors. `npm run dpx:test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeDpx, parseDpxHeader, frameCache } from './dpx.js'
import { makeDpx } from './dpx-fixture.mjs'

const px = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)]
const grad = (max) => (x, y, c) => Math.round(((c === 0 ? x / 15 : c === 1 ? y / 7 : 0.5)) * max)   // R by column, G by row, B half

for (const le of [false, true]) {
  const e = le ? 'little' : 'big'
  test(`16-bit RGB, ${e}-endian: header fields and exact values`, () => {
    const b = makeDpx({ bits: 16, le, fn: grad(65535) })
    const h = parseDpxHeader(b)
    assert.equal(h.littleEndian, le); assert.equal(h.width, 16); assert.equal(h.height, 8); assert.equal(h.bits, 16); assert.equal(h.descriptorName, 'RGB')
    const img = decodeDpx(b)
    assert.equal(img.width, 16); assert.equal(img.height, 8); assert.equal(img.data.length, 16 * 8 * 4)
    assert.deepEqual(px(img, 0, 0), [0, 0, 128, 255]); assert.deepEqual(px(img, 15, 7), [255, 255, 128, 255])
  })
  for (const packing of [1, 2]) {
    test(`10-bit RGB method ${packing === 1 ? 'A' : 'B'}, ${e}-endian`, () => {
      const img = decodeDpx(makeDpx({ bits: 10, packing, le, fn: grad(1023) }))
      assert.deepEqual(px(img, 0, 0), [0, 0, 128, 255]); assert.deepEqual(px(img, 15, 7), [255, 255, 128, 255])
      assert.deepEqual(px(img, 15, 0).slice(0, 2), [255, 0])   // 16 px * 3 = 48 components = 16 whole words; width 5 below checks a partial last word
    })
    test(`12-bit RGB method ${packing === 1 ? 'A' : 'B'}, ${e}-endian`, () => {
      const img = decodeDpx(makeDpx({ bits: 12, packing, le, fn: grad(4095) }))
      assert.deepEqual(px(img, 15, 7), [255, 255, 128, 255])
    })
  }
}
test('10-bit with a width that leaves a partial last word, plus end-of-line padding, keeps rows aligned', () => {
  const img = decodeDpx(makeDpx({ width: 5, height: 4, bits: 10, packing: 1, eol: 8, fn: (x, y, c) => (c === 0 ? 1023 : y === 3 ? 1023 : 0) }))
  assert.deepEqual(px(img, 4, 0), [255, 0, 0, 255]); assert.deepEqual(px(img, 0, 3), [255, 255, 255, 255])
})
test('8-bit luma and RGBA (alpha dropped)', () => {
  assert.deepEqual(px(decodeDpx(makeDpx({ bits: 8, descriptor: 6, fn: () => 200 })), 3, 3), [200, 200, 200, 255])
  assert.deepEqual(px(decodeDpx(makeDpx({ bits: 16, descriptor: 51, fn: (x, y, c) => [65535, 0, 0, 0][c] })), 3, 3), [255, 0, 0, 255])
})
test('box-averages down to maxWidth by a whole factor', () => {
  const b = makeDpx({ width: 16, height: 8, bits: 16, fn: (x) => (x % 2 ? 65535 : 0) })   // alternating columns: a 2x box gives mid-grey
  const img = decodeDpx(b, { maxWidth: 8 })
  assert.equal(img.width, 8); assert.equal(img.height, 4)
  assert.ok(Math.abs(px(img, 2, 2)[0] - 128) <= 1)
})
test('errors: bad magic, too short, truncated data, unsupported layout', () => {
  const b = makeDpx({ bits: 16 }); b.write('JUNK', 0, 'latin1')
  assert.throws(() => decodeDpx(b), /bad magic "JUNK"/)
  assert.throws(() => decodeDpx(Buffer.alloc(2)), /Not a DPX/)
  assert.throws(() => decodeDpx(makeDpx({ bits: 16 }).subarray(0, 100)), /Truncated DPX: the header/)
  assert.throws(() => decodeDpx(makeDpx({ bits: 16 }).subarray(0, 2048 + 100)), /Truncated DPX: \d+ bytes/)
  assert.throws(() => decodeDpx(makeDpx({ bits: 10, packing: 0 })), /packing 0/)
  assert.throws(() => decodeDpx(makeDpx({ bits: 16, descriptor: 51 }).fill(100, 800, 801)), /descriptor 100/)
})
test('frameCache keeps the most recently used frames', () => {
  const c = frameCache(2); c.set('a', 1); c.set('b', 2); c.get('a'); c.set('c', 3)
  assert.equal(c.has('a'), true); assert.equal(c.has('b'), false); assert.equal(c.size, 2)
})

test('frame loader: never more than 2 requests at once, higher priority first, one request per address, abort', async () => {
  const bytes = makeDpx({ width: 4, height: 2, bits: 8, fn: () => 9 })
  let live = 0, peak = 0; const order = []
  const real = globalThis.fetch
  globalThis.fetch = async (url) => { order.push(url); live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 15)); live--; return new Response(bytes) }
  try {
    const { createFrameLoader } = await import('./dpx.js')
    const L = createFrameLoader({ concurrency: 2 })
    const ps = ['a', 'b', 'c', 'd'].map((u) => L.load(u))
    assert.equal(L.load('a'), ps[0])   // shared
    const hi = L.load('e', { priority: 5 }); const gone = L.load('f'); L.abort('f')
    await assert.rejects(gone, /aborted/)
    await Promise.all([...ps, hi])
    assert.equal(peak, 2)
    assert.deepEqual(order.slice(0, 2), ['a', 'b']); assert.equal(order[2], 'e')   // e jumped the queue ahead of c and d
    assert.equal(order.includes('f'), false)
  } finally { globalThis.fetch = real }
})

test('frame loader: the limit can change while it runs, and more frames then load at once', async () => {
  const bytes = makeDpx({ width: 4, height: 2, bits: 8, fn: () => 9 })
  let live = 0, peak = 0
  const real = globalThis.fetch
  globalThis.fetch = async () => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 15)); live--; return new Response(bytes) }
  try {
    const { createFrameLoader } = await import('./dpx.js')
    const L = createFrameLoader({ concurrency: 2 })
    assert.equal(L.concurrency, 2)
    const first = ['a', 'b', 'c', 'd', 'e', 'f'].map((u) => L.load(u)); await Promise.all(first); assert.equal(peak, 2)
    peak = 0; L.setConcurrency(5); assert.equal(L.concurrency, 5)
    await Promise.all(['g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'].map((u) => L.load(u))); assert.equal(peak, 5)   // five at once now
    L.setConcurrency(0); assert.equal(L.concurrency, 1); L.setConcurrency(99); assert.equal(L.concurrency, 16)   // clamped
  } finally { globalThis.fetch = real }
})

import { DpxError, problemOfError, loadDpx } from './dpx.js'
test('empty frames: all black and flat grey are flagged; a gradient, mostly black with a bright region, and a clipped frame are not', () => {
  const black = decodeDpx(makeDpx({ bits: 16, fn: () => 0 }))
  assert.deepEqual(black.problem, { kind: 'black' }); assert.equal(black.stats.zeroFraction, 1); assert.deepEqual(black.stats.max, [0, 0, 0])
  assert.deepEqual(decodeDpx(makeDpx({ bits: 16, fn: () => 32768 })).problem, { kind: 'flat' })
  assert.deepEqual(decodeDpx(makeDpx({ bits: 10, packing: 1, fn: () => 1023 })).problem, { kind: 'flat' })   // flat white is flat too
  const g = decodeDpx(makeDpx({ bits: 16, fn: grad(65535) }))
  assert.equal(g.problem, null); assert.equal(g.stats.flat, false)
  assert.deepEqual(g.stats.min, [0, 0, 32768 / 65535]); assert.deepEqual(g.stats.max.map((v) => +v.toFixed(2)), [1, 1, 0.5])
  assert.ok(Math.abs(g.stats.mean[0] - 0.5) < 0.01); assert.ok(g.stats.zeroFraction < 0.02)
  const spot = decodeDpx(makeDpx({ width: 32, height: 16, bits: 16, fn: (x, y) => (x >= 20 && x < 24 && y >= 4 && y < 8 ? 60000 : 0) }))
  assert.equal(spot.problem, null); assert.ok(spot.stats.zeroFraction > 0.95)   // mostly black, but a real region: not empty
  const clipped = decodeDpx(makeDpx({ bits: 16, fn: (x, y) => (x === 0 && y === 0 ? 100 : 65535) }))
  assert.equal(clipped.problem, null); assert.deepEqual(clipped.stats.max, [1, 1, 1])
})
test('empty frames from the file itself: 0 bytes, truncated (have/need), a header with no pixels', () => {
  assert.throws(() => decodeDpx(Buffer.alloc(0)), (e) => e instanceof DpxError && e.kind === 'empty-file' && /0 bytes/.test(e.message))
  const full = makeDpx({ bits: 16 })
  assert.throws(() => decodeDpx(full.subarray(0, 2500)), (e) => e.kind === 'truncated' && e.have === 2500 && e.need === full.length)
  assert.deepEqual(problemOfError({ kind: 'truncated', have: 2500, need: 9 }), { kind: "truncated", have: 2500, need: 9 })
  const z = Buffer.from(full); z.writeUInt32BE(0, 772)
  assert.throws(() => decodeDpx(z), (e) => e.kind === 'zero-size')
  assert.equal(problemOfError(new Error('bad magic')), null); assert.equal(problemOfError({ kind: 'network' }), null)
})
test('loadDpx: 404 is "missing", other statuses say the status, a network failure says it could not reach the pod, the app fallback is tried once', async () => {
  const real = globalThis.fetch, ok = makeDpx({ width: 4, height: 2, bits: 8, fn: () => 9 })
  try {
    globalThis.fetch = async () => new Response('', { status: 404 })
    await assert.rejects(loadDpx('x'), (e) => e.kind === 'missing' && /Missing: the pod has no such file/.test(e.message))
    globalThis.fetch = async () => new Response('', { status: 502 })
    await assert.rejects(loadDpx('x'), (e) => e.kind === 'http' && /HTTP 502/.test(e.message))
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
    await assert.rejects(loadDpx('x'), (e) => e.kind === 'network' && /^Could not reach the pod file: /.test(e.message) && !/^Failed to fetch$/.test(e.message))
    let calls = 0
    const img = await loadDpx('x', { fallback: async () => { calls++; return { status: 200, bytes: new Uint8Array(ok) } } })
    assert.equal(calls, 1); assert.equal(img.width, 4)
    await assert.rejects(loadDpx('x', { fallback: async () => ({ status: 404, bytes: null }) }), (e) => e.kind === 'missing')
    await assert.rejects(loadDpx('x', { fallback: async () => { throw new Error('Could not reach the pod file: ECONNRESET') } }), /ECONNRESET/)
  } finally { globalThis.fetch = real }
})
