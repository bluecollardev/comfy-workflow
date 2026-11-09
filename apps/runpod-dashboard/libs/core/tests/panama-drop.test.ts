import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as panama from '../src/panama.js'

describe('panama.stageDrop (a round dragged from the desktop)', () => {
  let root: string, stage: string, src: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'drop-')); stage = join(root, 'staging'); src = join(root, 'src'); mkdirSync(src)
    process.env.PANAMA_ROUNDS_DIR = stage; process.env.SETTINGS_ENV_FILE = join(root, 'none.env'); process.env.POD_MANAGER_IMPORT_ZIPS_DIR = join(root, 'zips')
  })
  afterEach(() => { delete process.env.PANAMA_ROUNDS_DIR; delete process.env.SETTINGS_ENV_FILE; delete process.env.POD_MANAGER_IMPORT_ZIPS_DIR })
  it('copies a folder under its own name and never overwrites; a second drop gets a suffix', () => {
    const f = join(src, 'my-round'); mkdirSync(join(f, 'shot-1'), { recursive: true }); writeFileSync(join(f, 'shot-1', 'a.txt'), 'A'); writeFileSync(join(f, 'MANIFEST.json'), '{}')
    const a = panama.stageDrop([f])
    expect(a).toMatchObject({ round: 'my-round', files: 2, extracted: 0 })
    expect(readFileSync(join(stage, 'my-round', 'shot-1', 'a.txt'), 'utf8')).toBe('A')
    expect(panama.stageDrop([f]).round).toBe('my-round-2')
    expect(existsSync(join(f, 'MANIFEST.json'))).toBe(true)   // the source is untouched
  })
  it('extracts a zip (one top folder is the round) and names several things dropped-<date>', () => {
    const f = join(src, 'zipped'); mkdirSync(f); writeFileSync(join(f, 'x.txt'), 'X')
    const z = join(src, 'zipped.zip'); expect(spawnSync('zip', ['-qr', z, 'zipped'], { cwd: src }).status).toBe(0)
    expect(panama.stageDrop([z])).toMatchObject({ round: 'zipped', files: 1, extracted: 1 })
    const loose = join(src, 'loose.txt'); writeFileSync(loose, 'L')
    const m = panama.stageDrop([loose, f], new Date(2026, 10, 9, 16, 5))
    expect(m.round).toBe('dropped-20261109-1605')
    expect(existsSync(join(stage, m.round, 'loose.txt'))).toBe(true); expect(existsSync(join(stage, m.round, 'zipped', 'x.txt'))).toBe(true)
  })
  it('refuses nothing, relative paths and missing paths', () => {
    expect(() => panama.stageDrop([])).toThrow(/Nothing was dropped/)
    expect(() => panama.stageDrop(['rel/path'])).toThrow(/absolute/)
    expect(() => panama.stageDrop([join(src, 'nope')])).toThrow(/Not found/)
  })
})
