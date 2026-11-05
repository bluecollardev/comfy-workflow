/**
 * Placing a pulled round on the pod (docs/ADR-033). A pod pull leaves a round at /workspace/comfy-shared/temp/rounds/<round>, but BH's graphs name their
 * inputs relative to ComfyUI's input/ and ComfyUI's loaders open only files under it. Placing fixes that, on the pod, over the Sync's SSH transport:
 *
 *  1. files: each shot's `comfy/input/` is linked into input/rounds/<round>/ (hard links, a copy where the volume has none) and, where free, also at
 *     the path BH shipped (input/<path>). A file already there with the same size and sha256 is left; a different one is a CONFLICT, reported, never
 *     replaced. Nothing is deleted and nothing under temp/ is written.
 *  2. graphs: each `comfy/workflows/<graph>.json` is copied to workflows/rounds/<round>/<graph>.json with the Load* paths that its inputs manifest lists
 *     rewritten (to unique top-level names, ADR-033 amendment). The untouched original stays where the pull put it, in the round folder; it is not copied into
 *     the Workflows panel, so the panel lists only graphs that open clean.
 *
 * The rewrite is a pure function (`rewriteGraph`, tested without a pod). The pod only reads (`inventoryScript`) and writes (`applyScript`); what goes where is
 * decided here. The scripts take no secrets; the round name is checked against the same pattern as a pull.
 */
import { bad } from './errors.js'
import type { SshRunner } from './podpull.js'

export const REMOTE_SHARED = '/workspace/comfy-shared'
const ROUND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/
const assertRound = (round: string) => { if (typeof round !== 'string' || !ROUND.test(round)) throw bad(`Not a round name: ${round}`) }

/** Where a round's files and graphs go, relative to input/ and workflows/. */
export const roundPrefix = (round: string) => `rounds/${round}/`

export interface Conflict { path: string; where: 'round' | 'shipped' | 'flat'; existing_size?: number; round_size?: number }
export interface GraphReport { shot: string; name: string; path: string; rewritten: number; unresolved: string[] }
export interface PlaceReport {
  round: string; dry_run: boolean; ok: boolean
  mode: 'hardlink' | 'copy' | 'none'
  linked: number; already_there: number; conflicts: Conflict[]
  graphs: GraphReport[]; rewritten: number; unresolved: string[]
  /** Rewritten paths with no file under input/rounds/<round>/ (or, in a dry run, in the round's own comfy/input): the graph opens with a missing input. */
  missing: string[]
  error?: string
}

// ----- the pure part: one graph + its inputs manifest -----

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
export interface RewriteResult { graph: Json; rewritten: string[]; unresolved: string[]; /** original manifest path -> the value now in the graph (relative to input/) */ targets: Record<string, string> }
/** How a path is written into a graph: `round` = rounds/<round>/<path> (a subfolder); `flat` = one unique bare name at the top of input/, so ComfyUI's file dropdown lists it (it lists only top-level files, and its frontend calls anything else a missing input). */
export type Names = 'round' | 'flat'
const sha8 = (m: unknown) => { const h = (m as { sha256?: unknown } | null)?.sha256; return typeof h === 'string' && /^[0-9a-f]{8,}$/i.test(h) ? h.slice(0, 8).toLowerCase() : '' }
/** `<shot>__<file stem>__<first 8 of the sha256>.<ext>`: unique by content, so two rounds with a different file of the same name never collide, and the same file always gets the same name. */
export function flatName(path: string, entry: unknown): string {
  const parts = path.split('/'), file = parts[parts.length - 1], dot = file.lastIndexOf('.')
  const stem = dot > 0 ? file.slice(0, dot) : file, ext = dot > 0 ? file.slice(dot) : ''
  const shot = parts[0] === 'shots' && parts.length > 2 ? parts[1] : ''
  const h = sha8(entry)
  return [shot, stem, h].filter(Boolean).join('__') + ext
}
/** A node type that loads media: LoadImage, LoadImageMask, LoadVideo, LoadAudio, and the packs' own (BincLoadImageSequence, ...). */
const isLoader = (type: unknown) => typeof type === 'string' && /load/i.test(type)
const MEDIA_EXT = /\.(png|jpe?g|webp|bmp|tiff?|exr|dpx|gif|mp4|mov|mkv|webm|avi|m4v|wav|mp3|flac|ogg|aac|obj|glb|safetensors)$/i
const looksLikePath = (v: string) => MEDIA_EXT.test(v)

/**
 * Rewrite the Load* paths of a graph that its inputs manifest lists, to rounds/<round>/<path>. A UI graph (nodes[].widgets_values) and an API graph
 * ({ id: { class_type, inputs } }) are both handled. A value that is not a key of the manifest is left alone and, when it looks like a media path, listed
 * as unresolved. A value that already carries the round's prefix is left alone (so a second run changes nothing). The input is not modified.
 */
export function rewriteGraph(graph: Json, manifest: Record<string, unknown>, round: string, names: Names = 'round'): RewriteResult {
  assertRound(round)
  const prefix = roundPrefix(round)
  const out = JSON.parse(JSON.stringify(graph)) as Json
  const rewritten: string[] = [], unresolved: string[] = [], targets: Record<string, string> = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(manifest, k)
  const target = (k: string) => (names === 'flat' ? flatName(k, manifest[k]) : prefix + k)
  const placed = new Set(Object.keys(manifest).map(target))   // a value that is already one of our targets: left alone, so a second run changes nothing
  const fix = (v: unknown): string | null => {
    if (typeof v !== 'string' || !v) return null
    if (placed.has(v)) return null
    if (names === 'round' && v.startsWith(prefix) && has(v.slice(prefix.length))) return null   // already placed
    if (has(v)) { rewritten.push(v); targets[v] = target(v); return targets[v] }
    if (looksLikePath(v) && !v.startsWith(prefix)) unresolved.push(v)
    return null
  }
  const node = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const o = n as Record<string, Json>
    if (!isLoader(o.type ?? o.class_type)) return
    if (Array.isArray(o.widgets_values)) o.widgets_values = o.widgets_values.map((w) => { const r = fix(w); return r ?? w })
    if (o.inputs && typeof o.inputs === 'object' && !Array.isArray(o.inputs)) {
      const inp = o.inputs as Record<string, Json>
      for (const k of Object.keys(inp)) { const r = fix(inp[k]); if (r) inp[k] = r }
    }
  }
  const g = out as { nodes?: unknown[]; definitions?: { subgraphs?: { nodes?: unknown[] }[] } } & Record<string, unknown>
  if (Array.isArray(g.nodes)) { for (const n of g.nodes) node(n); for (const sg of g.definitions?.subgraphs ?? []) for (const n of sg.nodes ?? []) node(n) }
  else for (const v of Object.values(g)) node(v)   // API format: every top-level value is a node
  return { graph: out, rewritten: [...new Set(rewritten)], unresolved: [...new Set(unresolved)], targets }
}

/** The inputs manifest that goes with a graph: `<graph>-inputs-manifest.json`. */
export const manifestNameFor = (graphFile: string) => graphFile.replace(/\.json$/i, '') + '-inputs-manifest.json'
export const isManifestFile = (f: string) => /-inputs-manifest\.json$/i.test(f)

export interface InvFile { shot: string; name: string; text: string }
export interface GraphPlan { shot: string; name: string; original: string; rewrittenText: string; rewritten: string[]; unresolved: string[]; targets: Record<string, string> }
/** From the inventory (graph and manifest files by shot) to the graph copies to write. A graph with no manifest is copied unchanged and its media paths listed as unresolved. */
export function planGraphs(files: InvFile[], round: string, names: Names = 'flat'): GraphPlan[] {
  const byKey = new Map(files.map((f) => [`${f.shot}/${f.name}`, f]))
  const plans: GraphPlan[] = []
  for (const f of files) {
    if (isManifestFile(f.name)) continue
    let graph: Json
    try { graph = JSON.parse(f.text) as Json } catch { continue }   // not a graph we can read: left where it is
    const m = byKey.get(`${f.shot}/${manifestNameFor(f.name)}`)
    let manifest: Record<string, unknown> = {}
    try { if (m) manifest = JSON.parse(m.text) as Record<string, unknown> } catch { /* no usable manifest */ }
    const r = rewriteGraph(graph, manifest, round, names)
    plans.push({ shot: f.shot, name: f.name, original: f.text, rewrittenText: JSON.stringify(r.graph), rewritten: r.rewritten, unresolved: r.unresolved, targets: r.targets })
  }
  return plans
}

// ----- the scripts that run on the pod -----

const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`

/** Prints, per shot of the round, each comfy/workflows/*.json as `PLACE-FILE<TAB>shot<TAB>name<TAB>base64`. */
export function inventoryScript(round: string): string {
  assertRound(round)
  return [
    'set -eu', `export PLACE_ROUND=${q(round)}`, `export PLACE_ROOT=${q(REMOTE_SHARED)}`,
    `[ -d "$PLACE_ROOT/temp/rounds/$PLACE_ROUND" ] || { echo "PLACE-ERROR the round is not on the volume: $PLACE_ROOT/temp/rounds/$PLACE_ROUND"; exit 3; }`,
    `python3 - <<'PY'`,
    'import os, base64',
    "rnd = os.environ['PLACE_ROUND']; root = os.environ['PLACE_ROOT'] + '/temp/rounds/' + rnd",
    'for shot in sorted(os.listdir(root)):',
    "    w = os.path.join(root, shot, 'comfy', 'workflows')",
    '    if not os.path.isdir(w): continue',
    '    for f in sorted(os.listdir(w)):',
    "        if f.lower().endswith('.json'):",
    "            b = open(os.path.join(w, f), 'rb').read()",
    "            print('PLACE-FILE\\t%s\\t%s\\t%s' % (shot, f, base64.b64encode(b).decode()))",
    "print('PLACE-INV-DONE')",
    'PY', '',
  ].join('\n')
}

const APPLY_PY = String.raw`
import os, sys, json, base64, hashlib, shutil
p = json.loads(base64.b64decode(open(os.environ['PLACE_PAYLOAD_FILE']).read()))
rnd = p['round']; dry = p['dry']
R = os.environ['PLACE_ROOT']
src = R + '/temp/rounds/' + rnd
rep = {'linked': 0, 'already_there': 0, 'conflicts': [], 'mode': 'none', 'missing': []}
used = set()
def sha(f):
    h = hashlib.sha256()
    with open(f, 'rb') as fh:
        for c in iter(lambda: fh.read(1 << 22), b''): h.update(c)
    return h.hexdigest()
def same(a, b):
    if os.path.getsize(a) != os.path.getsize(b): return False
    try:
        if os.path.samefile(a, b): return True
    except OSError: pass
    return sha(a) == sha(b)
def put(s, d, where, rel):
    if os.path.lexists(d):
        if os.path.isfile(d) and same(s, d): rep['already_there'] += 1; return
        rep['conflicts'].append({'path': rel, 'where': where, 'existing_size': os.path.getsize(d) if os.path.isfile(d) else None, 'round_size': os.path.getsize(s)}); return
    rep['linked'] += 1
    if dry: return
    os.makedirs(os.path.dirname(d), exist_ok=True)
    try:
        os.link(s, d); used.add('hardlink')
    except OSError:
        shutil.copy2(s, d); used.add('copy')
if os.path.isdir(src):
    for shot in sorted(os.listdir(src)):
        base = os.path.join(src, shot, 'comfy', 'input')
        if not os.path.isdir(base): continue
        for dp, dn, fn in os.walk(base):
            dn.sort()
            for f in sorted(fn):
                s = os.path.join(dp, f)
                if f == '.DS_Store': continue
                rel = os.path.relpath(s, base)
                put(s, os.path.join(R, 'input', 'rounds', rnd, rel), 'round', rel)
                put(s, os.path.join(R, 'input', rel), 'shipped', rel)
flat = {}
for g in p['graphs']: flat.update(g['targets'])
def source_of(path):
    for shot in sorted(os.listdir(src)) if os.path.isdir(src) else []:
        c = os.path.join(src, shot, 'comfy', 'input', path)
        if os.path.isfile(c): return c
    return None
if p['flat']:
    for path, name in sorted(flat.items()):
        s0 = source_of(path)
        if s0: put(s0, os.path.join(R, 'input', name), 'flat', name)
rep['mode'] = 'copy' if 'copy' in used else ('hardlink' if 'hardlink' in used else 'none')
if not dry:
    wd = os.path.join(R, 'workflows', 'rounds', rnd)
    for g in p['graphs']:
        os.makedirs(wd, exist_ok=True)
        open(os.path.join(wd, g['name']), 'w').write(g['rewritten'])
def exists_placed(path, target):
    if os.path.isfile(os.path.join(R, 'input', target)): return True
    if not dry: return False
    return source_of(path) is not None
for g in p['graphs']:
    for path in g['rewritten_paths']:
        if not exists_placed(path, g['targets'][path]) and path not in rep['missing']: rep['missing'].append(path)
print('PLACE-REPORT ' + json.dumps(rep))
`

/** The apply script: the plan (round, dry run, graph copies) rides as base64 in a temp file written by a heredoc; it holds no secret. */
export function applyScript(round: string, plans: GraphPlan[], dryRun: boolean, names: Names = 'flat'): string {
  assertRound(round)
  const payload = Buffer.from(JSON.stringify({ round, dry: dryRun, flat: names === 'flat', graphs: plans.map((g) => ({ name: g.name, rewritten: g.rewrittenText, original: g.original, rewritten_paths: g.rewritten, targets: g.targets })) })).toString('base64')
  // The payload (two copies of every graph, base64) is far over the 128 KB a single environment string can hold on Linux, so it goes to a temp file through a heredoc, not through the environment.
  return ['set -eu', `export PLACE_ROOT=${q(REMOTE_SHARED)}`, 'PLACE_PAYLOAD_FILE="$(mktemp)"; export PLACE_PAYLOAD_FILE; trap \'rm -f "$PLACE_PAYLOAD_FILE"\' EXIT', `cat > "$PLACE_PAYLOAD_FILE" <<'PLACE_B64'`, payload, 'PLACE_B64', `python3 - <<'PY'`, APPLY_PY.trim(), 'PY', ''].join('\n')
}

export const parseInventory = (lines: string[]): InvFile[] => lines.filter((l) => l.startsWith('PLACE-FILE\t')).map((l) => {
  const [, shot, name, b64] = l.split('\t')
  return { shot, name, text: Buffer.from(b64 ?? '', 'base64').toString('utf8') }
})

export const failed = (round: string, dryRun: boolean, error: string): PlaceReport => ({ round, dry_run: dryRun, ok: false, mode: 'none', linked: 0, already_there: 0, conflicts: [], graphs: [], rewritten: 0, unresolved: [], missing: [], error })

/** A report for no-spend mode and tests: the shape of a real one, nothing touched. */
export function simulated(round: string, dryRun: boolean): PlaceReport {
  return { round, dry_run: dryRun, ok: true, mode: 'hardlink', linked: 2, already_there: 0, conflicts: [], graphs: [{ shot: 'cgi-042', name: 'cgi-042-graph.json', path: `workflows/${roundPrefix(round)}cgi-042-graph.json`, rewritten: 1, unresolved: [] }], rewritten: 1, unresolved: [], missing: [] }
}

export interface RunOpts { host: string; port: number; ssh: SshRunner; dry_run?: boolean; names?: Names; signal?: AbortSignal; onLine?: (l: string) => void }

/** Place a round that is on the pod's volume. Throws on a transport failure; a round that is not there, or a pod error, comes back as `ok: false` with `error`. */
export async function run(round: string, o: RunOpts): Promise<PlaceReport> {
  assertRound(round)
  const dryRun = o.dry_run !== false
  const signal = o.signal ?? new AbortController().signal
  const empty = (error: string) => failed(round, dryRun, error)
  const inv: string[] = []
  const a = await o.ssh({ host: o.host, port: o.port, script: inventoryScript(round), onLine: (l) => { inv.push(l) }, signal })
  const err = inv.find((l) => l.startsWith('PLACE-ERROR'))
  if (err) return empty(err.replace(/^PLACE-ERROR\s*/, ''))
  if (a.code !== 0 || !inv.includes('PLACE-INV-DONE')) return empty(`Could not read the round's graphs on the pod (exit ${a.code}).`)
  const names = o.names ?? 'flat'
  const plans = planGraphs(parseInventory(inv), round, names)
  const out: string[] = []
  const b = await o.ssh({ host: o.host, port: o.port, script: applyScript(round, plans, dryRun, names), onLine: (l) => { out.push(l); o.onLine?.(l) }, signal })
  const line = out.find((l) => l.startsWith('PLACE-REPORT '))
  if (b.code !== 0 || !line) return empty(`Placing did not finish on the pod (exit ${b.code}): ${out.slice(-2).join(' | ')}`)
  const r = JSON.parse(line.slice('PLACE-REPORT '.length)) as { linked: number; already_there: number; conflicts: Conflict[]; mode: PlaceReport['mode']; missing: string[] }
  const graphs: GraphReport[] = plans.map((g) => ({ shot: g.shot, name: g.name, path: `workflows/${roundPrefix(round)}${g.name}`, rewritten: g.rewritten.length, unresolved: g.unresolved }))
  return { round, dry_run: dryRun, ok: r.missing.length === 0, mode: r.mode, linked: r.linked, already_there: r.already_there, conflicts: r.conflicts, graphs, rewritten: graphs.reduce((n, g) => n + g.rewritten, 0), unresolved: [...new Set(graphs.flatMap((g) => g.unresolved))], missing: r.missing }
}
