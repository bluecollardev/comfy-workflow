// The package as a list of files and folders, and what an adapter does with each (docs/ADR-009, decision 9).

/** Flat rows for a tree given as entries in walk order (a folder, then its children): depth, label, and what the caller adds. Rows under a collapsed folder are left out. */
export function treeRows(entries, collapsed = new Set(), decorate = () => ({})) {
  const rows = []
  for (const e of entries) {
    const parts = e.path.split('/')
    let hidden = false
    for (let i = 1; i < parts.length; i++) if (collapsed.has(parts.slice(0, i).join('/'))) { hidden = true; break }
    if (hidden) continue
    rows.push({ ...e, depth: parts.length - 1, label: parts[parts.length - 1], open: e.dir ? !collapsed.has(e.path) : undefined, ...decorate(e) })
  }
  return rows
}

/** What the plan does with every entry of the package: `copy` (with where), `left` (a note op names it or a folder above it), or `unmatched`.
 *  A folder carries the counts of its files, so a gap in a mapping shows as a folder with unmatched files. */
export function annotate(entries, ops = []) {
  const copies = new Map()
  const notes = []
  for (const o of ops) {
    if ((o.op === 'copy' || o.op === 'link') && o.from) { const l = copies.get(o.from) || []; l.push(o.to); copies.set(o.from, l) }
    if (o.op === 'note' && o.from) notes.push(o.from)
  }
  const left = (p) => notes.some((n) => p === n || p.startsWith(`${n}/`))
  const status = new Map()
  for (const e of entries) if (!e.dir) status.set(e.path, copies.has(e.path) ? 'copy' : left(e.path) ? 'left' : 'unmatched')
  const counts = new Map()
  for (const [path, s] of status) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/')
      const c = counts.get(d) || { copy: 0, left: 0, unmatched: 0 }
      c[s]++
      counts.set(d, c)
    }
  }
  return (e) => (e.dir ? { counts: counts.get(e.path) || { copy: 0, left: 0, unmatched: 0 } } : { status: status.get(e.path), to: copies.get(e.path) })
}

/** The destination tree the copy and link ops would make under ComfyUI-Shared: folders first, files with their sizes. */
export function destEntries(ops = []) {
  const files = new Map()
  for (const o of ops) if ((o.op === 'copy' || o.op === 'link' || o.op === 'placeholder') && o.to) files.set(o.to, o.bytes || 0)
  const dirs = new Set()
  for (const p of files.keys()) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')) }
  const all = [...[...dirs].map((p) => ({ path: p, dir: true, bytes: 0 })), ...[...files].map(([p, b]) => ({ path: p, dir: false, bytes: b }))]
  const byParent = (a, b) => {
    const pa = a.path.split('/'), pb = b.path.split('/')
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      if (pa[i] === pb[i]) continue
      const aDir = a.dir || i < pa.length - 1, bDir = b.dir || i < pb.length - 1
      if (aDir !== bDir) return aDir ? -1 : 1
      return pa[i] < pb[i] ? -1 : 1
    }
    return pa.length - pb.length
  }
  const sorted = all.sort(byParent)
  const counts = new Map()
  for (const p of files.keys()) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); counts.set(d, (counts.get(d) || 0) + 1) } }
  return sorted.map((e) => (e.dir ? { ...e, files: counts.get(e.path) || 0 } : e))
}

export const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`)
