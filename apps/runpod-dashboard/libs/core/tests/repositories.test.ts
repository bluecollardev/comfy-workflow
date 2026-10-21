import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as git from '../src/git.js'
import * as repos from '../src/repositories.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); delete process.env.REPOSITORIES_FILE; delete process.env.GIT_ACCOUNTS_FILE })

const LS_REMOTE = [
  'ref: refs/heads/develop\tHEAD',
  '0123abcd\tHEAD',
  '1111\trefs/heads/master',
  '2222\trefs/heads/develop',
  '3333\trefs/heads/feature/Zeta',
  '4444\trefs/heads/feature/alpha',
  '',
].join('\n')

/** A git that answers from a script and records what it was asked. */
function fakeGit(answer: (args: string[]) => string) {
  const calls: { args: string[]; secret: string | null; timeoutMs: number }[] = []
  const run: repos.GitRunner = async (args, secret, timeoutMs) => { calls.push({ args, secret, timeoutMs }); return answer(args) }
  return { run, calls }
}

describe('the repository store', () => {
  it('round-trips the file the Python wrote and moves with REPOSITORIES_FILE', () => {
    const file = join(dir, 'repositories.json')
    const fromPython = [{ id: 'abc', url: 'https://github.com/me/comfy-nodes', branch: 'main', name: 'me/comfy-nodes', host: 'github.com', attached_at: 1760000000.25 }]
    writeFileSync(file, JSON.stringify(fromPython, null, 2))
    expect(repos.list()).toEqual({ repositories: fromPython })
    repos.remove('abc')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([])
    expect(() => repos.remove('abc')).toThrow(/Repository not found/)
    process.env.REPOSITORIES_FILE = join(dir, 'x', 'r.json')
    expect(repos.list().repositories).toEqual([])
    repos.save(fromPython)
    expect(existsSync(process.env.REPOSITORIES_FILE)).toBe(true)
  })
})

describe('branches', () => {
  it('parses ls-remote output: the default branch first, then the rest case-insensitively', () => {
    expect(repos.parseLsRemote(LS_REMOTE)).toEqual({ default: 'develop', branches: ['develop', 'feature/alpha', 'feature/Zeta', 'master'] })
    expect(repos.parseLsRemote('1\trefs/heads/b\n2\trefs/heads/a\n')).toEqual({ default: 'a', branches: ['a', 'b'] })   // no symref: the first branch
    expect(repos.parseLsRemote('')).toEqual({ default: 'main', branches: [] })
  })

  it('asks git ls-remote with the account token embedded, and checks the URL first', async () => {
    git.save([{ id: 'a', provider: 'github', host: 'github.com', username: 'u', name: null, avatar_url: null, profile_url: null, scope: '', token: 'tok', refresh_token: null, expires_at: null, connected_at: 0 }])
    const { run, calls } = fakeGit(() => LS_REMOTE)
    expect(await repos.branches('https://github.com/me/comfy-nodes.git/', run)).toMatchObject({ default: 'develop' })
    expect(calls[0]).toEqual({ args: ['ls-remote', '--symref', '--', 'https://x-access-token:tok@github.com/me/comfy-nodes', 'HEAD', 'refs/heads/*'], secret: 'tok', timeoutMs: 30_000 })
    await expect(repos.branches('not a url', run)).rejects.toThrow(/Not a git repository URL/)
    await expect(repos.branches('https://github.com/x/y; rm -rf /', run)).rejects.toThrow(/Not a git repository URL/)
  })
})

describe('attaching', () => {
  it('normalizes the URL, resolves the default branch, names and hosts the repo, and does not attach twice', async () => {
    const { run, calls } = fakeGit(() => LS_REMOTE)
    const r = await repos.add('https://github.com/me/comfy-nodes.git', null, run)
    expect(r).toMatchObject({ url: 'https://github.com/me/comfy-nodes', branch: 'develop', name: 'me/comfy-nodes', host: 'github.com' })
    expect(r.id).toMatch(/^[0-9a-f]{32}$/)
    expect(calls.length).toBe(1)
    expect(await repos.add('https://github.com/me/comfy-nodes/', 'develop', run)).toEqual(r)   // same pair: the existing entry, no git call
    expect(calls.length).toBe(1)
    const other = await repos.add('git@gitlab.com:grp/sub/pack.git', 'v2', run)
    expect(other).toMatchObject({ url: 'git@gitlab.com:grp/sub/pack', branch: 'v2', name: 'grp/sub/pack', host: 'gitlab.com' })
    expect(repos.list().repositories.map((x) => x.id)).toEqual([r.id, other.id])
    await expect(repos.add('https://github.com/me/x', 'bad branch', run)).rejects.toThrow(/Not a valid branch name/)
  })
})

describe('search', () => {
  it('merges what every account sees, tags each with the account, dedupes by URL, and skips a failing account', async () => {
    git.save([
      { id: 'gh', provider: 'github', host: 'github.com', username: 'lucas', name: null, avatar_url: null, profile_url: null, scope: '', token: 't1', refresh_token: null, expires_at: null, connected_at: 0 },
      { id: 'gl', provider: 'gitlab', host: 'gitlab.com', username: 'lucas.g', name: null, avatar_url: null, profile_url: null, scope: '', token: 't2', refresh_token: null, expires_at: null, connected_at: 0 },
      { id: 'dead', provider: 'github', host: 'github.com', username: 'old', name: null, avatar_url: null, profile_url: null, scope: '', token: 'expired', refresh_token: null, expires_at: null, connected_at: 0 },
    ])
    const fetchFn = (async (url: string, init: { headers: Record<string, string> }) => {
      if (init.headers.Authorization === 'Bearer expired') return { ok: false, status: 401, json: async () => ({}) }
      const body = url.includes('api.github.com')
        ? [{ full_name: 'me/pack', html_url: 'https://github.com/me/pack', default_branch: 'main', private: false }, { full_name: 'me/pack', html_url: 'https://github.com/me/pack' }]
        : [{ path_with_namespace: 'g/pack', web_url: 'https://gitlab.com/g/pack', visibility: 'private' }]
      return { ok: true, status: 200, json: async () => body }
    }) as unknown as typeof fetch
    const { repos: found } = await repos.search('pack', fetchFn)
    expect(found).toEqual([
      { name: 'me/pack', url: 'https://github.com/me/pack', default_branch: 'main', private: false, description: null, account: 'lucas', provider: 'github' },
      { name: 'g/pack', url: 'https://gitlab.com/g/pack', default_branch: 'main', private: true, description: null, account: 'lucas.g', provider: 'gitlab' },
    ])
    const down = (async () => { throw new Error('network down') }) as unknown as typeof fetch
    expect((await repos.search('x', down)).repos).toEqual([])   // no reachable account: nothing, no error
  })
})

describe('folders', () => {
  it('clones shallow without blobs or checkout into a temp dir, lists the top-level folders, and removes the dir', async () => {
    const { run, calls } = fakeGit((args) => (args[0] === 'clone' ? '' : 'packs\n.github\nzeta\nalpha\n\n'))
    const r = await repos.folders('https://github.com/me/comfy-nodes', 'dev', run)
    expect(r).toEqual({ url: 'https://github.com/me/comfy-nodes', branch: 'dev', folders: ['alpha', 'packs', 'zeta'] })
    const clone = calls[0].args
    expect(clone.slice(0, 9)).toEqual(['clone', '--depth', '1', '--filter=blob:none', '--no-checkout', '--branch', 'dev', '--', 'https://github.com/me/comfy-nodes'])
    const tmp = clone[9]
    expect(tmp).toContain('repo-folders-')
    expect(calls[0].timeoutMs).toBe(60_000)
    expect(calls[1].args).toEqual(['-C', tmp, 'ls-tree', '-d', '--name-only', 'HEAD'])
    expect(existsSync(tmp)).toBe(false)
    await expect(repos.folders('https://github.com/me/x', 'ok', async () => { throw new Error('fatal: Remote branch ok not found') })).rejects.toThrow(/Remote branch ok not found/)
  })

  it('runs the real git for a bad URL and reports its last line as a 400', async () => {
    await expect(repos.branches('https://127.0.0.1:1/nothing/here')).rejects.toMatchObject({ status: 400 })
  }, 30_000)
})
