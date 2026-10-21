/**
 * Repositories attached to the project, plus the read-only git lookups the UI uses: the
 * repositories the connected accounts can see (autocomplete), a repository's branches
 * (`git ls-remote`, no clone) and its top-level folders (a blob-less, no-checkout clone into a
 * temp dir that is removed again). Private repositories work when the host has a connected
 * account (git.ts). Same store as the Python module it replaces:
 * ~/.config/runpod-pod-manager/repositories.json (REPOSITORIES_FILE overrides).
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CoreError, bad } from './errors.js'
import * as git from './git.js'
import { repositoriesFile } from './paths.js'

export interface Repository { id: string; url: string; branch: string; name: string; host: string; attached_at: number }
export interface Branches { default: string; branches: string[] }
/** Runs git with the given arguments and returns stdout; injected by the tests. */
export type GitRunner = (args: string[], secret: string | null, timeoutMs: number) => Promise<string>

const GIT_URL_RE = /^(https?:\/\/|ssh:\/\/|git@)[\w.@:/~+-]+$/
const GIT_REF_RE = /^[\w./-]+$/

// ----- the store -----

export function load(): Repository[] {
  const f = repositoriesFile()
  if (!existsSync(f)) return []
  const text = readFileSync(f, 'utf8')
  return text.trim() ? (JSON.parse(text) as Repository[]) : []
}

export function save(repositories: Repository[]): void {
  const f = repositoriesFile()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(repositories, null, 2))
}

// ----- git -----

export function check(url: string, branch?: string | null): void {
  if (!GIT_URL_RE.test(url)) throw bad('Not a git repository URL')
  if (branch != null && !GIT_REF_RE.test(branch)) throw bad('Not a valid branch name')
}

/** Run git non-interactively; a failure comes back as 400 with git's last line, any token redacted (git echoes the clone URL). */
export const runGit: GitRunner = (args, secret, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout)
      const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
      if (e.killed || e.signal === 'SIGTERM') return reject(new CoreError(504, 'git timed out contacting the repository'))
      if (e.code === 'ENOENT') return reject(new CoreError(500, 'git is not installed or not on PATH'))
      let reason = (stderr || 'git failed').trim().split('\n').pop() || 'git failed'
      if (secret) reason = reason.split(secret).join('***')
      reject(bad(reason))
    })
  })

export const normalize = (url: string) => url.trim().replace(/\/+$/, '').replace(/\.git$/, '')

/** 'https://github.com/org/repo' and 'git@github.com:org/repo.git' both name 'org/repo'. */
export function repoName(url: string): string {
  const path = url.includes('://') ? new URL(url).pathname : url.split(':').slice(1).join(':')
  return normalize(path).replace(/^\/+|\/+$/g, '')
}

/** The host as the Python's urlparse gave it: what sits between '://' and the first '/', user and port included. */
export const hostOf = (url: string) => (url.includes('://') ? url.split('://')[1].split('/')[0] : url.split('@').pop()!.split(':')[0])

/** `git ls-remote --symref <url> HEAD refs/heads/*` output: the default branch first, then the rest alphabetically. */
export function parseLsRemote(out: string): Branches {
  let def: string | null = null
  const branches: string[] = []
  for (const line of out.split('\n')) {
    const i = line.indexOf('\t')
    if (i < 0) continue
    const left = line.slice(0, i), ref = line.slice(i + 1)
    if (left.startsWith('ref: refs/heads/') && ref === 'HEAD') def = left.slice('ref: refs/heads/'.length)
    else if (ref.startsWith('refs/heads/')) branches.push(ref.slice('refs/heads/'.length))
  }
  branches.sort((a, b) => Number(a !== def) - Number(b !== def) || a.toLowerCase().localeCompare(b.toLowerCase()))
  return { default: def || branches[0] || 'main', branches }
}

export async function branchesOf(url: string, run: GitRunner = runGit): Promise<Branches> {
  const { url: cloneUrl, secret } = await git.authenticatedUrl(url)
  return parseLsRemote(await run(['ls-remote', '--symref', '--', cloneUrl, 'HEAD', 'refs/heads/*'], secret, 30_000))
}

// ----- what the page calls -----

export const list = () => ({ repositories: load() })

/** Attach {url, branch}; the branch defaults to the repository's HEAD. Attaching the same pair twice returns the existing entry. */
export async function add(rawUrl: string, branch?: string | null, run: GitRunner = runGit): Promise<Repository> {
  const url = normalize(rawUrl || '')
  check(url, branch)
  const b = branch || (await branchesOf(url, run)).default
  const repositories = load()
  const existing = repositories.find((r) => r.url === url && r.branch === b)
  if (existing) return existing
  const repo: Repository = { id: randomUUID().replace(/-/g, ''), url, branch: b, name: repoName(url), host: hostOf(url), attached_at: Date.now() / 1000 }
  save([...repositories, repo])
  return repo
}

export function remove(id: string): void {
  const repositories = load()
  const remaining = repositories.filter((r) => r.id !== id)
  if (remaining.length === repositories.length) throw new CoreError(404, 'Repository not found')
  save(remaining)
}

/** Repositories visible to every connected account, merged, for the attach autocomplete. One expired account does not break the others. */
export async function search(q = '', fetchFn: typeof fetch = fetch) {
  const repos: (git.Repo & { account: string; provider: string })[] = []
  const seen = new Set<string>()
  for (const account of git.listAccounts().accounts) {
    let found: git.Repo[]
    try { found = (await git.listRepos(account.id, q, fetchFn)).repos } catch { continue }
    for (const repo of found) {
      if (seen.has(repo.url)) continue
      seen.add(repo.url)
      repos.push({ ...repo, account: account.username, provider: account.provider })
    }
  }
  return { repos: repos.slice(0, 50) }
}

export async function branches(rawUrl: string, run: GitRunner = runGit): Promise<Branches> {
  const url = normalize(rawUrl || '')
  check(url)
  return branchesOf(url, run)
}

/** Top-level folders of a repository: the node packs you can pick out of a monorepo. */
export async function folders(rawUrl: string, branch = 'main', run: GitRunner = runGit) {
  const url = normalize(rawUrl || '')
  check(url, branch)
  const { url: cloneUrl, secret } = await git.authenticatedUrl(url)
  const tmp = mkdtempSync(join(tmpdir(), 'repo-folders-'))
  try {
    await run(['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', '--branch', branch, '--', cloneUrl, tmp], secret, 60_000)
    const tree = await run(['-C', tmp, 'ls-tree', '-d', '--name-only', 'HEAD'], secret, 30_000)
    const out = tree.split('\n').filter((f) => f && !f.startsWith('.')).sort()
    return { url, branch, folders: out }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
