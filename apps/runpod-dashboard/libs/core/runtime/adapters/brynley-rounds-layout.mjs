/**
 * Brynley's rounds, where they already sit: a round of per-shot graphs that lives on a network volume under
 * comfy-shared/workflows/<round>/ (proxy_v004e, proxy_v004f, proxy_v004g, proxy_v005, ...). This is the ROUND adapter of
 * ADR-044: it does not copy anything (brynley-rounds does that for rounds that arrive from elsewhere); it reads a LISTING
 * of the round and says what the round is, so Import Round can offer its shots and run them in place.
 *
 * What it does: describe(listing, ctx) takes the files of ONE round as [{path, bytes}] (paths relative to the round folder,
 *   e.g. archival-080/archival-080__a__proxy_v005.json) and returns { kind, round, shots[], variants[], graphs[], locked[],
 *   findings[] }. It reads no file and no folder: the listing is all it gets (no network, no writes, same fence as plan).
 *
 * Detects: a listing whose first level folders are shots (archival-080, cgi-042, enhance-141, carter-reframe, ...) holding
 *   graphs named <shot>__<variant>__<round>.json (variant a to e, or main). The folder detect/plan of the adapter contract are
 *   present but never match a folder on this PC: use brynley-rounds to import a round folder.
 *
 * Maps: <shot>/<shot>__<variant>__<round>.json -> the graph path the pod's Workflows panel shows, <round>/<shot>/<same name>
 *   (relative to workflows/). Graph .json files only; *_api.json twins and *-inputs-manifest.json are not graphs and are
 *   left out; anything that is not .json is ignored.
 *
 * Leaves in place: everything. Nothing is renamed, moved, overwritten or deleted, and nothing is written.
 *
 * Needs / assumes: names follow <shot>__<variant>__<round>.json; a graph that does not is listed under its shot with a warning.
 *   LOCKED: the shot cgi-042 (client-approved, Binc's rules) and any shot with a graph under a 04_GRAPH folder (approved graphs
 *   are locked there) are returned in locked[], their graphs flagged locked: they are listed for reference and never run.
 *
 * Limits: the locked list is a constant here plus the 04_GRAPH rule; Binc's record is the tracker's locked column, which
 *   is not on the volume, so a shot he locks later is not known to this file until it is added.
 */

const LOCKED_SHOTS = new Set(['cgi-042'])
const NAMED = /^(.+?)__(.+?)__(.+)\.json$/                            // <shot>__<variant>__<round>.json
const isGraph = (name) => /\.json$/i.test(name) && !/-inputs-manifest\.json$/i.test(name) && !/[-_]api\.json$/i.test(name)

export default {
  id: 'brynley-rounds-layout',
  name: "Brynley's rounds on a volume (<round>/<shot>/<shot>__<variant>__<round>.json), described in place",
  version: 1,
  kind: 'round',   // a round of per-shot graphs, read from a listing

  // The folder contract: this adapter describes listings, it never matches a folder (brynley-rounds copies those).
  async detect() { return { match: 0, evidence: [] } },
  async plan() { return { ops: [], findings: [{ level: 'info', text: 'brynley-rounds-layout describes a round already on a volume; to copy a round folder onto the volume use the brynley-rounds adapter.' }] } },

  async describe(listing, ctx) {
    const findings = []
    const round = ctx.roundName || ''
    const byShot = new Map()
    const variants = new Set()
    const graphs = []
    let ignored = 0
    for (const f of listing) {
      const parts = f.path.split('/').filter(Boolean)
      if (parts.length < 2) { if (isGraph(parts[0] || '')) findings.push({ level: 'info', text: `${f.path} sits beside the shot folders, not in one; ignored`, path: f.path }); else ignored++; continue }
      const shot = parts[0]
      const name = parts[parts.length - 1]
      if (!byShot.has(shot)) byShot.set(shot, { locked: LOCKED_SHOTS.has(shot.toLowerCase()), graphs: 0 })
      if (!isGraph(name)) { ignored++; continue }
      const inLocked = parts.slice(1, -1).some((p) => p.toUpperCase() === '04_GRAPH')
      const entry = byShot.get(shot)
      if (inLocked) entry.locked = true
      const m = NAMED.exec(name)
      let variant = ''
      if (m) {
        variant = m[2]
        if (m[1].toLowerCase() !== shot.toLowerCase()) findings.push({ level: 'warn', text: `${name} sits in ${shot}/ but names shot ${m[1]}`, path: f.path })
        if (round && m[3] !== round) findings.push({ level: 'warn', text: `${name} names round ${m[3]}, not ${round}`, path: f.path })
        variants.add(variant)
      } else findings.push({ level: 'warn', text: `${name} is not named <shot>__<variant>__<round>.json; listed under ${shot}/ as it is`, path: f.path })
      entry.graphs++
      graphs.push({ path: `${round ? round + '/' : ''}${f.path}`, shot, variant, bytes: f.bytes || 0, locked: false })
    }
    const locked = [...byShot.entries()].filter(([, v]) => v.locked).map(([k]) => k).sort()
    for (const g of graphs) g.locked = locked.includes(g.shot) || g.path.toUpperCase().split('/').includes('04_GRAPH')
    for (const s of locked) findings.push({ level: 'warn', text: `${s} is locked (client-approved, or its graphs sit under 04_GRAPH): listed for reference, never run`, path: s })
    for (const [s, v] of byShot) if (!v.graphs) findings.push({ level: 'info', text: `${s}/ holds no graph`, path: s })
    if (ignored) findings.push({ level: 'info', text: `${ignored} file(s) that are not graphs were ignored` })
    const shots = [...byShot.entries()].filter(([, v]) => v.graphs).map(([k]) => k).sort()
    findings.push({ level: 'info', text: `${round || 'round'}: ${shots.length} shot(s), ${graphs.length} graph(s), variants ${[...variants].sort().join(', ') || 'none'}` })
    graphs.sort((a, b) => (a.path < b.path ? -1 : 1))
    return { kind: 'round', round, shots, variants: [...variants].sort(), graphs, locked, findings }
  },
}
