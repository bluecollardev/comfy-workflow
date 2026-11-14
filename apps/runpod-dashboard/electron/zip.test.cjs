// node --test electron/zip.test.cjs : the zip writer, checked by reading the zip back with unzipper.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')
const { writeZip, safeNames, crc32 } = require('./zip.cjs')

const body = (s) => ({ ok: true, status: 200, body: Readable.from([Buffer.from(s.slice(0, 3)), Buffer.from(s.slice(3))]) })
test('writes a valid zip: names, bytes and CRCs read back; two files with one name are both kept; a failed fetch leaves no zip', async () => {
  const unzipper = require('unzipper')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'))
  const dest = path.join(dir, 'o.zip')
  const data = { 'http://p/a': 'AAAAAAAAAA', 'http://p/b': 'héllo wörld', 'http://p/c': 'CCC' }
  const r = await writeZip([{ url: 'http://p/a', name: 'run1/a.png' }, { url: 'http://p/b', name: '../run1/a.png' }, { url: 'http://p/c', name: '/x/c.txt' }], dest, { fetchFn: async (u) => body(data[u]) })
  assert.deepStrictEqual(r, { files: 3, bytes: 10 + Buffer.byteLength('héllo wörld') + 3 })
  const d = await unzipper.Open.file(dest)
  assert.deepStrictEqual(d.files.map((f) => f.path), ['run1/a.png', 'run1/a (2).png', 'x/c.txt'])
  assert.strictEqual((await d.files[1].buffer()).toString('utf8'), 'héllo wörld')
  assert.strictEqual(d.files[0].crc32 >>> 0, crc32(Buffer.from('AAAAAAAAAA')))
  const bad = path.join(dir, 'bad.zip')
  await assert.rejects(writeZip([{ url: 'http://p/a', name: 'a' }, { url: 'http://p/x', name: 'x' }], bad, { fetchFn: async (u) => (u.endsWith('/a') ? body('A') : { ok: false, status: 404 }) }), /HTTP 404/)
  assert.strictEqual(fs.existsSync(bad), false)
})
test('safeNames drops ../ and leading slashes and numbers duplicates', () => {
  assert.deepStrictEqual(safeNames([{ name: 'a/../b.png' }, { name: 'b.png' }, { name: 'b.png' }]), ['a/b.png', 'b.png', 'b (2).png'])
})
