// ADR-058: the page's mirror of libs/core/src/eyeroles.ts (a core test keeps the table and answers equal). Each DPX sequence in the Outputs gallery fills one of four slots (Overall, Left Eye, Right Eye, Side By Side); empty ones show "Not rendered yet".
export const EYE_ORDER = ['overall', 'left', 'right', 'sbs']
export const EYE_TOKENS = { left: ['LEFT', 'L', 'LE'], right: ['RIGHT', 'R', 'RE'], overall: ['OVERALL', 'STEREO', 'PACK', 'COMBINED'], sbs: ['SBS', 'SIDEBYSIDE', 'LR'] }
const SPLIT = /[._\-\s/\\]+/
const ALL = Object.values(EYE_TOKENS).flat()
export function eyeRoleOf(name) {
  const toks = String(name || '').toUpperCase().split(SPLIT)
  for (const role of ['sbs', 'overall', 'left', 'right']) if (toks.some((t) => EYE_TOKENS[role].includes(t))) return role
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
/** The tiles with each sequence (a DPX tile of more than one frame) tagged with its role, and every element's missing slots added as `eyeslot` placeholders, in Overall, Left Eye, Right Eye, Side By Side order where the element's first sequence sits. */
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
    // row one: the four slots (a picture, or the Not Generated placeholder); the filled sequences follow as full-width rows (their tile, data file, previews and buttons)
    const filled = []
    const sub = k.split('\u0000')[0], mainKey = els.get(k)[0].key
    out.push({ key: `eyehead:video:${k}`, kind: 'eyehead', head: 'video' })
    for (const role of EYE_ORDER) {
      const have = els.get(k).filter((x) => x.eye === role)
      if (have.length) { out.push({ key: `eyecard:${k}:${role}`, kind: 'eyecard', eye: role, sub: k.split('\u0000')[0], slot: have[0], mainKey, stem: k.split('\u0000')[1] }); filled.push(...have) }
      else out.push({ key: `eyeslot:${k}:${role}`, kind: 'eyeslot', eye: role, mainKey, sub: k.split('\u0000')[0], stem: k.split('\u0000')[1] })
    }
    out.push({ key: `eyehead:dpx:${k}`, kind: 'eyehead', head: 'dpx' })
    // row two: the DPX frame previews, four columns. One filled slot (a mono delivery): its frames 1, 5, 10 and 15 fill the four columns. Several filled slots (stereo): one column per slot, the first frame each.
    const filledRoles = EYE_ORDER.filter((role) => els.get(k).some((x) => x.eye === role))
    if (filledRoles.length === 1) out.push({ key: `eyeframe:${k}:${filledRoles[0]}`, kind: 'eyeframe', eye: filledRoles[0], slot: els.get(k).filter((x) => x.eye === filledRoles[0])[0], stem: k.split('\u0000')[1], span: true })
    else for (const role of EYE_ORDER) out.push({ key: `eyeframe:${k}:${role}`, kind: 'eyeframe', eye: role, slot: (els.get(k).filter((x) => x.eye === role))[0] || null, stem: k.split('\u0000')[1], compact: true })
    for (const f of filled) out.push({ key: `eyehead:all:${f.key}`, kind: 'eyehead', head: 'all', name: f.name || f.file.filename }, f)
  }
  return out
}

/** A name's element stem for matching a video to a slot: the role token, the frame pattern and the extension dropped, lower case (`clip_v008_R.mp4` and `clip_v008_R.####.dpx` both give `clip_v008`). */
export const slotStemOf = (name) => eyeStemOf(String(name || '')).replace(/\.(?:#+|\d+)\.dpx$/i, '').replace(/\.[a-z0-9]{2,5}$/i, '').toLowerCase()
