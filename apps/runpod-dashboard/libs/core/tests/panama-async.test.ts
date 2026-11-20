import { vi, afterEach, beforeEach, describe, expect, it } from 'vitest'
vi.setConfig({ testTimeout: 30_000 })   // thousands of files are made and walked; a loaded machine is slow
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as panama from '../src/panama.js'

/** The event loop's own lag, measured the way electron/stall-monitor.cjs does: a short timer, and how late it is. */
function lagProbe(everyMs = 5) {
  let last = Date.now(), max = 0, ticks = 0
  const t = setInterval(() => { const now = Date.now(); max = Math.max(max, now - last - everyMs); last = now; ticks++ }, everyMs)
  return { stop: () => { clearInterval(t); return { maxLag: max, ticks } } }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
let base = ''
/** A staged round with `shots` shot folders of `per` small files each, a root MANIFEST listing every one of them. */
function makeRound(name: string, shots: number, per: number, withDone = false) {
  const dir = join(base, name); mkdirSync(dir, { recursive: true })
  const files: { path: string; bytes: number; sha256: string }[] = []
  for (let s = 0; s < shots; s++) {
    mkdirSync(join(dir, `shot${s}`), { recursive: true })
    for (let i = 0; i < per; i++) { const body = `f${s}-${i}`; writeFileSync(join(dir, `shot${s}`, `f${i}.txt`), body); files.push({ path: `shot${s}/f${i}.txt`, bytes: body.length, sha256: sha(body) }) }
  }
  writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify({ files }))
  if (withDone) writeFileSync(join(dir, '.panama-pull.done'), 'x')
  return dir
}

beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'pan-async-')); process.env.PANAMA_ROUNDS_DIR = base; panama.forgetScans() })
afterEach(() => { delete process.env.PANAMA_ROUNDS_DIR })

describe('the staged-round scan does not hold the event loop', () => {
  it('gives the same answer as the synchronous scan, for none, unverified and complete', async () => {
    expect((await panama.stagedScanAsync('missing')).st.state).toBe('none')
    makeRound('r1', 3, 4)
    const a = await panama.stagedScanAsync('r1')
    expect(a.st).toEqual(panama.stagedState('r1'))
    expect(a.st).toMatchObject({ state: 'unverified', present: 12, expected: 12, missing: 0 })
    expect(a.bytes).toBeGreaterThan(0)
    makeRound('r2', 2, 3, true); panama.forgetScans()
    expect((await panama.stagedScanAsync('r2')).st).toEqual(panama.stagedState('r2'))
    expect((await panama.stagedScanAsync('r2')).st.state).toBe('complete')
  })

  it('counts a missing file as partial, like the synchronous one', async () => {
    const dir = makeRound('r3', 2, 3)
    writeFileSync(join(dir, 'shot0', 'f0.txt'), 'wrong size content')
    panama.forgetScans()
    expect((await panama.stagedScanAsync('r3')).st).toEqual(panama.stagedState('r3'))
    expect((await panama.stagedScanAsync('r3')).st).toMatchObject({ state: 'partial', missing: 1 })
  })

  it('keeps the loop ticking while thousands of files are scanned (the synchronous scan blocks it for the whole walk)', async () => {
    makeRound('big', 100, 200)   // 20,000 files
    const names = ['big']
    // before: the synchronous scan, as the IPC handler ran it
    const t0 = Date.now(); panama.stagedState('big'); const syncMs = Date.now() - t0
    panama.forgetScans()
    const probe = lagProbe()
    await panama.roundsOf(names)
    const { maxLag, ticks } = probe.stop()
    console.log(`panama scan of 20,000 files: sync blocks ${syncMs} ms; async max event-loop lag ${maxLag} ms over ${ticks} ticks`)
    expect(ticks).toBeGreaterThan(5)
    expect(maxLag).toBeLessThan(300)
  })

  it('answers a second scan of an unchanged round from the cache, and scans again when the folder changes or is forgotten', async () => {
    const dir = makeRound('c1', 2, 5)
    const a = await panama.stagedScanAsync('c1')
    expect(await panama.stagedScanAsync('c1')).toBe(a)   // same object: no walk
    const later = new Date(Date.now() + 5000); utimesSync(dir, later, later)   // the folder's mtime moved
    expect(await panama.stagedScanAsync('c1')).not.toBe(a)
    const b = await panama.stagedScanAsync('c1')
    panama.forgetScans('c1')
    expect(await panama.stagedScanAsync('c1')).not.toBe(b)
  })
})
