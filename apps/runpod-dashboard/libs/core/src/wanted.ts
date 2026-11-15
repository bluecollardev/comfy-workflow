/**
 * The wanted-models list (ADR-042 section 12): the names of the model files a user wants on a Shared volume, as Hugging Face coordinates
 * (repo, path, revision), the folder of models/ each goes to, and the size. Not the weights, and tied to no volume, account or datacenter:
 * it travels in the configuration file and can be loaded onto a Shared volume anywhere. Pure: no stored state here (wantedmodels.ts keeps it).
 */
import { bad } from './errors.js'
import * as hf from './hf.js'

export interface WantedModel {
  /** the folder of models/ (with at most one sub-folder), e.g. diffusion_models or loras/ltx2 */
  folder: string
  /** the file name on the volume */
  name: string
  /** Hugging Face owner/name; '' when only the name is known (a file recorded from a volume, not yet matched to its repo) */
  repo: string
  /** the file's path in the repo; '' with no repo */
  path: string
  revision?: string
  bytes: number
  sha256?: string
  note?: string
}
export const MAX_WANTED = 500
const NAME = /^[\w.+\- ]{1,200}$/

/** One entry checked and cleaned, or the reason it is refused. */
export function check(raw: unknown): WantedModel {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!r) throw bad('A wanted model must be an object {folder, name, repo, path, bytes}.')
  const folder = String(r.folder ?? '').trim().replace(/\/+$/, '')
  if (!hf.isFolder(folder)) throw bad(`Not a models folder: ${folder || '(none)'} (one of ${hf.FOLDERS.join(', ')}, with at most one sub-folder).`)
  const repo = String(r.repo ?? '').trim(), path = String(r.path ?? '').trim()
  let name = String(r.name ?? '').trim()
  if (repo) { hf.assertRepo(repo); hf.safePath(path); name = path.split('/').pop()! } else if (path) throw bad('A path needs its repo.')
  if (!NAME.test(name)) throw bad(`Unsafe file name: ${name || '(none)'}`)
  const bytes = Number(r.bytes ?? 0)
  if (!Number.isFinite(bytes) || bytes < 0) throw bad(`Not a size: ${String(r.bytes)}`)
  const out: WantedModel = { folder, name, repo, path: repo ? path : '', bytes: Math.round(bytes) }
  if (r.revision !== undefined && r.revision !== null && String(r.revision).trim() && String(r.revision) !== 'main') out.revision = hf.assertRevision(String(r.revision).trim())
  if (r.sha256 !== undefined && r.sha256 !== null && String(r.sha256)) { if (!/^[0-9a-f]{64}$/.test(String(r.sha256))) throw bad('sha256 must be 64 hex characters.'); out.sha256 = String(r.sha256) }
  if (r.note !== undefined && r.note !== null && String(r.note).trim()) out.note = String(r.note).trim().slice(0, 300)
  return out
}
/** What identifies an entry: where it comes from and where it goes (a file with no repo: its name and folder). */
export const keyOf = (e: WantedModel) => `${e.repo}|${e.repo ? e.path : e.name}|${e.folder}`

/** A stored list read leniently: an entry that does not pass is dropped, a repeat is merged, never more than MAX_WANTED. */
export function normalizeList(raw: unknown): WantedModel[] {
  if (!Array.isArray(raw)) return []
  const out = new Map<string, WantedModel>()
  for (const x of raw) { try { const e = check(x); out.set(keyOf(e), e) } catch { /* dropped */ } if (out.size >= MAX_WANTED) break }
  return [...out.values()]
}
/** The list as the file carries it, or why it is refused (strict: an import says what is wrong). */
export function checkList(raw: unknown): string | null {
  if (!Array.isArray(raw)) return 'wanted_models must be a list of entries'
  if (raw.length > MAX_WANTED) return `wanted_models holds at most ${MAX_WANTED} entries`
  for (const x of raw) { try { check(x) } catch (e) { return (e as Error).message } }
  return null
}
/** have + incoming, by key: an incoming entry replaces the one with its key, the others stay. */
export function merge(have: WantedModel[], incoming: WantedModel[]): WantedModel[] {
  const m = new Map(have.map((e) => [keyOf(e), e]))
  for (const e of incoming) m.set(keyOf(e), e)
  return [...m.values()].slice(0, MAX_WANTED)
}

/** Binc's pull list (MODELS_PULL_v003.csv: pipeline,install_to,file,hf_repo,hf_path,bytes,notes) as wanted entries, and the rows that cannot be: no repo, or a destination outside models/. */
export function fromCsv(text: string): { entries: WantedModel[]; skipped: { file: string; why: string }[] } {
  const rows = parseCsv(String(text ?? ''))
  const head = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? []
  const col = (n: string) => head.indexOf(n)
  const [iP, iT, iF, iR, iH, iB, iN] = ['pipeline', 'install_to', 'file', 'hf_repo', 'hf_path', 'bytes', 'notes'].map(col)
  if ([iT, iF, iR, iH].some((i) => i < 0)) throw bad('Not a pull list: the header needs install_to, file, hf_repo and hf_path.')
  const entries: WantedModel[] = [], skipped: { file: string; why: string }[] = []
  for (const r of rows) {
    if (r.every((c) => !c.trim())) continue
    const file = (r[iF] ?? '').trim()
    try {
      const folder = (r[iT] ?? '').trim().replace(/\/+$/, '')
      if (!hf.isFolder(folder)) throw bad(`destination ${folder || '(none)'} is not a models folder`)
      if (!(r[iR] ?? '').trim() || !(r[iH] ?? '').trim()) throw bad('no Hugging Face repo and path')
      const pipeline = iP >= 0 ? (r[iP] ?? '').trim() : ''
      const note = [pipeline, iN >= 0 ? (r[iN] ?? '').trim() : ''].filter(Boolean).join(': ')
      entries.push(check({ folder, repo: r[iR], path: r[iH], bytes: iB >= 0 ? r[iB] : 0, note }))
    } catch (e) { skipped.push({ file: file || '(no name)', why: (e as Error).message }) }
  }
  return { entries, skipped }
}
function parseCsv(s: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; rows.push(row); row = [] }
    else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}
