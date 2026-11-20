import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest'
vi.setConfig({ testTimeout: 30_000 })   // thousands of files are made and walked; a loaded machine is slow
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as panama from '../src/panama.js'

function lagProbe(everyMs = 5) {
  let last = Date.now(), max = 0, ticks = 0
  const t = setInterval(() => { const now = Date.now(); max = Math.max(max, now - last - everyMs); last = now; ticks++ }, everyMs)
  return { stop: () => { clearInterval(t); return { maxLag: max, ticks } } }
}

describe('panama.stageDropAsync and removeAsync (the drop and the delete of a round, off the main loop)', () => {
  let root: string, stage: string, src: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dropa-')); stage = join(root, 'staging'); src = join(root, 'src'); mkdirSync(src)
    process.env.PANAMA_ROUNDS_DIR = stage; process.env.SETTINGS_ENV_FILE = join(root, 'none.env'); process.env.POD_MANAGER_IMPORT_ZIPS_DIR = join(root, 'zips')
  })
  afterEach(() => { delete process.env.PANAMA_ROUNDS_DIR; delete process.env.SETTINGS_ENV_FILE; delete process.env.POD_MANAGER_IMPORT_ZIPS_DIR })

  it('does what the synchronous drop does: a folder under its name, a suffix on a second drop, a zip extracted, several things dropped-<date>', async () => {
    const f = join(src, 'my-round'); mkdirSync(join(f, 'shot-1'), { recursive: true }); writeFileSync(join(f, 'shot-1', 'a.txt'), 'A'); writeFileSync(join(f, 'MANIFEST.json'), '{}')
    expect(await panama.stageDropAsync([f])).toMatchObject({ round: 'my-round', files: 2, extracted: 0 })
    expect(readFileSync(join(stage, 'my-round', 'shot-1', 'a.txt'), 'utf8')).toBe('A')
    expect((await panama.stageDropAsync([f])).round).toBe('my-round-2')
    const g = join(src, 'zipped'); mkdirSync(g); writeFileSync(join(g, 'x.txt'), 'X')
    const z = join(src, 'zipped.zip'); expect(spawnSync('zip', ['-qr', z, 'zipped'], { cwd: src }).status).toBe(0)
    expect(await panama.stageDropAsync([z])).toMatchObject({ round: 'zipped', files: 1, extracted: 1 })
    const loose = join(src, 'loose.txt'); writeFileSync(loose, 'L')
    const m = await panama.stageDropAsync([loose, g], new Date(2026, 10, 9, 16, 5))
    expect(m.round).toBe('dropped-20261109-1605')
    expect(existsSync(join(stage, m.round, 'loose.txt'))).toBe(true); expect(existsSync(join(stage, m.round, 'zipped', 'x.txt'))).toBe(true)
  })
  it('refuses nothing, relative paths and missing paths', async () => {
    await expect(panama.stageDropAsync([])).rejects.toThrow(/Nothing was dropped/)
    await expect(panama.stageDropAsync(['rel/path'])).rejects.toThrow(/absolute/)
    await expect(panama.stageDropAsync([join(src, 'nope')])).rejects.toThrow(/Not found/)
  })
  it('removeAsync frees the bytes, deletes only a folder inside the staging folder, and refuses a bad name', async () => {
    const f = join(src, 'gone'); mkdirSync(f); writeFileSync(join(f, 'a.bin'), 'x'.repeat(100))
    await panama.stageDropAsync([f])
    expect(await panama.removeAsync('gone')).toEqual({ round: 'gone', freed: 100 })
    expect(existsSync(join(stage, 'gone'))).toBe(false)
    expect(await panama.removeAsync('gone')).toEqual({ round: 'gone', freed: 0 })
    await expect(panama.removeAsync('../etc')).rejects.toThrow(/Not a round name/)
  })
  it('keeps the loop ticking while a folder of 12,000 files is dropped and then deleted', async () => {
    // (timeout below)
    const f = join(src, 'big')
    for (let d = 0; d < 60; d++) { mkdirSync(join(f, `s${d}`), { recursive: true }); for (let i = 0; i < 200; i++) writeFileSync(join(f, `s${d}`, `f${i}.dpx`), 'x') }
    const probe = lagProbe()
    const dropped = await panama.stageDropAsync([f])
    const removed = await panama.removeAsync(dropped.round)
    const { maxLag, ticks } = probe.stop()
    console.log(`drop + delete of 12,000 files: async max event-loop lag ${maxLag} ms over ${ticks} ticks`)
    expect(dropped.files).toBe(12000); expect(removed.freed).toBe(12000)
    expect(ticks).toBeGreaterThan(5)
    expect(maxLag).toBeLessThan(300)
  })
})
