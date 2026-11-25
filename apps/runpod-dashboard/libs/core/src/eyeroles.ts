// ADR-058: each sequence in an Outputs modal fills one of four slots (Overall, Left Eye, Right Eye, Side By Side). The role is read from the file or folder
// name as a whole token, from this one table (the page's mirror is src/utils/eyeroles.js; a core test keeps them equal). Display only.

export type EyeRole = 'overall' | 'left' | 'right' | 'sbs'
export const EYE_ORDER: EyeRole[] = ['overall', 'left', 'right', 'sbs']
/** The tokens (upper case, matched whole between `.` `_` `-` or spaces, any case) per role. Binc's right-eye naming is a guess until a real file exists. */
export const EYE_TOKENS: Record<EyeRole, string[]> = {
  left: ['LEFT', 'L', 'LE'],
  right: ['RIGHT', 'R', 'RE'],
  overall: ['OVERALL', 'STEREO', 'PACK', 'COMBINED'],
  sbs: ['SBS', 'SIDEBYSIDE', 'LR'],
}
const SPLIT = /[._\-\s/\\]+/
const ALL = Object.values(EYE_TOKENS).flat()

/** The role a name carries: side by side wins over overall, overall over left and right; a name with no token is the left eye (today's mono deliveries). */
export function eyeRoleOf(name: string): EyeRole {
  const toks = String(name || '').toUpperCase().split(SPLIT)
  for (const role of ['sbs', 'overall', 'left', 'right'] as EyeRole[]) if (toks.some((t) => EYE_TOKENS[role].includes(t))) return role
  return 'left'
}
/** The name without its role token (and the separator before it), so the three slots of one element share a stem. */
export function eyeStemOf(name: string): string {
  const parts = String(name || '').split(/([._\-\s]+)/)   // word, separator, word, ...
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0 && ALL.includes(parts[i].toUpperCase())) { out.pop(); continue }   // drop the token and the separator before it
    out.push(parts[i])
  }
  return out.join('')
}
