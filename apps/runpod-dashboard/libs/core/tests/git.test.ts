import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as git from '../src/git.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => {
  dir = scratch()
  delete process.env.GIT_ACCOUNTS_FILE
  delete process.env.GITLAB_URL
  for (const k of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET']) delete process.env[k]
})

/** The file the Python wrote: a JSON array with these keys, token and refresh_token included. */
const pythonAccount = (over: Partial<git.Account> = {}): git.Account => ({
  id: 'a1b2', provider: 'github', host: 'github.com', username: 'lucas', name: 'Lucas', avatar_url: 'https://avatars.example/1', profile_url: 'https://github.com/lucas',
  scope: 'repo read:user', token: 'gho_secret', refresh_token: null, expires_at: null, connected_at: 1760000000.5, ...over,
})

/** A fetch that answers by URL and records every call. */
function fakeFetch(answer: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    const a = answer(String(url), init)
    const status = a.status ?? 200
    return { ok: status < 300, status, json: async () => a.body ?? {} }
  }) as unknown as typeof fetch
  return { fetchFn, calls }
}

describe('the account store', () => {
  it('reads the file the Python wrote, lists without secrets, and writes it back in the same shape', () => {
    const file = join(dir, 'git_accounts.json')
    writeFileSync(file, JSON.stringify([pythonAccount()], null, 2))
    const { accounts, providers } = git.listAccounts()
    expect(accounts).toEqual([{ id: 'a1b2', provider: 'github', host: 'github.com', username: 'lucas', name: 'Lucas', avatar_url: 'https://avatars.example/1', profile_url: 'https://github.com/lucas', scope: 'repo read:user', expires_at: null, connected_at: 1760000000.5 }])
    expect(JSON.stringify(accounts)).not.toContain('gho_secret')
    expect(providers.map((p) => p.id)).toEqual(['github', 'gitlab'])
    expect(providers[0]).toMatchObject({ label: 'GitHub', host: 'github.com', configured: false, redirect_uri: 'http://127.0.0.1:8781/callback' })
    expect(providers[1]).toMatchObject({ label: 'GitLab', host: 'gitlab.com', configured: false })

    git.save([...git.load(), pythonAccount({ id: 'c3', provider: 'gitlab', host: 'gitlab.com', username: 'lucas.g', token: 'glpat', refresh_token: 'r1', expires_at: 1760003600 })])
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([pythonAccount(), expect.objectContaining({ id: 'c3', token: 'glpat', refresh_token: 'r1' })])
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(git.get('c3').token).toBe('glpat')
    expect(() => git.get('nope')).toThrow(/Account not found/)
  })

  it('disconnects by id, 404 otherwise; GIT_ACCOUNTS_FILE moves the store; an empty file is no accounts', () => {
    process.env.GIT_ACCOUNTS_FILE = join(dir, 'elsewhere', 'accounts.json')
    expect(git.listAccounts().accounts).toEqual([])
    git.save([pythonAccount()])
    expect(existsSync(process.env.GIT_ACCOUNTS_FILE)).toBe(true)
    git.disconnect('a1b2')
    expect(git.load()).toEqual([])
    expect(() => git.disconnect('a1b2')).toThrow(/Account not found/)
    writeFileSync(process.env.GIT_ACCOUNTS_FILE, '')
    expect(git.load()).toEqual([])
  })

  it('says which providers are configured from the same env names the Python read, GITLAB_URL included', () => {
    process.env.GITHUB_CLIENT_ID = 'id'; process.env.GITHUB_CLIENT_SECRET = 'sec'
    process.env.GITLAB_URL = 'https://git.example.org/'
    const { providers } = git.listAccounts()
    expect(providers[0].configured).toBe(true)
    expect(providers[1]).toMatchObject({ configured: false, host: 'git.example.org' })
    expect(git.provider('gitlab').api).toBe('https://git.example.org/api/v4')
    expect(() => git.provider('bitbucket')).toThrow(/Unknown provider/)
  })
})

describe("an account's repositories", () => {
  it('pages GitHub three times at most, maps the fields and filters by q', async () => {
    git.save([pythonAccount()])
    const page = (n: number, count: number) => Array.from({ length: count }, (_, i) => ({ full_name: `org/repo-${n}-${i}`, html_url: `https://github.com/org/repo-${n}-${i}`, default_branch: i % 2 ? 'main' : null, private: i % 3 === 0, description: i ? null : 'first' }))
    const { fetchFn, calls } = fakeFetch((url) => ({ body: url.includes('&page=1&') ? page(1, 100) : page(2, 7) }))
    const { repos } = await git.listRepos('a1b2', '', fetchFn)
    expect(calls.length).toBe(2)   // the short second page ends the paging
    expect(calls[0].url).toContain('https://api.github.com/user/repos?per_page=100&page=1&sort=pushed&affiliation=')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer gho_secret')
    expect((calls[0].init.headers as Record<string, string>).Accept).toBe('application/vnd.github+json')
    expect(repos.length).toBe(107)
    expect(repos[0]).toEqual({ name: 'org/repo-1-0', url: 'https://github.com/org/repo-1-0', default_branch: 'main', private: true, description: 'first' })
    const filtered = await git.listRepos('a1b2', 'REPO-2-', fetchFn)
    expect(filtered.repos.length).toBe(7)
  })

  it('asks GitLab once with the search and maps visibility to private', async () => {
    git.save([pythonAccount({ id: 'g', provider: 'gitlab', host: 'gitlab.com', token: 'glpat' })])
    const { fetchFn, calls } = fakeFetch(() => ({ body: [{ path_with_namespace: 'grp/x', web_url: 'https://gitlab.com/grp/x', default_branch: 'dev', visibility: 'public', description: 'd' }, { path_with_namespace: 'grp/y', web_url: 'https://gitlab.com/grp/y', visibility: 'private' }] }))
    const { repos } = await git.listRepos('g', 'x', fetchFn)
    expect(calls[0].url).toBe('https://gitlab.com/api/v4/projects?membership=true&simple=true&per_page=100&order_by=last_activity_at&search=x')
    expect(repos).toEqual([
      { name: 'grp/x', url: 'https://gitlab.com/grp/x', default_branch: 'dev', private: false, description: 'd' },
      { name: 'grp/y', url: 'https://gitlab.com/grp/y', default_branch: 'main', private: true, description: null },
    ])
  })

  it("refreshes GitLab's token when it is about to expire and stores the new one", async () => {
    process.env.GITLAB_CLIENT_ID = 'cid'; process.env.GITLAB_CLIENT_SECRET = 'csec'
    git.save([pythonAccount({ id: 'g', provider: 'gitlab', host: 'gitlab.com', token: 'old', refresh_token: 'r1', expires_at: Date.now() / 1000 - 10 })])
    const { fetchFn, calls } = fakeFetch((url) => (url.endsWith('/oauth/token') ? { body: { access_token: 'new', refresh_token: 'r2', expires_in: 7200 } } : { body: [] }))
    await git.listRepos('g', '', fetchFn)
    expect(calls[0].url).toBe('https://gitlab.com/oauth/token')
    expect(String(calls[0].init.body)).toContain('grant_type=refresh_token&refresh_token=r1')
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer new')
    expect(git.get('g')).toMatchObject({ token: 'new', refresh_token: 'r2' })
    expect(git.get('g').expires_at).toBeGreaterThan(Date.now() / 1000 + 7000)
    // a refused refresh is a 401 that says to reconnect
    git.save([pythonAccount({ id: 'g', provider: 'gitlab', host: 'gitlab.com', token: 'old', refresh_token: 'r1', expires_at: 1 })])
    await expect(git.listRepos('g', '', fakeFetch(() => ({ status: 400 })).fetchFn)).rejects.toThrow(/session expired/)
  })
})

describe('credentials for a pod', () => {
  it('embeds the token in a clone URL for a connected host and leaves others alone', async () => {
    git.save([pythonAccount(), pythonAccount({ id: 'g', provider: 'gitlab', host: 'gitlab.com', username: 'lg', token: 'glpat' })])
    expect(await git.authenticatedUrl('https://github.com/org/repo')).toEqual({ url: 'https://x-access-token:gho_secret@github.com/org/repo', secret: 'gho_secret' })
    expect(await git.authenticatedUrl('https://gitlab.com/g/r.git')).toEqual({ url: 'https://oauth2:glpat@gitlab.com/g/r.git', secret: 'glpat' })
    expect(await git.authenticatedUrl('https://codeberg.org/x/y')).toEqual({ url: 'https://codeberg.org/x/y', secret: null })
    expect(await git.authenticatedUrl('git@github.com:org/repo.git')).toEqual({ url: 'git@github.com:org/repo.git', secret: null })
    expect(await git.credentialsFor(['https://github.com/a/b', 'https://github.com/c/d', 'https://codeberg.org/x/y', 'https://gitlab.com/g/r'])).toEqual({
      'github.com': { username: 'x-access-token', token: 'gho_secret' }, 'gitlab.com': { username: 'oauth2', token: 'glpat' },
    })
    expect(await git.credentialsEnv(['https://codeberg.org/x/y'])).toEqual({})
    expect(JSON.parse((await git.credentialsEnv(['https://github.com/a/b'])).GIT_CREDENTIALS)).toEqual({ 'github.com': { username: 'x-access-token', token: 'gho_secret' } })
  })
})

describe('connecting an account over the loopback', () => {
  it('needs the OAuth app in the environment, named by its env vars', async () => {
    await expect(git.startConnect('github')).rejects.toThrow(/GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET/)
    process.env.GITLAB_CLIENT_ID = 'x'
    await expect(git.startConnect('gitlab')).rejects.toThrow(/GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET/)
    await expect(git.startConnect('bitbucket')).rejects.toThrow(/Unknown provider/)
  })

  it('builds the authorize URL, exchanges the code the browser brings back, and stores the account', async () => {
    process.env.GITHUB_CLIENT_ID = 'cid'; process.env.GITHUB_CLIENT_SECRET = 'csec'
    git.save([pythonAccount({ username: 'lucas', token: 'stale' })])   // reconnecting the same user replaces the entry
    const { fetchFn, calls } = fakeFetch((url) =>
      url === 'https://github.com/login/oauth/access_token' ? { body: { access_token: 'gho_fresh', scope: 'repo,read:user', token_type: 'bearer' } }
      : url === 'https://api.github.com/user' ? { body: { login: 'lucas', name: 'Lucas G', avatar_url: 'https://a/1', html_url: 'https://github.com/lucas' } }
      : { status: 500 })
    const c = await git.startConnect('github', { fetchFn, port: 0 })
    const u = new URL(c.url)
    expect(`${u.origin}${u.pathname}`).toBe('https://github.com/login/oauth/authorize')
    expect(u.searchParams.get('client_id')).toBe('cid')
    expect(u.searchParams.get('scope')).toBe('repo read:user')
    expect(u.searchParams.get('redirect_uri')).toBe(c.redirect_uri)
    expect(c.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(u.searchParams.get('state')).toBe(c.state)

    expect((await fetch(`${c.redirect_uri.replace('/callback', '/other')}`)).status).toBe(404)
    const r = await fetch(`${c.redirect_uri}?code=thecode&state=${c.state}`)
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('Connected as <b>lucas</b>')
    const account = await c.done
    expect(account).toMatchObject({ provider: 'github', host: 'github.com', username: 'lucas', name: 'Lucas G', avatar_url: 'https://a/1', profile_url: 'https://github.com/lucas', scope: 'repo,read:user', expires_at: null })
    expect(account).not.toHaveProperty('token')

    expect(calls[0].url).toBe('https://github.com/login/oauth/access_token')
    expect(calls[0].init.method).toBe('POST')
    expect(String(calls[0].init.body)).toBe(`client_id=cid&client_secret=csec&code=thecode&redirect_uri=${encodeURIComponent(c.redirect_uri)}`)
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer gho_fresh')

    const stored = git.load()
    expect(stored.length).toBe(1)
    expect(stored[0]).toMatchObject({ id: account.id, token: 'gho_fresh', refresh_token: null, username: 'lucas' })
    expect(stored[0].connected_at).toBeGreaterThan(1_700_000_000)
    // the listener is gone once the login is done
    await expect(fetch(`${c.redirect_uri}?code=again&state=${c.state}`)).rejects.toThrow()
  })

  it('GitLab asks for a code, exchanges with the grant type, and keeps the refresh token and expiry', async () => {
    process.env.GITLAB_CLIENT_ID = 'cid'; process.env.GITLAB_CLIENT_SECRET = 'csec'
    const { fetchFn, calls } = fakeFetch((url) =>
      url === 'https://gitlab.com/oauth/token' ? { body: { access_token: 'gl1', refresh_token: 'glr', expires_in: 7200 } }
      : { body: { username: 'lucas.g', name: null, avatar_url: null, web_url: 'https://gitlab.com/lucas.g' } })
    const c = await git.startConnect('gitlab', { fetchFn, port: 0 })
    expect(new URL(c.url).searchParams.get('response_type')).toBe('code')
    await fetch(`${c.redirect_uri}?code=k&state=${c.state}`)
    const account = await c.done
    expect(String(calls[0].init.body)).toContain('grant_type=authorization_code')
    expect(account).toMatchObject({ provider: 'gitlab', host: 'gitlab.com', username: 'lucas.g', scope: 'read_user read_api read_repository' })
    expect(git.get(account.id)).toMatchObject({ token: 'gl1', refresh_token: 'glr' })
    expect(git.get(account.id).expires_at).toBeGreaterThan(Date.now() / 1000 + 7000)
  })

  it('refuses a wrong state, a provider error and a failed exchange, and stores nothing', async () => {
    process.env.GITHUB_CLIENT_ID = 'cid'; process.env.GITHUB_CLIENT_SECRET = 'csec'
    const { fetchFn } = fakeFetch(() => ({ body: { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' } }))
    let c = await git.startConnect('github', { fetchFn, port: 0 })
    let r = await fetch(`${c.redirect_uri}?code=k&state=wrong`)
    expect(r.status).toBe(400); expect(await r.text()).toContain('tampered')
    await expect(c.done).rejects.toThrow(/expired or was tampered/)

    c = await git.startConnect('github', { fetchFn, port: 0 })
    r = await fetch(`${c.redirect_uri}?error=access_denied&error_description=The+user+said+no&state=${c.state}`)
    expect(r.status).toBe(400)
    await expect(c.done).rejects.toThrow(/The user said no/)

    c = await git.startConnect('github', { fetchFn, port: 0 })
    r = await fetch(`${c.redirect_uri}?code=k&state=${c.state}`)
    expect(r.status).toBe(400)
    await expect(c.done).rejects.toThrow(/code passed is incorrect/)
    expect(git.load()).toEqual([])
  })

  it('times out, and a new login cancels the one before it', async () => {
    process.env.GITHUB_CLIENT_ID = 'cid'; process.env.GITHUB_CLIENT_SECRET = 'csec'
    const first = await git.startConnect('github', { port: 0, timeoutMs: 20 })
    await expect(first.done).rejects.toThrow(/timed out/)
    const second = await git.startConnect('github', { port: 0 })
    const third = await git.startConnect('github', { port: 0 })
    await expect(second.done).rejects.toThrow(/cancelled/)
    third.cancel()
    await expect(third.done).rejects.toThrow(/cancelled/)
  })
})
