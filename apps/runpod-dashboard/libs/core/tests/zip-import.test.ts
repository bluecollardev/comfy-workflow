import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as imports from '../src/imports.js'

// A .zip as the source of an import (docs/ADR-028): unpacked once, a single top folder is the package, an entry that leaves the folder is refused.
const hasTools = spawnSync('unzip', ['-v']).status === 0 && spawnSync('python3', ['--version']).status === 0
const zipOf = (file: string, entries: Record<string, string>) => {
  const py = 'import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor n,t in json.loads(sys.argv[2]).items(): z.writestr(n,t)\nz.close()'
  const r = spawnSync('python3', ['-c', py, file, JSON.stringify(entries)]); expect(r.status, String(r.stderr)).toBe(0)
}

describe('safeZipEntry', () => {
  it('accepts relative paths and refuses the ones that leave the folder', () => {
    for (const ok of ['a.txt', 'pack/input/a.png', 'a/b/../c'.replace('..', 'x')]) expect(imports.safeZipEntry(ok)).toBe(true)
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\..\\x', '', 'a\0b']) expect(imports.safeZipEntry(bad)).toBe(false)
  })
})

describe.skipIf(!hasTools)('prepareSource', () => {
  let tmp: string
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'zip-import-')); process.env.POD_MANAGER_IMPORT_ZIPS_DIR = join(tmp, 'zips') })
  afterEach(() => { delete process.env.POD_MANAGER_IMPORT_ZIPS_DIR; rmSync(tmp, { recursive: true, force: true }) })

  it('passes a folder through and refuses a relative path or a file that is not a zip', () => {
    expect(imports.prepareSource(tmp)).toBe(tmp)
    expect(() => imports.prepareSource('relative.zip')).toThrow(/absolute/)
    const txt = join(tmp, 'notes.txt'); writeFileSync(txt, 'x')
    expect(() => imports.prepareSource(txt)).toThrow(/not a folder or a \.zip/)
  })

  it('unpacks a zip once; a single top folder is the package', () => {
    const z = join(tmp, 'pack.zip'); zipOf(z, { 'pack/input/a.png': 'png', 'pack/MANIFEST.json': '{}' })
    const dir = imports.prepareSource(z)
    expect(dir).toMatch(/zips\/pack-[0-9a-f]{10}\/pack$/)
    expect(readFileSync(join(dir, 'input', 'a.png'), 'utf8')).toBe('png')
    writeFileSync(join(dir, 'input', 'a.png'), 'changed')   // a second call reuses the unpacked folder: it does not unpack over it
    expect(readFileSync(join(imports.prepareSource(z), 'input', 'a.png'), 'utf8')).toBe('changed')
  })

  it('a zip with several top entries is itself the package', () => {
    const z = join(tmp, 'flat.zip'); zipOf(z, { 'input/a.png': 'png', 'workflows/w.json': '{}' })
    const dir = imports.prepareSource(z)
    expect(dir).toMatch(/flat-[0-9a-f]{10}$/); expect(existsSync(join(dir, 'input', 'a.png'))).toBe(true)
  })

  it('refuses an entry that would unpack outside the folder, and writes nothing', () => {
    const z = join(tmp, 'evil.zip'); zipOf(z, { '../outside.txt': 'x', 'input/a.png': 'png' })
    expect(() => imports.prepareSource(z)).toThrow(/outside its folder/)
    expect(existsSync(join(tmp, 'outside.txt'))).toBe(false)
    expect(existsSync(join(tmp, 'zips'))).toBe(false)
  })

  it('says so for a file that is not a zip', () => {
    const z = join(tmp, 'broken.zip'); writeFileSync(z, 'not a zip at all')
    expect(() => imports.prepareSource(z)).toThrow(/could not read/)
  })
})
