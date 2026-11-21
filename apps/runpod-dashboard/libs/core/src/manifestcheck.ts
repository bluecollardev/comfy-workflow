/**
 * Manifest check and rebuild (ADR-055 section 14): the round's RETURN-MANIFEST.json is generated from the element manifests, never edited by hand.
 * `check` is read-only over the round on the bucket. `rebuild` plans first (the diff, nothing written); `run` needs approved_by and understood,
 * keeps the previous manifest as RETURN-MANIFEST.backup-<UTC stamp>.json in the same folder (never deleted), writes the new one and reads it back.
 */
import { posix } from 'node:path'
import { bad, CoreError } from './errors.js'
import * as edl from './edl.js'
import * as failures from './failures.js'
import * as history from './history.js'
import * as layout from './publishlayout.js'
import * as publish from './publish.js'

export type FindingCode =
  | 'manifest-unreadable' | 'file-missing' | 'file-size-differs' | 'file-not-in-manifest' | 'frames-vs-edl' | 'frames-vs-files' | 'no-sha256' | 'no-issues-section'
  | 'no-element-manifest' | 'stale-item' | 'bundled-item' | 'duplicate-item' | 'item-differs'
export interface Finding { code: FindingCode; severity: 'error' | 'warning'; element: string; text: string }
export interface ElementReport {
  shot: string; element: string; manifest: string; ok: boolean; files_in_manifest: number; files_in_bucket: number; frames: number; expected_frames: number | null
  findings: Finding[]
}
export interface CheckResult {
  round: string; root: string; return_manifest: 'ok' | 'missing' | 'unreadable'; issues_json: 'ok' | 'missing' | 'unreadable' | 'not-ours'
  elements: ElementReport[]; round_findings: Finding[]
  summary: { elements: number; clean: number; with_findings: number; errors: number; warnings: number; return_items: number; element_manifests: number; missing_element_manifests: number; stale_items: number; bundled_items: number }
}
interface Loaded { key: string; shot: string; doc: { schema_version?: string; round?: string; returned_by?: string; returned_at?: string; pod?: layout.Pod; item: layout.ManifestItem; issues?: unknown } }
const MANIFEST_SUFFIX = '_MANIFEST.json'
const idOf = (shot: string, element: string) => `${shot}|${element}`.toLowerCase()
const label = (shot: string, element: string) => `${shot}/${element}`
const sort = <T extends { shot: string; element: string }>(x: T[]): T[] => x.sort((a, b) => a.shot.localeCompare(b.shot) || a.element.localeCompare(b.element))

async function gather(round: string) {
  const io = await publish.roundIo(round), listing = await io.list(), rel = (k: string) => k.slice(io.root.length)
  const round_findings: Finding[] = [], loaded: Loaded[] = [], unreadable: { key: string; why: string }[] = []
  for (const k of [...listing.keys()].sort()) {
    const r = rel(k), base = posix.basename(r)
    if (!base.endsWith(MANIFEST_SUFFIX) || base === layout.MANIFEST || r.split('/').length !== 2) continue
    const text = await io.read(k).catch(() => null)
    try {
      const doc = JSON.parse(text ?? '') as Loaded['doc']
      if (!doc?.item || !doc.item.shot || !doc.item.element || !Array.isArray(doc.item.outputs)) throw new Error('no item with shot, element and outputs')
      loaded.push({ key: k, shot: r.split('/')[0], doc })
    } catch (e) { unreadable.push({ key: r, why: (e as Error).message }); round_findings.push({ code: 'manifest-unreadable', severity: 'error', element: r, text: `${r} cannot be read as an element manifest: ${(e as Error).message}` }) }
  }
  const readState = async (name: string) => { const t = await io.read(`${io.root}${name}`).catch(() => null); if (t === null) return { text: null as string | null, state: 'missing' as const }; try { JSON.parse(t); return { text: t, state: 'ok' as const } } catch { return { text: t, state: 'unreadable' as const } } }
  const ret = await readState(layout.MANIFEST), iss = await readState('ISSUES.json')
  return { io, listing, rel, round_findings, loaded, unreadable, ret, iss }
}

export async function check(o: { round?: string }): Promise<CheckResult> {
  const round = layout.validateRound(o?.round), g = await gather(round)
  const { io, listing, rel } = g, round_findings = g.round_findings
  const seen = new Map<string, Loaded>(), elements: ElementReport[] = []
  for (const l of g.loaded) {
    const it = l.doc.item, id = idOf(it.shot, it.element), f: Finding[] = [], el = label(it.shot, it.element)
    if (seen.has(id)) f.push({ code: 'duplicate-item', severity: 'error', element: el, text: `Two element manifests are for ${el}: ${rel(seen.get(id)!.key)} and ${rel(l.key)}.` })
    seen.set(id, l)
    const own = new Set<string>(), dirs = new Set<string>(); let inBucket = 0
    for (const out of it.outputs) {
      own.add(out.path); if (out.role === 'dpx') dirs.add(posix.dirname(out.path))
      const bytes = listing.get(`${io.root}${out.path}`)
      if (bytes === undefined) f.push({ code: 'file-missing', severity: 'error', element: el, text: `${out.path} is in the manifest and not in the bucket.` })
      else { inBucket++; if (bytes !== out.bytes) f.push({ code: 'file-size-differs', severity: 'error', element: el, text: `${out.path}: ${out.bytes} bytes in the manifest, ${bytes} in the bucket.` }) }
      if (!out.sha256 || out.sha256 === 'n/a') f.push({ code: 'no-sha256', severity: 'warning', element: el, text: `${out.path} has no sha256.` })
    }
    for (const s of layout.straysOf(it, listing, io.root)) f.push({ code: 'file-not-in-manifest', severity: 'warning', element: el, text: `${s.name} (${s.bytes} bytes) is in the element's frame folder and not in its manifest.` })
    const dpx = it.outputs.filter((x) => x.role === 'dpx').length, frames = it.measures?.frames ?? 0
    if (dpx && frames !== dpx) f.push({ code: 'frames-vs-files', severity: 'error', element: el, text: `The manifest says ${frames} frames and lists ${dpx} DPX files.` })
    const m = edl.isLoaded() ? edl.matchSequence({ name: it.input_final?.delivered_name ?? '' }) : null
    const expected = m && (m.match === 'exact' || m.match === 'shot-element') ? m.element.frames_in_cut : null
    if (dpx && expected !== null && frames !== expected) f.push({ code: 'frames-vs-edl', severity: 'error', element: el, text: `${frames} DPX frames; the EDL cut has ${expected} (${frames > expected ? '+' : ''}${frames - expected}).` })
    if (!Array.isArray(l.doc.issues)) f.push({ code: 'no-issues-section', severity: 'warning', element: el, text: `${rel(l.key)} has no issues section (it was published before that was added; publishing the element again writes it).` })
    elements.push({ shot: it.shot, element: it.element, manifest: rel(l.key), ok: !f.length, files_in_manifest: it.outputs.length, files_in_bucket: inBucket, frames, expected_frames: expected, findings: f })
  }
  // frame folders with no element manifest: reported, never guessed
  const have = new Set(g.loaded.map((l) => idOf(l.doc.item.shot, l.doc.item.element))), missing = new Set<string>()
  for (const k of listing.keys()) {
    const r = rel(k); if (!/\.dpx$/i.test(r)) continue
    const parts = r.split('/'); if (parts.length < 3) continue
    const id = idOf(parts[0], layout.elementOf(parts[1]))
    if (have.has(id) || missing.has(id)) continue
    missing.add(id); round_findings.push({ code: 'no-element-manifest', severity: 'error', element: `${parts[0]}/${layout.elementOf(parts[1])}`, text: `${parts[0]}/${parts[1]}/ holds DPX frames and no ${parts[1]}${MANIFEST_SUFFIX}. It is not guessed: publish the element again to write it.` })
  }
  let returnItems = 0, stale = 0, bundled = 0
  if (g.ret.state === 'unreadable') round_findings.push({ code: 'manifest-unreadable', severity: 'error', element: layout.MANIFEST, text: `${layout.MANIFEST} is not valid JSON.` })
  if (g.ret.state === 'missing') round_findings.push({ code: 'stale-item', severity: 'warning', element: layout.MANIFEST, text: `${layout.MANIFEST} does not exist (a rebuild writes it).` })
  if (g.ret.state === 'ok') {
    const man = JSON.parse(g.ret.text!) as layout.Manifest, items = Array.isArray(man.items) ? man.items : []
    returnItems = items.length; const count = new Map<string, number>()
    for (const it of items) {
      const id = idOf(it.shot, it.element), el = label(it.shot, it.element); count.set(id, (count.get(id) ?? 0) + 1)
      const el1 = seen.get(id)
      if (!el1) {
        const shotHas = g.loaded.some((l) => l.doc.item.shot.toLowerCase() === String(it.shot).toLowerCase())
        if (it.element === 'main' && shotHas) { bundled++; round_findings.push({ code: 'bundled-item', severity: 'error', element: el, text: `${el} is not an element: its files belong to the element manifests of ${it.shot}. A rebuild drops it.` }) }
        else { stale++; round_findings.push({ code: 'stale-item', severity: 'error', element: el, text: `${el} is in ${layout.MANIFEST} and has no element manifest. A rebuild drops it.` }) }
      } else if (JSON.stringify(el1.doc.item) !== JSON.stringify(it)) round_findings.push({ code: 'item-differs', severity: 'warning', element: el, text: `${el} in ${layout.MANIFEST} differs from its element manifest. A rebuild takes the element manifest.` })
    }
    for (const [id, n] of count) if (n > 1) round_findings.push({ code: 'duplicate-item', severity: 'error', element: id, text: `${layout.MANIFEST} lists ${id.replace('|', '/')} ${n} times.` })
    for (const l of g.loaded) if (!count.has(idOf(l.doc.item.shot, l.doc.item.element))) round_findings.push({ code: 'stale-item', severity: 'error', element: label(l.doc.item.shot, l.doc.item.element), text: `${label(l.doc.item.shot, l.doc.item.element)} has an element manifest and no item in ${layout.MANIFEST}. A rebuild adds it.` })
  }
  let issuesState: CheckResult['issues_json'] = g.iss.state
  if (g.iss.state === 'ok' && (JSON.parse(g.iss.text!) as { schema?: unknown }).schema !== 'bh-issues-1') issuesState = 'not-ours'
  sort(elements)
  const all = [...elements.flatMap((e) => e.findings), ...round_findings]
  return {
    round, root: io.root, return_manifest: g.ret.state, issues_json: issuesState, elements, round_findings,
    summary: { elements: elements.length, clean: elements.filter((e) => e.ok).length, with_findings: elements.filter((e) => !e.ok).length, errors: all.filter((x) => x.severity === 'error').length, warnings: all.filter((x) => x.severity === 'warning').length,
      return_items: returnItems, element_manifests: g.loaded.length, missing_element_manifests: missing.size, stale_items: stale, bundled_items: bundled },
  }
}

export interface RebuildPlan {
  round: string; root: string; blockers: string[]; write: boolean; before_items: number; after_items: number
  add: string[]; remove: string[]; changed: string[]; issues_json: { write: boolean; before: number | null; after: number }; backup_key: string
}
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

async function planOf(round: string) {
  const g = await gather(round), c = await check({ round }), blockers: string[] = []
  for (const u of g.unreadable) blockers.push(`${u.key} cannot be read (${u.why}): fix or republish it first.`)
  for (const e of c.elements) for (const f of e.findings) if (f.code === 'file-missing' || f.code === 'duplicate-item') blockers.push(f.text)
  if (g.ret.state === 'unreadable') blockers.push(`${layout.MANIFEST} is not valid JSON: nothing is overwritten.`)
  let old: layout.Manifest | null = null
  if (g.ret.state === 'ok') {
    old = JSON.parse(g.ret.text!) as layout.Manifest
    if (old.schema_version !== layout.SCHEMA || !Array.isArray(old.items) || (old.round !== undefined && old.round !== round)) blockers.push(`${layout.MANIFEST} is not a ${layout.SCHEMA} manifest for this round: nothing is overwritten.`)
  }
  if (!g.loaded.length) blockers.push('The round has no element manifests: there is nothing to rebuild from.')
  const items = sort(g.loaded.map((l) => l.doc.item)), oldItems = old && Array.isArray(old.items) ? old.items : []
  const oid = new Map(oldItems.map((i) => [idOf(i.shot, i.element), i])), nid = new Map(items.map((i) => [idOf(i.shot, i.element), i]))
  const add = items.filter((i) => !oid.has(idOf(i.shot, i.element))).map((i) => label(i.shot, i.element))
  const remove = oldItems.filter((i) => !nid.has(idOf(i.shot, i.element))).map((i) => label(i.shot, i.element))
  const changed = items.filter((i) => oid.has(idOf(i.shot, i.element)) && JSON.stringify(oid.get(idOf(i.shot, i.element))) !== JSON.stringify(i)).map((i) => label(i.shot, i.element))
  const sameItems = JSON.stringify(oldItems) === JSON.stringify(items)
  // ISSUES.json from the same facts publish uses: the elements of this round's shots that failed and have no delivered item
  const roundShots = new Set(items.map((i) => i.shot.toLowerCase())), expected = new Map<string, { shot: string; element: string }>(), fin: layout.FailureIn[] = []
  try {
    for (const f of (await failures.list({ limit: 500 })).failures) {
      const ge = f.graph ? layout.graphElement(f.graph) : null
      if (!ge || !roundShots.has(ge.shot)) continue
      if (edl.isLoaded() && edl.lookup({ shot: ge.shot, element: ge.element.toLowerCase() }).match === 'not-in-edl') continue
      expected.set(`${ge.shot}|${ge.element}`.toLowerCase(), ge); fin.push({ ...ge, graph: f.graph, stage: f.stage, node: f.node, message: f.message, recovery: f.recovery, retryable: f.retryable, retries: f.retries, at: f.at, ...(f.pod_id ? { pod: f.pod_id } : {}), job_id: f.job_id })
    }
  } catch { /* advice only */ }
  const issues = layout.roundIssuesOf([...expected.values()], items, fin)
  let before: number | null = null, oldIssues: unknown = null, ours = g.iss.state === 'missing'
  if (g.iss.state === 'ok') { const d = JSON.parse(g.iss.text!) as { schema?: unknown; issues?: unknown[] }; ours = d.schema === 'bh-issues-1'; if (ours) { oldIssues = d.issues ?? []; before = (d.issues ?? []).length } }
  else if (g.iss.state === 'unreadable') ours = false
  const issuesWrite = ours && (issues.length > 0 || g.iss.state === 'ok') && JSON.stringify(oldIssues) !== JSON.stringify(issues)
  const plan: RebuildPlan = { round, root: g.io.root, blockers, write: g.ret.state !== 'ok' || !sameItems, before_items: oldItems.length, after_items: items.length, add, remove, changed, issues_json: { write: issuesWrite, before, after: issues.length }, backup_key: `${g.io.root}RETURN-MANIFEST.backup-${stamp(g.io.now())}.json` }
  return { plan, g, old, items, issues }
}

export async function plan(o: { round?: string }): Promise<RebuildPlan & { note: string }> {
  const p = (await planOf(layout.validateRound(o?.round))).plan
  return { ...p, note: p.blockers.length ? 'Blocked: nothing can be written until these are fixed.' : !p.write && !p.issues_json.write ? 'Nothing to change: the manifest already matches the element manifests.' : 'Nothing is written by a plan. run needs approved_by and understood: true.' }
}

export async function run(o: { round?: string; approved_by?: string; understood?: boolean }): Promise<{ round: string; written: boolean; backup: string | null; items: number; issues_written: boolean; verified: boolean; plan: RebuildPlan }> {
  const who = String(o?.approved_by ?? '').trim(); if (!who) throw bad('Rebuilding RETURN-MANIFEST.json needs the name of who says yes (approved_by)')
  if (o?.understood !== true) throw bad('Rebuilding RETURN-MANIFEST.json replaces the file in the round: pass understood: true after reading the plan (the previous one is kept as a backup)')
  const round = layout.validateRound(o?.round), io0 = await publish.roundIo(round)
  if (io0.publishing()) throw new CoreError(409, `A publish job is writing round ${round}: wait for it to finish, then rebuild.`)
  return io0.lock(async () => {
    const { plan: pl, g, old, items, issues } = await planOf(round), io = g.io
    if (pl.blockers.length) throw new CoreError(409, `The manifest is not rebuilt: ${pl.blockers.join(' ')}`)
    if (io.publishing()) throw new CoreError(409, `A publish job is writing round ${round}: wait for it to finish, then rebuild.`)
    if (!pl.write && !pl.issues_json.write) return { round, written: false, backup: null, items: items.length, issues_written: false, verified: true, plan: pl }
    const now = io.now(), mk = `${io.root}${layout.MANIFEST}`
    let backup: string | null = null
    if (g.ret.state === 'ok' && pl.write) {
      backup = pl.backup_key; await io.put(backup, g.ret.text!)
      if ((await io.read(backup)) !== g.ret.text) throw new CoreError(502, 'The backup of RETURN-MANIFEST.json could not be read back: the manifest was not changed.')
    }
    if (pl.write) {
      const next: layout.Manifest = { schema_version: layout.SCHEMA, round, returned_by: old?.returned_by || who, returned_at: layout.isoWithOffset(now), pod: old?.pod ?? layout.NO_POD, items }
      const text = `${JSON.stringify(next, null, 2)}\n`; await io.put(mk, text)
      const back = await io.read(mk)
      let ok = false; try { const b = JSON.parse(back ?? '') as layout.Manifest; ok = b.items.length === items.length && JSON.stringify(b.items) === JSON.stringify(items) } catch { /* not ok */ }
      if (!ok) throw new CoreError(502, `RETURN-MANIFEST.json was written and does not read back as written; the previous one is ${backup ? posix.basename(backup) : 'not there (it did not exist)'}.`)
    }
    if (pl.issues_json.write) await io.put(`${io.root}ISSUES.json`, `${JSON.stringify({ schema: 'bh-issues-1', round, generated_at: layout.isoWithOffset(now), issues }, null, 2)}\n`)
    history.record({ kind: 'change', area: 'outputs', action: 'RETURN-MANIFEST.json rebuilt', what: round, detail: `${pl.before_items} to ${pl.after_items} items; removed ${pl.remove.join(', ') || 'none'}; added ${pl.add.join(', ') || 'none'}; backup ${backup ? posix.basename(backup) : 'none'}; by ${who}` })
    return { round, written: pl.write, backup, items: items.length, issues_written: pl.issues_json.write, verified: true, plan: pl }
  })
}
