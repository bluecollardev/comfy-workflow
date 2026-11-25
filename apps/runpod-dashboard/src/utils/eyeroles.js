// ADR-058: the page's mirror of libs/core/src/eyeroles.ts (a core test keeps the table and answers equal). Each DPX sequence in the Outputs gallery fills one of three slots (Overall, Left Eye, Right Eye); empty ones show "Not rendered yet".
export const EYE_ORDER = ['overall', 'left', 'right']
export const EYE_TOKENS = { left: ['LEFT', 'L', 'LE'], right: ['RIGHT', 'R', 'RE'], overall: ['OVERALL', 'STEREO', 'SBS', 'PACK'] }
const SPLIT = /[._\-\s/\\]+/
const ALL = Object.values(EYE_TOKENS).flat()
export function eyeRoleOf(name) {
  const toks = String(name || '').toUpperCase().split(SPLIT)
  for (const role of ['overall', 'left', 'right']) if (toks.some((t) => EYE_TOKENS[role].includes(t))) return role
  return 'left'
}
export function eyeStemOf(name) {
  const parts = String(name || '').split(/([._\-\s]+)/)
  const out = []
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0 && ALL.includes(parts[i].toUpperCase())) { out.pop(); continue }
    out.push(parts[i])
  }
  return out.join('')
}
/** The tiles with each sequence (a DPX tile of more than one frame) tagged with its role, and every element's missing slots added as `eyeslot` placeholders, in Overall, Left Eye, Right Eye order where the element's first sequence sits. */
export function withEyeSlots(tiles) {
  const isSeq = (t) => t.kind === 'dpx' && t.frames?.length > 1
  const elOf = (t) => `${t.file.subfolder || ''}\u0000${eyeStemOf(t.name || t.file.filename)}`
  const els = new Map()
  for (const t of tiles) if (isSeq(t)) {
    t.eye = eyeRoleOf(t.name || t.file.filename)
    const k = elOf(t)
    if (!els.has(k)) els.set(k, [])
    els.get(k).push(t)
  }
  const out = [], done = new Set()
  for (const t of tiles) {
    if (!isSeq(t)) { out.push(t); continue }
    const k = elOf(t)
    if (done.has(k)) continue
    done.add(k)
    for (const role of EYE_ORDER) {
      const have = els.get(k).filter((x) => x.eye === role)
      if (have.length) out.push(...have)
      else out.push({ key: `eyeslot:${k}:${role}`, kind: 'eyeslot', eye: role, stem: k.split('\u0000')[1] })
    }
  }
  return out
}
