/**
 * Removing what a push leaves out, from the volume (docs/ADR-011, "Removing what was left out"). NEVER rsync `--delete-excluded`: it implies `--delete` and would remove every file on the volume that is not in the
 * local tree (the renders and outputs the pods made). This is a TARGETED, GUARDED removal instead, only when asked for (`delete_excluded`), and only of what the exclude patterns match on the volume:
 *  1. candidates are listed on the REMOTE side per step (SSH: one bounded `find`; S3: a bounded level-by-level listing) and matched here, in TypeScript, with the SAME pattern semantics as the exclude (`matchExclude`);
 *     no pattern text ever reaches a shell;
 *  2. guards: strictly inside the step's remote root (never the root, never `..`, never a symlink or a path that resolves outside it), never `.journal`, the shots' render folders are not removed on their own,
 *     at most 50,000 matches and at most 20 matches among the root's direct children per pattern ("that pattern is too broad");
 *  3. one `rm -rf --one-file-system -- <abs path>` (or one `aws s3 rm`) per matched TOP folder, sequential, abortable, 30 minutes each, quoted, never a glob.
 * Everything async; the candidate loops yield every 500 items; the effects go through `Exec`, so the tests use fakes.
 */
import { CoreError, bad } from './errors.js'
import * as changes from './changes.js'
import * as sync from './sync.js'

export const MAX_MATCHES = 50_000, MAX_BROAD = 20, FIND_DEPTH = 5, FIND_LINES = 500_000, REMOVE_MS = 30 * 60_000, DU_MS = 60_000, S3_DEPTH = 4, S3_CALLS = 400
export const RENDER_DIRS = ['05_TEMPS', '06_REVIEW', '07_DELIVER']
export const NEEDS_YES = 'Deleting from the volume needs the name of who says yes'
const yieldLoop = () => new Promise<void>((r) => setImmediate(r))

export type Exec = (cmd: string[], onLine: (text: string) => void, signal: AbortSignal, env?: NodeJS.ProcessEnv) => Promise<number>
/** How to reach the volume's files: over SSH (the pod's host and port) or over S3 (the volume, its datacenter and key prefix of each step's root). */
export interface Target { kind: 'ssh' | 's3'; host?: string; port?: number; volume?: { id: string; datacenter: string }; env?: NodeJS.ProcessEnv }
export interface Root { key: string; /** the step's remote root as the pod sees it, `/workspace/project/` */ remote: string }
export interface Match { step: string; /** relative to the step's root */ path: string; abs: string; dir: boolean; pattern: string; bytes: number | null; files: number | null }

const q = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`
const sshBase = (t: Target) => ['ssh', '-p', String(t.port), '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', t.host!]
const rx = (g: string) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*') + '$')

/** The exclude semantics, as rsync has them, for a path relative to the step's root: `X/` folders only, a leading `/` or a slash inside anchors to the root, otherwise the name matches at any depth; `*`, `?`, `**` wildcards. */
export function matchExclude(pattern: string, rel: string, isDir: boolean): boolean {
  const dirOnly = pattern.endsWith('/'); if (dirOnly && !isDir) return false
  const name = pattern.replace(/^\//, '').replace(/\/$/, ''); if (!name) return false
  const anchored = pattern.startsWith('/') || name.includes('/')
  return rx(name).test(anchored ? rel : rel.split('/').pop() ?? '')
}

/** The matched entries that are not inside another matched folder (what gets removed, whole). Sorted by path. */
export async function topMatches(entries: { rel: string; dir: boolean }[], patterns: string[]): Promise<{ rel: string; dir: boolean; pattern: string }[]> {
  const sorted = [...entries].sort((a, b) => a.rel.split('/').length - b.rel.split('/').length || a.rel.localeCompare(b.rel))
  const taken = new Set<string>(), out: { rel: string; dir: boolean; pattern: string }[] = []
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i], parts = e.rel.split('/')
    if (parts.some((_p, k) => k < parts.length - 1 && taken.has(parts.slice(0, k + 1).join('/')))) { /* inside a matched folder */ } else {
      const p = patterns.find((pt) => matchExclude(pt, e.rel, e.dir))
      if (p) { out.push({ ...e, pattern: p }); if (e.dir) taken.add(e.rel) }
    }
    if (i % 500 === 499) await yieldLoop()
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

/** Why a candidate must NOT be removed, or null. The path is relative to the step's root. */
export function refusal(rel: string, pattern: string): string | null {
  if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.includes('\n') || rel.includes('\u0000')) return 'not a path inside the step'
  const parts = rel.split('/')
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return 'not a path inside the step'
  if (parts.includes('.journal')) return 'the change journal is never removed'
  const name = parts[parts.length - 1]
  if (RENDER_DIRS.includes(name) && pattern.replace(/^\//, '').replace(/\/$/, '').split('/').pop() !== name) return `${name} (a shot's renders) is only removed when a pattern names it`
  return null
}

/** The whole candidate check for one step: guards, then the broadness caps. Throws "that pattern is too broad: <n> folders" or the 50,000 cap. */
export function checkMatches(step: string, root: string, tops: { rel: string; dir: boolean; pattern: string }[]): Match[] {
  if (tops.length > MAX_MATCHES) throw bad(`Too many matches (${tops.length}) in ${step}: at most ${MAX_MATCHES}; narrow the patterns`)
  const byPattern = new Map<string, number>()
  for (const t of tops) if (!t.rel.includes('/')) byPattern.set(t.pattern, (byPattern.get(t.pattern) ?? 0) + 1)
  for (const [p, n] of byPattern) if (n > MAX_BROAD) throw bad(`That pattern is too broad: ${n} folders directly in ${step} match ${p}`)
  const rootNorm = root.replace(/\/+$/, '')
  const out: Match[] = []
  for (const t of tops) if (!refusal(t.rel, t.pattern)) out.push({ step, path: t.rel, abs: `${rootNorm}/${t.rel}`, dir: t.dir, pattern: t.pattern, bytes: null, files: null })
  return out
}

// ----- listing the candidates -----

/** SSH: one bounded `find` under the step's root; `%y` is the type (symlinks are skipped, never followed), `%P` the path below the root. Nothing from a pattern is in the command. */
export async function listSsh(exec: Exec, t: Target, rootAbs: string, signal: AbortSignal): Promise<{ rel: string; dir: boolean }[]> {
  const lines: string[] = [], root = rootAbs.replace(/\/+$/, '')
  const code = await exec([...sshBase(t), `find ${q(root)} -mindepth 1 -maxdepth ${FIND_DEPTH} -printf '%y %P\\n' 2>/dev/null | head -n ${FIND_LINES}`], (l) => lines.push(l), signal, process.env)
  if (code !== 0 && !lines.length) throw bad(`Could not list ${root} on the pod`)
  const out: { rel: string; dir: boolean }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^([a-z]) (.+)$/.exec(lines[i]); if (m && (m[1] === 'd' || m[1] === 'f')) out.push({ rel: m[2], dir: m[1] === 'd' })
    if (i % 500 === 499) await yieldLoop()
  }
  return out
}
/** S3: a bounded level-by-level listing by prefix (a folder is a key ending in a slash). */
export type ListLevel = (prefix: string) => Promise<{ key: string; bytes: number }[]>
export const defaultListLevel = (volumeId: string): ListLevel => async (prefix) => (await changes.listRows(volumeId, prefix.replace(/\/$/, ''), false)).map((r) => ({ key: r.key, bytes: r.bytes }))
export async function listS3(list: ListLevel, bucketRoot: string): Promise<{ rel: string; dir: boolean }[]> {
  const out: { rel: string; dir: boolean }[] = [], root = bucketRoot.replace(/\/+$/, '') + '/'
  let level = [root], calls = 0
  for (let d = 0; d < S3_DEPTH && level.length; d++) {
    const next: string[] = []
    for (const prefix of level) {
      if (++calls > S3_CALLS) throw bad(`Too many folders to look through under ${root}`)
      for (const r of await list(prefix)) { const rel = r.key.slice(root.length).replace(/\/$/, ''); if (!rel) continue; const dir = r.key.endsWith('/'); out.push({ rel, dir }); if (dir) next.push(r.key) }
      await yieldLoop()
    }
    level = next
  }
  return out
}

/** Tests give fakes for the two S3 listings (one level of a prefix; everything under a prefix). */
let s3Fakes: { list?: ListLevel; listAll?: ListLevel } | null = null
export const setS3 = (f: { list?: ListLevel; listAll?: ListLevel } | null) => { s3Fakes = f }

/** What a push with `delete_excluded` would remove, per step. Sizes are filled in by `measure`. */
export async function resolve(o: { exec: Exec; target: Target; roots: Root[]; /** one list for every step, or each step's own */ patterns: string[] | ((stepKey: string) => string[]); signal: AbortSignal; mountPath: string; list?: ListLevel }): Promise<Match[]> {
  const all: Match[] = []
  for (const r of o.roots) {
    const patterns = typeof o.patterns === 'function' ? o.patterns(r.key) : o.patterns
    if (!patterns.length) continue
    const entries = o.target.kind === 'ssh' ? await listSsh(o.exec, o.target, r.remote, o.signal) : await listS3(o.list ?? s3Fakes?.list ?? defaultListLevel(o.target.volume!.id), s3Prefix(r.remote, o.mountPath))
    all.push(...checkMatches(r.key, r.remote, await topMatches(entries, patterns)))
  }
  return all
}
const s3Prefix = (remote: string, mountPath: string) => sync.s3Key(remote, mountPath)

/** How big each match is: `du -sk` and a file count over SSH (60 s each), or the S3 listing summed. null when it cannot be told. Never throws. */
export async function measure(o: { exec: Exec; target: Target; matches: Match[]; signal: AbortSignal; mountPath: string; listAll?: ListLevel }): Promise<Match[]> {
  const out: Match[] = []
  for (const m of o.matches) {
    let bytes: number | null = null, files: number | null = null
    try {
      if (o.target.kind === 'ssh') {
        const ac = new AbortController(), t = setTimeout(() => ac.abort(), DU_MS), lines: string[] = []
        o.signal.addEventListener('abort', () => ac.abort(), { once: true })
        try { await o.exec([...sshBase(o.target), `du -sk -- ${q(m.abs)} 2>/dev/null | cut -f1; find ${q(m.abs)} -xdev -type f 2>/dev/null | wc -l`], (l) => lines.push(l.trim()), ac.signal, process.env) } finally { clearTimeout(t) }
        const kb = Number(lines[0]), n = Number(lines[1]); if (/^\d+$/.test(lines[0] ?? '')) bytes = kb * 1024; if (/^\d+$/.test(lines[1] ?? '')) files = n
      } else {
        const prefix = sync.s3Key(m.abs, o.mountPath), rows = s3Fakes?.listAll ? await s3Fakes.listAll(prefix) : await changes.listRows(o.target.volume!.id, prefix, true)
        bytes = rows.reduce((a, r) => a + r.bytes, 0); files = rows.filter((r) => !r.key.endsWith('/')).length
      }
    } catch { /* unknown */ }
    out.push({ ...m, bytes, files })
  }
  return out
}

// ----- removing -----

/** The ONE command that removes one matched top folder over SSH: the real path is resolved on the pod and must lie strictly inside the real root (a symlink out is refused), then `rm -rf --one-file-system -- "<resolved>"`. Quoted, no glob. */
export function removeCmdSsh(t: Target, rootAbs: string, abs: string): string[] {
  const root = rootAbs.replace(/\/+$/, '')
  return [...sshBase(t), [`r=$(readlink -f -- ${q(root)}) || exit 4`, `p=${q(abs)}`, `[ -L "$p" ] && { echo "REFUSED: $p is a symlink"; exit 3; }`, `x=$(readlink -f -- "$p") || exit 4`, `case "$x" in "$r"/?*) rm -rf --one-file-system -- "$x" ;; *) echo "REFUSED: $x is outside $r"; exit 3 ;; esac`].join('; ')]
}
/** Over S3: `aws s3 rm` of one matched prefix (recursive) or key. */
export function removeCmdS3(t: Target, bucketKey: string, dir: boolean): string[] {
  return ['aws', 's3', 'rm', `s3://${t.volume!.id}/${bucketKey}`, ...(dir ? ['--recursive'] : []), '--endpoint-url', sync.s3Endpoint(t.volume!.datacenter), '--region', t.volume!.datacenter]
}
/** Remove one match; throws with the reason. */
export async function removeOne(o: { exec: Exec; target: Target; root: Root; match: Match; signal: AbortSignal; mountPath: string }): Promise<void> {
  const why = refusal(o.match.path, o.match.pattern); if (why) throw bad(`Refused: ${why}`)
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), REMOVE_MS), lines: string[] = []
  const onAbort = () => ac.abort(); if (o.signal.aborted) ac.abort(); else o.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const cmd = o.target.kind === 'ssh' ? removeCmdSsh(o.target, o.root.remote, o.match.abs) : removeCmdS3(o.target, sync.s3Key(o.match.abs, o.mountPath), o.match.dir)
    const code = await o.exec(cmd, (l) => lines.push(l), ac.signal, o.target.env ?? process.env)
    if (ac.signal.aborted) throw new CoreError(499, 'cancelled or took too long (30 minutes)')
    if (code !== 0) throw new Error(lines.find((l) => /REFUSED/.test(l)) ?? lines.at(-1) ?? `exit ${code}`)
  } finally { clearTimeout(t); o.signal.removeEventListener('abort', onAbort) }
}
