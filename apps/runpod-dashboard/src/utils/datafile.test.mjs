import test from 'node:test'
import assert from 'node:assert/strict'
import { readText, pretty, isTextName, PREVIEW_MAX } from './datafile.js'

const bodyOf = (bytes, chunk = 4096) => new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk)); c.close() } }))

test('a small text file is read whole, not truncated, not binary', async () => {
  const r = await readText(bodyOf(new TextEncoder().encode('{"a":1}')))
  assert.deepEqual(r, { text: '{"a":1}', truncated: false, binary: false })
})

test('a file over the cap is cut at 1 MB and says so', async () => {
  const big = new Uint8Array(PREVIEW_MAX + 5000).fill(65)
  const r = await readText(bodyOf(big))
  assert.equal(r.truncated, true); assert.equal(r.text.length, PREVIEW_MAX); assert.equal(r.binary, false)
})

test('a NUL byte in the first 8 KB makes it binary and gives no text', async () => {
  const r = await readText(bodyOf(new Uint8Array([83, 68, 80, 88, 0, 0, 0, 1])))
  assert.equal(r.binary, true); assert.equal(r.text, '')
})

test('JSON is pretty-printed only when the whole file was read and it parses', () => {
  assert.equal(pretty('a.json', '{"a":[1,2]}', false), '{\n  "a": [\n    1,\n    2\n  ]\n}')
  assert.equal(pretty('a.json', '{"a":[1,', true), '{"a":[1,')   // cut off: never reformatted
  assert.equal(pretty('a.json', 'not json', false), 'not json')
  assert.equal(pretty('a.txt', '{"a":1}', false), '{"a":1}')   // only .json is formatted
})

test('which names are text', () => {
  for (const n of ['a.json', 'b.MD', 'c.csv', 'd.txt', 'e.log', 'f.yaml', 'g.yml', 'h.xml']) assert.equal(isTextName(n), true, n)
  for (const n of ['a.bin', 'b.dpx', 'c.mp4', 'd']) assert.equal(isTextName(n), false, n)
})
