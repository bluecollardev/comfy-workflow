/**
 * Brynley's rounds: a round folder of per-shot graphs, laid out the way the brynley-rounds volumes keep them
 * (e.g. brynley-rounds-eu-ro-1).
 *
 * What it does: reads a round folder (proxy_v005, proxy_v004g, ...) or a folder of several rounds, and plans
 * copying every graph into the ComfyUI-Shared workflows folder, one folder per round and one per shot, so the
 * Run workflows window lists them as it does for the rounds already on the volume.
 *
 * Detects: a folder whose sub-folders are shots (archival-071, cgi-042, enhance-141, photoreal-187,
 *   carter-reframe, stevens-river, ...) holding graphs named <shot>__<variant>__<round>.json
 *   (archival-077__a__proxy_v005.json, enhance-141__main__proxy_v005.json); or a folder of such rounds.
 *
 * Maps:
 *   <round>/<shot>/<shot>__<variant>__<round>.json            -> workflows/<round>/<shot>/<same name>
 *   <round>/<shot>/*_api.json, *-inputs-manifest.json, other graph .json beside them -> the same folder
 *   (the round is read from the file names; the source folder's own name is the fallback)
 *
 * Leaves in place: anything that is not a .json graph (images, videos, notes, scripts) is noted, not copied;
 *   a folder that is not a shot (canalv2 job trees, _scripts, library folders) is noted and skipped.
 *
 * Needs / assumes: names follow <shot>__<variant>__<round>.json. A graph that does not is still copied (under
 *   its shot folder) with a warning. Nothing is renamed, flattened or overwritten; models, inputs and node packs
 *   are not part of a round and are not touched.
 *
 * Limits: LOCKED_SHOTS (Binc's rules: client-approved shots are never edited or run by us) are copied for
 *   reference and flagged with a warning on every graph of theirs. The list is a constant below; the record
 *   of what is locked is the BH console, not this file. Read-only, plans only.
 */

const LOCKED_SHOTS = new Set(['cgi-042'])
const SHOT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d{2,4}[a-z]?$/i       // archival-071, cgi-042, enhance-146b, photoreal-187
const NAMED = /^(.+?)__(.+?)__(.+)\.json$/                            // <shot>__<variant>__<round>.json

// A shot folder: a shot-looking name (archival-071), or any folder holding <folder>__<variant>__<round>.json
// (carter-reframe, stevens-river have no number).
async function isShot(ctx, e) {
  if (SHOT.test(e.name)) return true
  if (e.name.startsWith('_') || e.name.startsWith('.')) return false
  return (await ctx.list(e.path)).some((f) => !f.isDir && f.name.toLowerCase().startsWith(`${e.name.toLowerCase()}__`) && NAMED.test(f.name))
}
async function shotFolders(ctx, dir) {
  const out = []
  for (const e of await ctx.list(dir || '.')) if (e.isDir && await isShot(ctx, e)) out.push(e)
  return out
}
async function graphsIn(ctx, dir) {
  return (await ctx.list(dir)).filter((e) => !e.isDir && /\.json$/i.test(e.name))
}
// A round: sub-folders that are shots, at least one holding a <shot>__<variant>__<round>.json.
async function roundScore(ctx, dir) {
  const shots = await shotFolders(ctx, dir)
  if (!shots.length) return { shots: 0, named: 0, sample: 0 }
  let named = 0, sample = 0
  for (const s of shots.slice(0, 8)) {
    sample++
    if ((await graphsIn(ctx, s.path)).some((g) => { const m = NAMED.exec(g.name); return m && m[1].toLowerCase() === s.name.toLowerCase() })) named++
  }
  return { shots: shots.length, named, sample }
}
async function findRounds(ctx) {
  const here = await roundScore(ctx, '')
  if (here.named) return [{ dir: '', score: here }]
  const out = []
  for (const d of (await ctx.list('.')).filter((e) => e.isDir)) {
    const sc = await roundScore(ctx, d.path)
    if (sc.named) out.push({ dir: d.path, name: d.name, score: sc })
  }
  return out
}

export default {
  id: 'brynley-rounds',
  name: "Brynley's rounds (<round>/<shot>/<shot>__<variant>__<round>.json)",
  version: 1,
  kind: 'round',   // a round of per-shot graphs

  async detect(root, ctx) {
    const rounds = await findRounds(ctx)
    if (!rounds.length) return { match: 0, evidence: [] }
    const ratio = Math.min(...rounds.map((r) => r.score.named / r.score.sample))
    return { match: Math.round((0.6 + 0.4 * ratio) * 100) / 100, evidence: rounds.slice(0, 6).map((r) => `${r.dir || ctx.roundName}: ${r.score.shots} shot folders, ${r.score.named}/${r.score.sample} sampled hold <shot>__<variant>__<round>.json`) }
  },

  async plan(root, ctx) {
    const ops = [], findings = []
    const rounds = await findRounds(ctx)
    if (!rounds.length) return { ops, findings: [{ level: 'problem', text: 'No round found: expected shot folders (archival-071, cgi-042, ...) holding <shot>__<variant>__<round>.json.' }] }
    const seen = new Set()
    let graphs = 0
    for (const r of rounds) {
      const roundDir = r.dir
      const fallbackRound = r.name || ctx.roundName
      const shots = await shotFolders(ctx, roundDir)
      // folders in the round that are not shots: left in place
      const shotNames = new Set(shots.map((x) => x.name))
      for (const e of (await ctx.list(roundDir || '.'))) {
        if (e.isDir && !shotNames.has(e.name)) ops.push({ op: 'note', kind: 'reference', from: e.path, note: 'not a shot folder; left in place' })
        else if (!e.isDir && roundDir === r.dir && /\.json$/i.test(e.name)) findings.push({ level: 'info', text: `${e.path} sits beside the shot folders, not in one; left in place`, path: e.path })
      }
      for (const s of shots) {
        const files = await ctx.list(s.path, { recursive: true })
        let roundName = fallbackRound
        for (const g of files) { const m = NAMED.exec(g.name); if (m && m[1].toLowerCase() === s.name.toLowerCase()) { roundName = m[3]; break } }
        for (const f of files) {
          if (f.isDir) continue
          if (!/\.json$/i.test(f.name)) { ops.push({ op: 'note', kind: 'reference', from: f.path, note: 'not a graph; left in place' }); continue }
          const rel = f.path.slice(s.path.length + 1)
          const to = `workflows/${roundName}/${s.name}/${rel}`
          if (seen.has(to)) { findings.push({ level: 'problem', text: `Two files map to ${to}; the second is skipped`, path: f.path }); continue }
          seen.add(to)
          const m = NAMED.exec(f.name)
          if (!m && !/(_api|-inputs-manifest)\.json$/i.test(f.name)) findings.push({ level: 'warn', text: `${f.name} is not named <shot>__<variant>__<round>.json; copied under ${s.name}/ as it is`, path: f.path })
          else if (m && m[1].toLowerCase() !== s.name.toLowerCase()) findings.push({ level: 'warn', text: `${f.name} sits in ${s.name}/ but names shot ${m[1]}`, path: f.path })
          ops.push({ op: 'copy', kind: 'workflow', from: f.path, to, bytes: f.bytes })
          graphs++
        }
        if (LOCKED_SHOTS.has(s.name.toLowerCase())) findings.push({ level: 'warn', text: `${s.name} is a locked / client-approved shot (Binc's rules): imported for reference, never edit or run it`, path: s.path })
      }
      findings.push({ level: 'info', text: `${roundDir || ctx.roundName}: round ${shots.length ? 'with ' + shots.length + ' shots' : 'is empty'}` })
    }
    findings.push({ level: 'info', text: `${graphs} graphs planned into workflows/<round>/<shot>/` })
    return { ops, findings }
  },
}
