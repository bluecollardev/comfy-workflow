import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IMG_VERSION, createImageCache, imageKey, memoryImageBackend } from './imgcache.js'

const img = (n, type = 'image/jpeg') => new Blob([new Uint8Array(n)], { type })

test('imageKey drops the host (the same file through any address) and keeps the query; an s3file address is kept whole', () => {
  const q = '/view?filename=a.0001.jpg&subfolder=.previews%2Fx&type=output'
  assert.equal(imageKey(`https://abc-8188.proxy.runpod.net${q}`), q)
  assert.equal(imageKey(`podfile://abc-8188.proxy.runpod.net${q}`), q)
  assert.equal(imageKey('s3file://vol/output%2Fa.jpg'), 's3file://vol/output%2Fa.jpg')
  assert.equal(IMG_VERSION, 1)
})

test('a stored picture comes back; a different size/time stamp is a miss and drops the record', async () => {
  const c = createImageCache(memoryImageBackend())
  assert.equal(await c.set('k', img(100), '100:t1'), true)
  assert.equal((await c.get('k', '100:t1')).size, 100)
  assert.equal((await c.get('k')).size, 100)   // no stamp asked: the record is trusted
  assert.equal(await c.get('k', '200:t1'), undefined)   // the file changed
  assert.equal(await c.get('k'), undefined)   // and it was dropped
})

test('only small pictures are kept: a big file, an empty one and a non-image never enter', async () => {
  const c = createImageCache(memoryImageBackend(), { maxItem: 1000 })
  assert.equal(await c.set('big', img(5000)), false)
  assert.equal(await c.set('empty', img(0)), false)
  assert.equal(await c.set('txt', img(10, 'text/html')), false)
  assert.deepEqual(await c.stats(), { count: 0, bytes: 0 })
})

test('over the cap the least recently used go first, and a hit counts as a use', async () => {
  let t = 0
  const c = createImageCache(memoryImageBackend(), { cap: 300, now: () => ++t })
  await c.set('a', img(100)); await c.set('b', img(100)); await c.set('c', img(100))
  await c.get('a')   // a is now newer than b
  await new Promise((r) => setTimeout(r, 5))
  await c.set('d', img(100))   // 400 > 300: b (the oldest) goes
  assert.equal(await c.get('b'), undefined)
  assert.ok(await c.get('a')); assert.ok(await c.get('c')); assert.ok(await c.get('d'))
  assert.equal((await c.stats()).bytes, 300)
})

test('forget drops by part of the key; clear drops all; a backend that throws never throws out', async () => {
  const c = createImageCache(memoryImageBackend())
  await c.set('/view?subfolder=.previews%2Fa&x', img(10)); await c.set('/view?subfolder=.previews%2Fb&x', img(10))
  await c.forget('.previews%2Fa')
  assert.equal((await c.stats()).count, 1)
  await c.clear()
  assert.equal((await c.stats()).count, 0)
  const boom = async () => { throw new Error('x') }
  const bad = createImageCache({ get: boom, put: boom, del: boom, all: boom, clear: boom })
  assert.equal(await bad.get('k'), undefined); assert.equal(await bad.set('k', img(5)), false); assert.deepEqual(await bad.stats(), { count: 0, bytes: 0 }); await bad.clear(); await bad.forget('x')
})
