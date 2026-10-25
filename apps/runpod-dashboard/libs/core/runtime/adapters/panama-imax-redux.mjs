// Built-in adapter: Kyle's delivery packages from panama-imax-redux (scripts/panama-gen/build-brynley-comfy-delivery.py),
// the format the package's own 01_PATHS_FOR_SETUP.md describes (docs/DELIVERY-PACKAGES.md, docs/IMPORT-ADAPTERS.md):
//   <shot>/comfy/input/...      -> input/...                 (shots/<shot>/... kept; never renamed or flattened)
//   <shot>/comfy/workflows/...  -> workflows/panama-imax-redux/<round>/...   (the _api and inputs-manifest files stay beside the graph)
//   <shot>/nodes/<pack>-vN/...  -> node-packs/panama-imax-redux/<pack>/...   (staged, -vN dropped)
// Workflows and packs live under this project's own folder. Inputs cannot: the graphs load them by the path
// shots/<shot>/... relative to ComfyUI's input folder, which must not change (the shot id is their namespace).
//   final/, approved/, provenance/, docs, templates          left where they are, counted
// A copy carries the sha256 from the shot's MANIFEST.json; the app refuses a file whose bytes differ.
// Works on a merged package or on one of the Drive parts (a part holds only some of each shot's files).

const PACK_VERSION = /-v\d+(\.\d+)*$/
// The round's name is the package folder's, without the " 2" Google Drive adds to a duplicate: parts of one round share a folder.
const roundOf = (ctx) => ctx.roundName.replace(/ \d+$/, '')
const PROJECT = 'panama-imax-redux'   // the folder this project's workflows and staged packs go under

export default {
  id: 'panama-imax-redux',
  name: 'Panama Canal v2 delivery package',
  version: 1,

  async detect(root, ctx) {
    const evidence = []
    if (await ctx.exists('MANIFEST.json')) {
      try { const m = await ctx.json('MANIFEST.json'); if (m && m.shots && m.for) evidence.push('MANIFEST.json (shots, for)') } catch { /* not ours */ }
    }
    for (const d of (await ctx.list('.')).filter((e) => e.isDir)) {
      // a shot folder: its manifest and comfy/, or (a Drive part that came without the manifest) comfy/input, comfy/workflows or nodes/
      if (await ctx.exists(`${d.name}/MANIFEST.json`) && (await ctx.stat(`${d.name}/comfy`))?.isDir) evidence.push(`${d.name}/MANIFEST.json + comfy/`)
      else if ((await ctx.stat(`${d.name}/comfy/input`))?.isDir || (await ctx.stat(`${d.name}/comfy/workflows`))?.isDir || (await ctx.stat(`${d.name}/nodes`))?.isDir) evidence.push(`${d.name}/comfy or nodes (no manifest in this folder)`)
    }
    return { match: evidence.length ? 1 : (await ctx.exists('00_READ_ME.md')) ? 0.3 : 0, evidence: evidence.slice(0, 6) }
  },

  async plan(root, ctx) {
    const ops = [], findings = []
    const shots = (await ctx.list('.')).filter((e) => e.isDir && !e.name.startsWith('.'))
    let top = null
    if (await ctx.exists('MANIFEST.json')) { try { top = await ctx.json('MANIFEST.json') } catch { findings.push({ level: 'warn', text: 'MANIFEST.json (top level) could not be read', path: 'MANIFEST.json' }) } }
    else findings.push({ level: 'info', text: 'no top-level MANIFEST.json: this looks like one part of the package' })
    if (top?.environment_on_kyles_machine?.comfyui_version) findings.push({ level: 'info', text: `built on ComfyUI ${top.environment_on_kyles_machine.comfyui_version} (commit ${top.environment_on_kyles_machine.comfyui_commit || '?'}): the version floor` })

    const packsStaged = new Set()
    const nodeClasses = new Set()
    let shotsSeen = 0

    for (const s of shots) {
      const shot = s.name
      const hasComfy = (await ctx.stat(`${shot}/comfy`))?.isDir, hasNodes = (await ctx.stat(`${shot}/nodes`))?.isDir
      const manifestPath = `${shot}/MANIFEST.json`
      const hasManifest = await ctx.exists(manifestPath)
      if (!hasComfy && !hasNodes && !hasManifest) continue
      shotsSeen++
      const onDisk = new Map()   // path -> bytes, for what could be imported
      for (const d of [`${shot}/comfy`, `${shot}/nodes`]) for (const f of await ctx.list(d, { recursive: true })) if (f.name !== '.DS_Store') onDisk.set(f.path, f.bytes)

      let entries = null
      if (hasManifest) {
        try { const m = await ctx.json(manifestPath); entries = m.files || []; for (const c of m.node_types || []) nodeClasses.add(typeof c === 'string' ? c : c.type) }
        catch { findings.push({ level: 'warn', text: `${manifestPath} could not be read; copying without hashes`, path: manifestPath }) }
      } else findings.push({ level: 'warn', text: `${shot}: no MANIFEST.json, so no hashes to check`, path: shot })

      const listed = new Set(), left = {}
      let missing = 0
      const place = (path) => {
        let m
        if ((m = path.match(new RegExp(`^${shot}/comfy/input/(.+)$`)))) return { kind: 'input', to: `input/${m[1]}` }
        if ((m = path.match(new RegExp(`^${shot}/comfy/workflows/(.+)$`)))) return { kind: 'workflow', to: `workflows/${PROJECT}/${roundOf(ctx)}/${m[1]}` }
        if ((m = path.match(new RegExp(`^${shot}/nodes/([^/]+)/(.+)$`)))) { const pack = m[1].replace(PACK_VERSION, ''); packsStaged.add(pack); return { kind: 'node-pack', to: `node-packs/${PROJECT}/${pack}/${m[2]}` } }
        return null
      }
      for (const e of entries || []) {
        const p = e.path
        const dest = place(p)
        if (!dest) { const top2 = p.split('/').slice(1, 2)[0] || '.'; left[top2] = (left[top2] || 0) + 1; continue }
        listed.add(p)
        if (!onDisk.has(p)) { missing++; continue }
        ops.push({ op: 'copy', kind: dest.kind, from: p, to: dest.to, bytes: e.bytes ?? onDisk.get(p), sha256: e.sha256 })
      }
      if (!entries) for (const [p, bytes] of onDisk) { const dest = place(p); if (dest) ops.push({ op: 'copy', kind: dest.kind, from: p, to: dest.to, bytes }) }
      const unlisted = entries ? [...onDisk.keys()].filter((p) => !listed.has(p)) : []
      if (missing) findings.push({ level: 'info', text: `${shot}: ${missing} files in the manifest are not in this folder (another part of the package?)` })
      if (unlisted.length) findings.push({ level: 'warn', text: `${shot}: ${unlisted.length} files under comfy/ or nodes/ are not in its manifest and are not imported`, path: unlisted[0] })
      for (const [dir, n] of Object.entries(left)) ops.push({ op: 'note', kind: 'reference', from: `${shot}/${dir}`, note: `${shot}/${dir}: ${n} files left in place` })
      if (hasComfy && !(entries || []).some((e) => /\/comfy\/workflows\//.test(e.path)) && !onDisk.size) findings.push({ level: 'warn', text: `${shot}: no workflows found` })
    }
    if (!shotsSeen) findings.push({ level: 'problem', text: 'no shot folders (<shot>/comfy, <shot>/nodes or <shot>/MANIFEST.json) found: not a delivery package, or the wrong folder' })

    // What the graphs need that this import does not bring.
    const classes = [...nodeClasses]
    const fal = classes.filter((c) => c.startsWith('FalAPI_'))
    if (fal.length && ![...packsStaged].some((p) => /fal/i.test(p))) findings.push({ level: 'warn', text: `${fal.length} FalAPI_* node types are used and no fal pack came with this folder: the graphs open with missing-node warnings`, path: 'nodes' })
    if (classes.some((c) => c.startsWith('OpenAI'))) findings.push({ level: 'info', text: 'OpenAI partner-API nodes are used; they are bypassed in the HISTORY graphs and need a provider key to run' })
    if (top?.node_types && !Array.isArray(top.node_types)) {
      const need = [...new Set(Object.values(top.node_types).filter((v) => v !== 'core'))]
      const lacking = need.filter((n) => ![...packsStaged].some((p) => n.toLowerCase().startsWith(p.toLowerCase().replace(/-?v?\d.*$/, '')) || p.toLowerCase().includes(n.toLowerCase().replace(/-v\d.*$/, ''))))
      if (need.length) findings.push({ level: lacking.length ? 'warn' : 'info', text: `non-core node packs the graphs use: ${need.join(', ')}${lacking.length ? `; not staged by this folder: ${lacking.join(', ')}` : ''}` })
    }
    if (packsStaged.size) findings.push({ level: 'info', text: `node packs staged under node-packs/${PROJECT}/: ${[...packsStaged].join(', ')} (the image links packs from its own sources; staging does not install them)` })
    return { ops, findings }
  },
}
