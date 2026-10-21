/**
 * Git provider accounts (GitHub / GitLab) connected with OAuth: the store, the repositories an
 * account can see, and the credential a pod gets for the hosts it clones from.
 *
 * Same store as the Python module it replaces (~/.config/runpod-pod-manager/git_accounts.json,
 * GIT_ACCOUNTS_FILE overrides, mode 600, one JSON array of accounts), so an existing file keeps
 * working. Same env for the OAuth apps: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET,
 * GITLAB_CLIENT_ID / GITLAB_CLIENT_SECRET, GITLAB_URL for a self-hosted GitLab.
 *
 * Connecting differs because there is no HTTP server any more: the core binds a one-shot
 * listener on the loopback (http://127.0.0.1:<GIT_OAUTH_PORT>/callback, default port 8781),
 * hands the shell the provider's authorize URL to open in the system browser, and the provider
 * sends the browser back to the listener, which exchanges the code for a token and stores the
 * account. Register the OAuth app with that callback URL.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname } from 'node:path'
import { CoreError, bad } from './errors.js'
import { gitAccountsFile } from './paths.js'

export interface Provider { label: string; base: string; authorize: string; token: string; api: string; scope: string; clone_user: string }
export interface Account {
  id: string; provider: string; host: string; username: string; name: string | null; avatar_url: string | null; profile_url: string | null
  scope: string; token: string; refresh_token: string | null; expires_at: number | null; connected_at: number
}
export type PublicAccount = Omit<Account, 'token' | 'refresh_token'>
export interface Repo { name: string; url: string; default_branch: string; private: boolean; description: string | null }

export const gitlabUrl = () => (process.env.GITLAB_URL || 'https://gitlab.com').replace(/\/+$/, '')

/** Read at call time, not import time, so GITLAB_URL set by the shell after start still counts. */
export function providers(): Record<string, Provider> {
  const gl = gitlabUrl()
  return {
    github: { label: 'GitHub', base: 'https://github.com', authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', api: 'https://api.github.com', scope: 'repo read:user', clone_user: 'x-access-token' },
    gitlab: { label: 'GitLab', base: gl, authorize: `${gl}/oauth/authorize`, token: `${gl}/oauth/token`, api: `${gl}/api/v4`, scope: 'read_user read_api read_repository', clone_user: 'oauth2' },
  }
}

export function provider(id: string): Provider {
  const p = providers()[id]
  if (!p) throw new CoreError(404, `Unknown provider '${id}'`)
  return p
}

const hostOf = (base: string) => new URL(base).host
const now = () => Date.now() / 1000   // the Python stored time.time(): seconds

// ----- the store -----

export function load(): Account[] {
  const f = gitAccountsFile()
  if (!existsSync(f)) return []
  const text = readFileSync(f, 'utf8')
  return text.trim() ? (JSON.parse(text) as Account[]) : []
}

export function save(accounts: Account[]): void {
  const f = gitAccountsFile()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(accounts, null, 2), { mode: 0o600 })
  chmodSync(f, 0o600)   // the mode option only applies when the file is created
}

export const publicOf = (a: Account): PublicAccount => { const { token: _t, refresh_token: _r, ...rest } = a; return rest }

export function get(id: string): Account {
  const a = load().find((x) => x.id === id)
  if (!a) throw new CoreError(404, 'Account not found')
  return a
}

// ----- the OAuth app per provider -----

export const clientEnvNames = (id: string) => ({ id: `${id.toUpperCase()}_CLIENT_ID`, secret: `${id.toUpperCase()}_CLIENT_SECRET` })
export const client = (id: string) => { const n = clientEnvNames(id); return { id: process.env[n.id] || '', secret: process.env[n.secret] || '' } }
export const callbackPort = () => Number(process.env.GIT_OAUTH_PORT || 8781)
export const redirectUri = (port: number) => `http://127.0.0.1:${port}/callback`

// ----- tokens -----

type Fetch = typeof fetch

async function fetchUser(id: string, token: string, fetchFn: Fetch) {
  const p = provider(id)
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (id === 'github') headers.Accept = 'application/vnd.github+json'
  const r = await fetchFn(`${p.api}/user`, { headers, signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new CoreError(502, `${p.label} answered ${r.status} for the profile`)
  const u = (await r.json()) as Record<string, string | null>
  return id === 'github'
    ? { username: u.login as string, name: u.name ?? null, avatar_url: u.avatar_url ?? null, profile_url: u.html_url ?? null }
    : { username: u.username as string, name: u.name ?? null, avatar_url: u.avatar_url ?? null, profile_url: u.web_url ?? null }
}

/** The current token; GitLab's short-lived one is refreshed when it is about to expire. */
export async function accessToken(account: Account, fetchFn: Fetch = fetch): Promise<string> {
  if (account.expires_at && account.expires_at < now() + 60 && account.refresh_token) {
    const p = provider(account.provider)
    const c = client(account.provider)
    const r = await fetchFn(p.token, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, grant_type: 'refresh_token', refresh_token: account.refresh_token, redirect_uri: redirectUri(callbackPort()) }).toString(),
      signal: AbortSignal.timeout(20_000),
    })
    if (!r.ok) throw new CoreError(401, `${p.label} session expired — reconnect the account`)
    const tok = (await r.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
    account.token = tok.access_token
    account.refresh_token = tok.refresh_token || account.refresh_token
    account.expires_at = now() + (tok.expires_in ?? 7200)
    save(load().map((a) => (a.id === account.id ? account : a)))
  }
  return account.token
}

export const accountForHost = (host: string): Account | undefined => load().find((a) => a.host === host)

/** The clone URL with the matching account's token embedded (and the token, to redact it from git's errors), or unchanged. */
export async function authenticatedUrl(url: string, fetchFn: Fetch = fetch): Promise<{ url: string; secret: string | null }> {
  if (!/^https?:\/\//.test(url)) return { url, secret: null }
  const host = url.split('://')[1].split('/')[0]
  const account = accountForHost(host)
  if (!account) return { url, secret: null }
  const token = await accessToken(account, fetchFn)
  return { url: url.replace('://', `://${provider(account.provider).clone_user}:${token}@`), secret: token }
}

/** {host: {username, token}} for every host in `urls` that has a connected account. */
export async function credentialsFor(urls: string[], fetchFn: Fetch = fetch): Promise<Record<string, { username: string; token: string }>> {
  const creds: Record<string, { username: string; token: string }> = {}
  for (const url of urls) {
    const host = url.includes('://') ? url.split('://')[1].split('/')[0] : ''
    if (!host || host in creds) continue
    const account = accountForHost(host)
    if (account) creds[host] = { username: provider(account.provider).clone_user, token: await accessToken(account, fetchFn) }
  }
  return creds
}

/** What pod creation adds: GIT_CREDENTIALS for the hosts the custom nodes clone from, nothing otherwise. */
export async function credentialsEnv(urls: string[], fetchFn: Fetch = fetch): Promise<Record<string, string>> {
  const creds = await credentialsFor(urls, fetchFn)
  return Object.keys(creds).length ? { GIT_CREDENTIALS: JSON.stringify(creds) } : {}
}

// ----- what the page calls -----

/** Connected accounts without their secrets, and which providers have an OAuth app configured. */
export function listAccounts(port = callbackPort()) {
  const provs = Object.entries(providers()).map(([id, p]) => {
    const c = client(id)
    return { id, label: p.label, host: hostOf(p.base), configured: !!(c.id && c.secret), redirect_uri: redirectUri(port) }
  })
  return { accounts: load().map(publicOf), providers: provs }
}

export function disconnect(id: string): void {
  const accounts = load()
  const remaining = accounts.filter((a) => a.id !== id)
  if (remaining.length === accounts.length) throw new CoreError(404, 'Account not found')
  save(remaining)
}

/** Repositories the account can see, newest activity first; `q` filters by name. GitHub is paged (up to 300); GitLab searches server-side. */
export async function listRepos(accountId: string, q = '', fetchFn: Fetch = fetch): Promise<{ repos: Repo[] }> {
  const account = get(accountId)
  const token = await accessToken(account, fetchFn)
  const p = provider(account.provider)
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  let repos: Repo[] = []
  const getJson = async (url: string) => {
    const r = await fetchFn(url, { headers, signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw new CoreError(r.status === 401 ? 401 : 502, `${p.label} answered ${r.status} listing repositories`)
    return (await r.json()) as Record<string, unknown>[]
  }
  if (account.provider === 'github') {
    headers.Accept = 'application/vnd.github+json'
    for (let page = 1; page <= 3; page++) {
      const qs = new URLSearchParams({ per_page: '100', page: String(page), sort: 'pushed', affiliation: 'owner,collaborator,organization_member' })
      const batch = await getJson(`${p.api}/user/repos?${qs}`)
      repos.push(...batch.map((x) => ({ name: x.full_name as string, url: x.html_url as string, default_branch: (x.default_branch as string) || 'main', private: (x.private as boolean) ?? false, description: (x.description as string) ?? null })))
      if (batch.length < 100) break
    }
    if (q) { const needle = q.toLowerCase(); repos = repos.filter((x) => x.name.toLowerCase().includes(needle)) }
  } else {
    const qs = new URLSearchParams({ membership: 'true', simple: 'true', per_page: '100', order_by: 'last_activity_at' })
    if (q) qs.set('search', q)
    const batch = await getJson(`${p.api}/projects?${qs}`)
    repos = batch.map((x) => ({ name: x.path_with_namespace as string, url: x.web_url as string, default_branch: (x.default_branch as string) || 'main', private: x.visibility !== 'public', description: (x.description as string) ?? null }))
  }
  return { repos: repos.slice(0, 200) }
}

// ----- connecting: the loopback OAuth round-trip -----

export interface ConnectOptions { fetchFn?: Fetch; port?: number; timeoutMs?: number }
export interface Connect { url: string; redirect_uri: string; state: string; done: Promise<PublicAccount>; cancel: () => void }

let inFlight: Connect | null = null

const page = (title: string, body: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:3em auto;max-width:36em"><h2>${title}</h2><p>${body}</p><p>You can close this tab and return to RunPod Manager.</p></body>`
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] as string)

/** Exchange the code for a token, read the profile, store the account (reconnecting the same user replaces the old entry). */
async function finishConnect(id: string, code: string, uri: string, fetchFn: Fetch): Promise<PublicAccount> {
  const p = provider(id)
  const c = client(id)
  const form = new URLSearchParams({ client_id: c.id, client_secret: c.secret, code, redirect_uri: uri })
  if (id === 'gitlab') form.set('grant_type', 'authorization_code')
  const r = await fetchFn(p.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString(), signal: AbortSignal.timeout(20_000) })
  const tok = (r.ok ? await r.json().catch(() => ({})) : {}) as { access_token?: string; scope?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }
  if (!tok.access_token) throw bad(tok.error_description || tok.error || `token exchange failed (${r.status})`)
  let user
  try { user = await fetchUser(id, tok.access_token, fetchFn) } catch (e) { throw new CoreError(502, `could not read your ${p.label} profile: ${(e as Error).message}`) }
  const account: Account = {
    id: randomUUID().replace(/-/g, ''), provider: id, host: hostOf(p.base), ...user,
    scope: tok.scope || p.scope, token: tok.access_token, refresh_token: tok.refresh_token ?? null,
    expires_at: tok.expires_in ? now() + tok.expires_in : null, connected_at: now(),
  }
  const others = load().filter((a) => !(a.provider === id && a.username === account.username))
  save([...others, account])
  return publicOf(account)
}

/**
 * Start connecting an account: bind the loopback listener, build the authorize URL. The caller opens
 * `url` in the system browser; `done` settles when the provider sends the browser back (or after
 * `timeoutMs`, default ten minutes). One login at a time: a new start cancels the previous one.
 * `port: 0` takes any free port (tests); GitLab needs the registered port, so the default is fixed.
 */
export async function startConnect(id: string, opts: ConnectOptions = {}): Promise<Connect> {
  const p = provider(id)
  const c = client(id)
  const names = clientEnvNames(id)
  if (!c.id || !c.secret) throw bad(`${p.label} is not configured: set ${names.id} and ${names.secret} in ~/.config/runpod-pod-manager/.env`)
  inFlight?.cancel()
  const fetchFn = opts.fetchFn || fetch
  const state = randomBytes(24).toString('base64url')
  const wantPort = opts.port ?? callbackPort()

  let settle!: { resolve: (a: PublicAccount) => void; reject: (e: Error) => void }
  const done = new Promise<PublicAccount>((resolve, reject) => { settle = { resolve, reject } })
  done.catch(() => {})   // the caller may not be awaiting yet when the listener fails; the rejection still reaches them

  let server: Server
  let timer: NodeJS.Timeout | undefined
  const finish = () => { clearTimeout(timer); server.close(); if (inFlight === connect) inFlight = null }

  server = createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    if (u.pathname !== '/callback') { res.writeHead(404).end(); return }
    const q = Object.fromEntries(u.searchParams)
    const reply = (status: number, html: string) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(html) }
    const fail = (status: number, message: string) => { reply(status, page(`${p.label}: not connected`, esc(message))); finish(); settle.reject(new CoreError(status, message)) }
    if (q.error) return fail(400, q.error_description || q.error)
    if (q.state !== state) return fail(400, 'Login expired or was tampered with — try again')
    if (!q.code) return fail(400, `${p.label} sent no code`)
    try {
      const account = await finishConnect(id, q.code, uri, fetchFn)
      reply(200, page(`${p.label} connected`, `Connected as <b>${esc(account.username)}</b>.`))
      finish(); settle.resolve(account)
    } catch (e) {
      const err = e as CoreError
      fail(err.status || 500, err.message)
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EADDRINUSE' ? new CoreError(500, `port ${wantPort} is in use; set GIT_OAUTH_PORT to a free port and register that callback with ${p.label}`) : new CoreError(500, e.message)))
    server.listen(wantPort, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : wantPort
  const uri = redirectUri(port)
  const params = new URLSearchParams({ client_id: c.id, redirect_uri: uri, scope: p.scope, state })
  if (id === 'gitlab') params.set('response_type', 'code')

  timer = setTimeout(() => { finish(); settle.reject(new CoreError(408, `${p.label} login timed out — try again`)) }, opts.timeoutMs ?? 600_000)
  timer.unref()
  const connect: Connect = { url: `${p.authorize}?${params}`, redirect_uri: uri, state, done, cancel: () => { finish(); settle.reject(new CoreError(499, 'Login cancelled')) } }
  inFlight = connect
  return connect
}
