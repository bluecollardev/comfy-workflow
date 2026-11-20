import { vi, describe, expect, it } from 'vitest'
vi.setConfig({ testTimeout: 30_000 })   // thousands of files are made and walked; a loaded machine is slow
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as imports from '../src/imports.js'
import { walkFiles } from '../src/asyncfs.js'
import { scratch } from './helpers.js'

function lagProbe(everyMs = 5) {
  let last = Date.now(), max = 0, ticks = 0
  const t = setInterval(() => { const now = Date.now(); max = Math.max(max, now - last - everyMs); last = now; ticks++ }, everyMs)
  return { stop: () => { clearInterval(t); return { maxLag: max, ticks } } }
}
function pack(root: string, dirs: number, per: number) {
  for (let d = 0; d < dirs; d++) { mkdirSync(join(root, `shot${d}`), { recursive: true }); for (let i = 0; i < per; i++) writeFileSync(join(root, `shot${d}`, `f${i}.dpx`), 'x') }
  writeFileSync(join(root, 'README.md'), '# a pack\nhello')
  writeFileSync(join(root, 'shot0', 'MANIFEST.json'), '{"shots":1}')
}

describe('the package folder look (draft preview, Studio context) does not hold the event loop', () => {
  it('says what the synchronous one says, and the walk respects the cap', async () => {
    const root = scratch(); pack(root, 6, 7)
    const a = imports.draftPreview(root), b = await imports.draftPreviewAsync(root)
    expect(b.total_files).toBe(a.total_files)
    expect(b.dirs).toEqual(a.dirs)
    expect(b.texts).toEqual(a.texts)
    expect(b._texts).toEqual(a._texts)
    expect((await walkFiles(root, { max: 10 })).files).toHaveLength(10)
  })
  it('keeps the loop ticking over a folder of 20,000 files', async () => {
    const root = scratch(); pack(root, 100, 200)
    const t0 = Date.now(); imports.draftPreview(root); const syncMs = Date.now() - t0
    const probe = lagProbe()
    await imports.draftPreviewAsync(root)
    const { maxLag, ticks } = probe.stop()
    console.log(`draft preview of 20,000 files: sync blocks ${syncMs} ms; async max event-loop lag ${maxLag} ms over ${ticks} ticks`)
    expect(ticks).toBeGreaterThan(5)
    expect(maxLag).toBeLessThan(300)
  })
})
