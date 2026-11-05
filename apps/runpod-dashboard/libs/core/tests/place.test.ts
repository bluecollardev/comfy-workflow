import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as place from '../src/place.js'
import type { SshRunner } from '../src/podpull.js'

// Placing a pulled round on the pod (docs/ADR-033). The rewrite is pure; the pod scripts are run here for real, in a temp folder standing in for /workspace/comfy-shared.
const ROUND = 'brynley-comfy-2026-10-22'
const REAL = '/Users/lucas/ComfyUI-Shared/workflows/panama-imax-redux/brynley-comfy-2026-10-20'
const GRAPH = 'cgi-042-common-nodes-v13-delivery-20261020.json'

describe('rewriteGraph', () => {
  const manifest = { 'shots/a/x.png': { bytes: 1 }, 'shots/a/v.mp4': { bytes: 2 } }
  const ui = { nodes: [
    { id: 1, type: 'LoadImage', widgets_values: ['shots/a/x.png', 'image'] },
    { id: 2, type: 'LoadVideo', widgets_values: ['shots/a/v.mp4'] },
    { id: 3, type: 'SaveImage', widgets_values: ['shots/a/x.png'] },          // not a loader: left alone
    { id: 4, type: 'LoadImage', widgets_values: ['shots/other/y.png', 'image'] }, // a path that is not in the manifest: unresolved
  ] }

  it('rewrites only Load* values the manifest lists, to rounds/<round>/<path>, and lists the rest', () => {
    const r = place.rewriteGraph(ui as never, manifest, ROUND)
    const n = (r.graph as { nodes: { widgets_values: string[] }[] }).nodes
    expect(n[0].widgets_values).toEqual([`rounds/${ROUND}/shots/a/x.png`, 'image'])
    expect(n[1].widgets_values).toEqual([`rounds/${ROUND}/shots/a/v.mp4`])
    expect(n[2].widgets_values).toEqual(['shots/a/x.png'])
    expect(n[3].widgets_values).toEqual(['shots/other/y.png', 'image'])
    expect(r.rewritten.sort()).toEqual(['shots/a/v.mp4', 'shots/a/x.png'])
    expect(r.unresolved).toEqual(['shots/other/y.png'])
    expect((ui.nodes[0].widgets_values as string[])[0]).toBe('shots/a/x.png')   // the input is untouched
  })

  it('is idempotent: a graph that already carries the prefix is left as it is', () => {
    const once = place.rewriteGraph(ui as never, manifest, ROUND)
    const twice = place.rewriteGraph(once.graph, manifest, ROUND)
    expect(twice.graph).toEqual(once.graph)
    expect(twice.rewritten).toEqual([])
  })

  it('handles the API format (class_type + inputs)', () => {
    const api = { '1': { class_type: 'LoadImage', inputs: { image: 'shots/a/x.png' } }, '2': { class_type: 'KSampler', inputs: { seed: 5 } } }
    const r = place.rewriteGraph(api as never, manifest, ROUND)
    expect((r.graph as never as Record<string, { inputs: { image?: string } }>)['1'].inputs.image).toBe(`rounds/${ROUND}/shots/a/x.png`)
    expect(r.rewritten).toEqual(['shots/a/x.png'])
  })

  it('refuses a round name that is not a folder name', () => { expect(() => place.rewriteGraph({}, {}, '../x')).toThrow() })

  const haveReal = existsSync(join(REAL, GRAPH))
  it.runIf(haveReal)("the real cgi-042 graph: all 28 inputs in BH's manifest are rewritten and none is left over", () => {
    const g = JSON.parse(readFileSync(join(REAL, GRAPH), 'utf8')), m = JSON.parse(readFileSync(join(REAL, GRAPH.replace('.json', '-inputs-manifest.json')), 'utf8'))
    const r = place.rewriteGraph(g, m, ROUND)
    expect(r.rewritten).toContain('shots/cgi-042/05-outputs/Approved/master/cgi-042-pullback-4k-v03.mp4')
    expect(r.rewritten.length).toBe(Object.keys(m).filter((k) => r.rewritten.includes(k)).length)
    expect(r.rewritten.length).toBeGreaterThanOrEqual(28)
    expect(r.unresolved).toEqual([])
    const again = place.rewriteGraph(r.graph, m, ROUND)
    expect(again.rewritten).toEqual([])
  })
})

/** Run a script the way the pod would, in a temp folder standing in for /workspace/comfy-shared. */
const localSsh = (root: string): SshRunner => async ({ script, onLine }) => {
  const r = spawnSync('bash', ['-s'], { input: script.split(place.REMOTE_SHARED).join(root), encoding: 'utf8', maxBuffer: 1 << 28 })
  for (const l of (r.stdout + r.stderr).split('\n')) if (l) onLine(l)
  return { code: r.status }
}
const put = (f: string, text: string) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text) }

/** A staged round with one shot: a graph, its manifest and two input files, under temp/rounds/<round>/<shot>/comfy/. */
function stage(root: string) {
  const shot = join(root, 'temp', 'rounds', ROUND, 'cgi-042', 'comfy')
  put(join(shot, 'input', 'shots', 'cgi-042', 'a.png'), 'AAAA')
  put(join(shot, 'input', 'shots', 'cgi-042', 'v.mp4'), 'VVVVVVVV')
  const graph = { nodes: [{ id: 1, type: 'LoadImage', widgets_values: ['shots/cgi-042/a.png', 'image'] }, { id: 2, type: 'LoadVideo', widgets_values: ['shots/cgi-042/v.mp4'] }] }
  put(join(shot, 'workflows', 'g.json'), JSON.stringify(graph))
  put(join(shot, 'workflows', 'g-inputs-manifest.json'), JSON.stringify({ 'shots/cgi-042/a.png': { bytes: 4 }, 'shots/cgi-042/v.mp4': { bytes: 8 } }))
  return graph
}
const tmp = () => mkdtempSync(join(tmpdir(), 'place-'))

describe('place.run on a (local stand-in for the) pod', () => {
  it('a dry run reports and writes nothing', async () => {
    const root = tmp(); stage(root)
    const r = await place.run(ROUND, { host: 'h', port: 1, ssh: localSsh(root) })   // dry_run defaults to true
    expect(r.dry_run).toBe(true); expect(r.ok).toBe(true)
    expect(r.linked).toBe(4)   // two files, each at the round path and as shipped
    expect(r.graphs.map((g) => g.name)).toEqual(['g.json']); expect(r.rewritten).toBe(2)
    expect(existsSync(join(root, 'input'))).toBe(false); expect(existsSync(join(root, 'workflows'))).toBe(false)
  })

  it('links the inputs twice (hard links), writes the corrected graph and the as-delivered one, and the paths then exist', async () => {
    const root = tmp(); const graph = stage(root)
    const r = await place.run(ROUND, { host: 'h', port: 1, ssh: localSsh(root), dry_run: false })
    expect(r).toMatchObject({ ok: true, mode: 'hardlink', linked: 4, already_there: 0, conflicts: [], missing: [] })
    const src = join(root, 'temp/rounds', ROUND, 'cgi-042/comfy/input/shots/cgi-042/a.png')
    expect(readFileSync(join(root, 'input/shots/cgi-042/a.png'), 'utf8')).toBe('AAAA')
    expect(readFileSync(join(root, 'input/rounds', ROUND, 'shots/cgi-042/v.mp4'), 'utf8')).toBe('VVVVVVVV')
    expect(statSync(join(root, 'input/shots/cgi-042/a.png')).ino).toBe(statSync(src).ino)   // no second copy of the bytes
    const w = join(root, 'workflows/rounds', ROUND)
    const fixed = JSON.parse(readFileSync(join(w, 'g.json'), 'utf8'))
    expect(fixed.nodes[0].widgets_values[0]).toBe(`rounds/${ROUND}/shots/cgi-042/a.png`)
    expect(JSON.parse(readFileSync(join(w, 'g.as-delivered.json'), 'utf8'))).toEqual(graph)
    expect(existsSync(join(root, 'input', fixed.nodes[1].widgets_values[0]))).toBe(true)
  })

  it('a big graph works: the real ones are over 100 KB, twice in the payload, past what one environment string can hold', async () => {
    const root = tmp(); stage(root)
    const w = join(root, 'temp/rounds', ROUND, 'cgi-042/comfy/workflows')
    const nodes = Array.from({ length: 4000 }, (_, k) => ({ id: k + 10, type: 'Note', widgets_values: ['x'.repeat(40)] }))
    put(join(w, 'g.json'), JSON.stringify({ nodes: [{ id: 1, type: 'LoadImage', widgets_values: ['shots/cgi-042/a.png', 'image'] }, ...nodes] }))
    expect(statSync(join(w, 'g.json')).size).toBeGreaterThan(200_000)
    const r = await place.run(ROUND, { host: 'h', port: 1, ssh: localSsh(root), dry_run: false })
    expect(r).toMatchObject({ ok: true, rewritten: 1 })
    expect(statSync(join(root, 'workflows/rounds', ROUND, 'g.json')).size).toBeGreaterThan(200_000)
  })

  it('is idempotent: a second run links nothing and changes nothing', async () => {
    const root = tmp(); stage(root)
    await place.run(ROUND, { host: 'h', port: 1, ssh: localSsh(root), dry_run: false })
    const before = readFileSync(join(root, 'workflows/rounds', ROUND, 'g.json'), 'utf8')
    const r = await place.run(ROUND, { host: 'h', port: 1, ssh: localSsh(root), dry_run: false })
    expect(r).toMatchObject({ ok: true, linked: 0, already_there: 4, conflicts: [] })
    expect(readFileSync(join(root, 'workflows/rounds', ROUND, 'g.json'), 'utf8')).toBe(before)
  })

  it('a different file already at the shipped path is a conflict: reported, never replaced; the round copy is still made', async () => {
    const root = tmp(); stage(root)
    put(join(root, 'input/shots/cgi-042/a.png'), 'OLD-DIFFERENT')
    const r = await place.run(ROUND, { host: 'h', port: 1, ssh: localSsh(root), dry_run: false })
    expect(r.conflicts).toEqual([{ path: 'shots/cgi-042/a.png', where: 'shipped', existing_size: 13, round_size: 4 }])
    expect(readFileSync(join(root, 'input/shots/cgi-042/a.png'), 'utf8')).toBe('OLD-DIFFERENT')
    expect(readFileSync(join(root, 'input/rounds', ROUND, 'shots/cgi-042/a.png'), 'utf8')).toBe('AAAA')
    expect(r.ok).toBe(true)   // the graph opens from the round copy
  })

  it('an input the graph names but the round does not carry is listed as missing (ok false)', async () => {
    const root = tmp(); stage(root)
    const g = join(root, 'temp/rounds', ROUND, 'cgi-042/comfy/workflows')
    put(join(g, 'g-inputs-manifest.json'), JSON.stringify({ 'shots/cgi-042/a.png': {}, 'shots/cgi-042/v.mp4': {}, 'shots/cgi-042/gone.png': {} }))
    put(join(g, 'g.json'), JSON.stringify({ nodes: [{ id: 1, type: 'LoadImage', widgets_values: ['shots/cgi-042/gone.png', 'image'] }] }))
    const r = await place.run(ROUND, { host: 'h', port: 1, ssh: localSsh(root), dry_run: false })
    expect(r.ok).toBe(false); expect(r.missing).toEqual(['shots/cgi-042/gone.png'])
  })

  it('a round that is not on the volume comes back as ok false with the reason', async () => {
    const root = tmp()
    const r = await place.run(ROUND, { host: 'h', port: 1, ssh: localSsh(root) })
    expect(r.ok).toBe(false); expect(r.error).toContain('not on the volume')
  })

  it('hard links are optional: the script falls back to a copy where the volume has none', () => {
    expect(place.applyScript(ROUND, [], true)).toContain('shutil.copy2')
  })
})
