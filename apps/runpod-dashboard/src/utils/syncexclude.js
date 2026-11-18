/** Sync: leave out (v1.5.0): the patterns a push never sends, rsync's rules relative to each step's root. Pure helpers; `npm run dpx:test`. */
export const MAX_PATTERNS = 100, MAX_LENGTH = 200
/** Why a pattern is refused (the core's rules), or '': trimmed, not empty, at most 200 characters, no `..`, NUL, newline or leading `~`. */
export function excludeProblem(p) {
  const s = String(p ?? '').trim()
  if (!s) return 'excludeEmpty'
  if (s.length > MAX_LENGTH) return 'excludeLong'
  // eslint-disable-next-line no-control-regex
  if (s.includes('..') || /[\u0000\n\r]/.test(s) || s.startsWith('~')) return 'excludeBad'
  return ''
}
/** One pattern per line (a textarea): trimmed, blanks dropped, duplicates once. */
export const parsePatterns = (text) => [...new Set(String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean))]
/** The first problem in a list: { pattern, problem } or null; too many patterns is a problem too. */
export function listProblem(list) {
  for (const p of list || []) { const problem = excludeProblem(p); if (problem) return { pattern: p, problem } }
  if ((list || []).length > MAX_PATTERNS) return { pattern: '', problem: 'excludeMany' }
  return null
}
/** What ticking a top-level folder leaves out: that folder at the root of a step, folders only. */
export const folderPattern = (name) => `/${name}/`
export const isCanalV2 = (name) => String(name).toLowerCase() === 'canalv2'
