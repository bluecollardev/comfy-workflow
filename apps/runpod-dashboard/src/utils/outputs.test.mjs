import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inFolder, narrowToFolder } from './outputs.js'

const run = (...subs) => ({ files: subs.map((s) => ({ filename: 'f.dpx', subfolder: s, type: 'output' })) })

test('inFolder: no folder (the root) is every run; a folder keeps runs with files in it or inside it, on a path boundary', () => {
  assert.equal(inFolder(run('proxy_v004/archival-080/a'), ''), true)
  assert.equal(inFolder(run('proxy_v004/archival-080/a'), undefined), true)
  assert.equal(inFolder(run('proxy_v004/archival-080/a'), 'proxy_v004'), true)
  assert.equal(inFolder(run('proxy_v004/archival-080/a'), 'proxy_v004/archival-080/'), true)   // trailing slash does not matter
  assert.equal(inFolder(run('proxy_v004/archival-080/a'), 'proxy_v004/archival-080/a'), true)   // the folder itself
  assert.equal(inFolder(run('proxy_v004/archival-080/a'), 'proxy_v005'), false)
  assert.equal(inFolder(run('proxy_v0041/x'), 'proxy_v004'), false)   // 'proxy_v0041' is not inside 'proxy_v004'
  assert.equal(inFolder(run('seqs/a', 'proxy_v004/x'), 'proxy_v004'), true)   // any file counts
  assert.equal(inFolder(run(''), 'proxy_v004'), false); assert.equal(inFolder({ files: [] }, 'proxy_v004'), false); assert.equal(inFolder(undefined, 'x'), false)
})

test('narrowToFolder: a run keeps only the files in the folder and remembers how many it had; no folder leaves it alone', () => {
  const r = { prompt_id: 'p', files: [{ filename: 'a', subfolder: 'x/one' }, { filename: 'b', subfolder: 'x/one' }, { filename: 'c', subfolder: 'x/two' }, { filename: 'd', subfolder: 'y' }] }
  assert.equal(narrowToFolder(r, ''), r)
  const n = narrowToFolder(r, 'x/one')
  assert.deepEqual(n.files.map((f) => f.filename), ['a', 'b']); assert.equal(n.totalFiles, 4); assert.equal(n.prompt_id, 'p')
  assert.equal(narrowToFolder(r, 'x').files.length, 3)   // inside the folder, on a path boundary
  assert.equal(narrowToFolder(narrowToFolder(r, 'x'), 'x/two').totalFiles, 4)   // narrowing twice still remembers the original count
  assert.equal(narrowToFolder(r, 'z').files.length, 0)
})
