import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The pod-side manifest check (apps/comfy-app/docker/verify_round.py, ADR-022): the same answers as the app's panama.verify.
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../comfy-app/docker/verify_round.py')
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const run = (dir: string) => spawnSync('python3', ['-I', SCRIPT, dir], { encoding: 'utf8' })
const round = (files: Record<string, string>, manifest: 'root' | 'per-shot' = 'root') => {
  const dir = mkdtempSync(join(tmpdir(), 'vr-'))
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c) }
  const entries = Object.entries(files).map(([path, c]) => ({ path, bytes: c.length, sha256: sha(c) }))
  if (manifest === 'root') writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify({ files: entries }))
  else { writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify({ shots: { shot: {} } })); writeFileSync(join(dir, 'shot', 'MANIFEST.json'), JSON.stringify({ files: entries })) }
  return dir
}

describe('verify_round.py (the pod-side manifest check)', () => {
  it('passes a round that matches, in both manifest shapes, and counts files it does not list', () => {
    for (const shape of ['root', 'per-shot'] as const) {
      const dir = round({ 'shot/a.txt': 'hello', 'shot/b.txt': 'world' }, shape)
      writeFileSync(join(dir, 'extra.txt'), 'x')
      const r = run(dir)
      expect(r.status).toBe(0)
      expect(r.stdout).toContain('2 listed, 0 bad, 1 on disk but not listed')
      expect(r.stdout.trim().endsWith('OK')).toBe(true)
    }
  })
  it('fails (1) on a changed, a short and a missing file, naming each', () => {
    const dir = round({ 'a.txt': 'hello', 'b.txt': 'world', 'c.txt': 'abc' })
    writeFileSync(join(dir, 'a.txt'), 'HELLO'); writeFileSync(join(dir, 'b.txt'), 'wor'); unlinkSync(join(dir, 'c.txt'))
    const r = run(dir)
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('SHA256   a.txt'); expect(r.stdout).toContain('SIZE     b.txt'); expect(r.stdout).toContain('MISSING  c.txt')
    expect(r.stdout.trim().endsWith('FAIL')).toBe(true)
  })
  it('exits 2 when there is no usable file list (no manifest, a cut-short one, an empty one)', () => {
    const none = mkdtempSync(join(tmpdir(), 'vr-')); writeFileSync(join(none, 'a.txt'), 'x')
    expect(run(none).status).toBe(2)
    const cut = mkdtempSync(join(tmpdir(), 'vr-')); writeFileSync(join(cut, 'MANIFEST.json'), '{"files": [')
    expect(run(cut).status).toBe(2)
    const empty = mkdtempSync(join(tmpdir(), 'vr-')); writeFileSync(join(empty, 'MANIFEST.json'), '{"files": []}')
    expect(run(empty).status).toBe(2)
  })
})
