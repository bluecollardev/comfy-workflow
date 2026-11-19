import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as history from '../src/history.js'
import * as panama from '../src/panama.js'
import * as publish from '../src/publish.js'
import * as settingsEnv from '../src/settings.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050: publishing to S3 and Slack, with fakes only: no S3, no Slack, no network.
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SECRETSECRETSECRET'
const KEY_ID = 'AKIAEXAMPLEKEY1234', KEY_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
let dir: string, out: string
let calls: { args: string[]; env: Record<string, string> }[], bucket: Map<string, number>, failCp: Set<string>, cpGate: Promise<void> | null
let posts: { url: string; body: { text: string; username: string; channel?: string } }[], slackStatus: number, slackThrow: number
let live = 0, maxLive = 0

const write = (rel: string, size = 10) => { const p = join(out, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, Buffer.alloc(size, 1)) }
const fakeAws: podpull.AwsRunner = async (args, env, o) => {
  calls.push({ args, env })
  if (args[0] === 's3' && args[1] === 'ls') {
    const m = /^s3:\/\/[^/]+\/(.*)$/.exec(args[2])!, pre = m[1]
    const rows = [...bucket].filter(([k]) => k.startsWith(pre)).map(([k, n]) => `2026-11-19 10:00:00 ${String(n).padStart(10)} ${args.includes('--recursive') ? k : k.slice(pre.length)}`)
    return { code: rows.length ? 0 : 1, stdout: rows.join('\n'), stderr: '' }
  }
  if (args[0] === 's3api') return { code: 0, stdout: '{}', stderr: '' }
  if (args[0] === 's3' && args[1] === 'presign') return { code: 0, stdout: `https://s3.example/${args[2].slice(5)}?X-Amz-Signature=abc\n`, stderr: '' }
  if (args[0] === 's3' && args[1] === 'cp') {
    live++; maxLive = Math.max(maxLive, live)
    try {
      if (cpGate) await cpGate
      if (o?.signal?.aborted) return { code: 130, stdout: '', stderr: 'cancelled' }
      const src = args[2]
      if ([...failCp].some((f) => src.endsWith(f))) return { code: 1, stdout: '', stderr: `upload failed: ${src} to ${args[3]} An error occurred (AccessDenied) ${KEY_SECRET}` }
      const size = readFileSync(src).length
      o?.onData?.(`Completed ${Math.max(1, Math.floor(size / 2))} Bytes/${size} Bytes (1 Bytes/s) with 1 file(s) remaining\r`)
      bucket.set(args[3].replace(/^s3:\/\/[^/]+\//, ''), size)
      return { code: 0, stdout: `upload: ${src} to ${args[3]}`, stderr: '' }
    } finally { live-- }
  }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const fakeFetch = (async (url: string, init: { body: string }) => {
  if (slackThrow > 0) { slackThrow--; throw new TypeError(`fetch failed ${url}`) }
  posts.push({ url, body: JSON.parse(init.body) })
  return new Response(slackStatus === 200 ? 'ok' : 'no_service', { status: slackStatus })
}) as unknown as typeof fetch

const configure = async (extra: Partial<publish.SettingsInput> = {}) => publish.setSettings({
  s3: { credentials: 'app', bucket: 'my-internal-bucket', prefix: 'renders', region: 'us-west-2', access_key_id: KEY_ID, secret_access_key: KEY_SECRET, ...extra.s3 }, slack: { webhook_url: WEBHOOK, channel: '#renders', ...extra.slack },
})
const finish = async (id: string) => { await publish.settled(); return publish.status(id).jobs[0] }
const PANAMA_ENV = ['PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY', 'PANAMA_S3_BUCKET']

beforeEach(() => {
  dir = scratch(); out = join(dir, 'shared', 'output'); mkdirSync(out, { recursive: true })
  process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.PUBLISH_SLACK_HOST_ALLOW = 'hooks.slack.com'
  for (const k of [...settingsEnv.PUBLISH_SECRETS, ...PANAMA_ENV]) delete process.env[k]
  calls = []; bucket = new Map(); failCp = new Set(); cpGate = null; posts = []; slackStatus = 200; slackThrow = 0; live = 0; maxLive = 0
  publish.reset(); publish.setDeps({ aws: fakeAws, fetch: fakeFetch, outputRoot: () => out, parallel: () => 3 })
})
afterEach(() => { publish.reset(); delete process.env.PUBLISH_SLACK_HOST_ALLOW; for (const k of [...settingsEnv.PUBLISH_SECRETS, 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY']) delete process.env[k] })

describe('settings: defaults, validation, masking', () => {
  it('nothing saved: the non-secret defaults appear, nothing is ready, the problems say what to add', async () => {
    const s = await publish.settings()
    expect(s.slack).toMatchObject({ workspace_name: 'Beinghuman', workspace_url: 'https://beinghuman-hq.slack.com', username: 'RunPod Manager', channel: '', ready: false, file_links: true, file_link_count: 10, folder_link: true, preview_frame: true, volume_source: true })
    expect(s.slack.problem).toBe('Add the Incoming Webhook URL for Beinghuman (Slack: Apps > Incoming Webhooks)')
    expect(s.s3).toMatchObject({ bucket: panama.bucket(), region: panama.region(), prefix: 'returns/BKK/', ready: false, credentials: 'panama', presign_hours: 72, note: 'Lucas, 2026-11-19: Panama exchange bucket, returns/BKK/' })
    expect(s.s3.problem).toBe('Add the Panama AWS keys (Settings > Panama) or separate keys')
    process.env.PANAMA_AWS_ACCESS_KEY_ID = KEY_ID; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = KEY_SECRET
    expect((await publish.settings()).s3.ready).toBe(true); expect(JSON.stringify(await publish.settings())).not.toContain(KEY_SECRET)
    await publish.setSettings({ s3: { bucket: 'another-bucket' } }); const o = (await publish.settings()).s3; expect(o.bucket).toBe('another-bucket'); expect(o.note).toBeUndefined()
    await publish.setSettings({ s3: { bucket: '' } }); expect((await publish.settings()).s3.bucket).toBe(panama.bucket())   // clearing returns to the Panama setting
    expect(s.defaults.targets).toEqual([]); expect(s.defaults.message).toContain('{approved_by}')
  })
  it('no default contains a webhook, a token or a key (the app ships on a public repository)', () => {
    const all = JSON.stringify(publish.PUBLISH_DEFAULTS)
    expect(all).not.toMatch(/hooks\.slack\.com\/services|xox[a-z]-|AKIA|secret/i)
    expect(PUBLISH_SRC()).not.toMatch(/hooks\.slack\.com\/services\/T|xox[bpas]-|AKIA[A-Z0-9]{8}/)
  })
  it('a saved value overrides, clearing ("") returns to the default', async () => {
    await publish.setSettings({ slack: { workspace_name: 'Other', username: 'Bot', workspace_url: 'https://other.slack.com' } })
    expect((await publish.settings()).slack).toMatchObject({ workspace_name: 'Other', username: 'Bot', workspace_url: 'https://other.slack.com' })
    await publish.setSettings({ slack: { workspace_name: '', username: '', workspace_url: '' } })
    expect((await publish.settings()).slack).toMatchObject({ workspace_name: 'Beinghuman', username: 'RunPod Manager', workspace_url: 'https://beinghuman-hq.slack.com' })
  })
  it('validation names the field (400)', async () => {
    const cases: [publish.SettingsInput, RegExp][] = [
      [{ s3: { bucket: 'AB' } }, /s3\.bucket/], [{ s3: { bucket: 'Has_Upper' } }, /s3\.bucket/], [{ s3: { prefix: '/x' } }, /s3\.prefix/], [{ s3: { prefix: 'a/../b' } }, /s3\.prefix/], [{ s3: { prefix: 'x'.repeat(201) } }, /s3\.prefix/],
      [{ s3: { region: 'mars' } }, /s3\.region/], [{ s3: { endpoint: 'http://minio.local' } }, /s3\.endpoint/], [{ s3: { endpoint: 'https://u:p@minio.local' } }, /s3\.endpoint/],
      [{ s3: { presign_hours: 0 } }, /presign_hours/], [{ s3: { presign_hours: 169 } }, /presign_hours/], [{ s3: { credentials: 'x' } }, /credentials/],
      [{ slack: { webhook_url: 'http://hooks.slack.com/services/x' } }, /webhook_url/], [{ slack: { webhook_url: 'https://evil.example/services/x' } }, /webhook_url/], [{ slack: { channel: 'renders' } }, /slack\.channel/],
      [{ slack: { workspace_url: 'http://x.slack.com' } }, /workspace_url/], [{ slack: { workspace_url: 'https://slack.evil.com' } }, /workspace_url/], [{ slack: { workspace_url: 'https://x.slack.com.evil.com' } }, /workspace_url/],
      [{ slack: { file_link_count: 0 } }, /file_link_count/], [{ slack: { file_link_count: 26 } }, /file_link_count/], [{ slack: { file_links: 'yes' as never } }, /slack\.file_links/], [{ slack: { folder_link: 1 as never } }, /slack\.folder_link/],
    ]
    for (const [input, re] of cases) await expect(publish.setSettings(input), JSON.stringify(input)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(re) })
    await expect(publish.setSettings({ slack: { workspace_url: 'https://beinghuman-hq.slack.com' }, s3: { prefix: '/x' } })).rejects.toThrow()
    expect(await publish.setSettings({ s3: { prefix: 'a/b', endpoint: 'https://minio.local/', presign_hours: 168 }, slack: { workspace_url: 'https://x.slack.com/path', file_link_count: 25, file_links: false, folder_link: false } })).toMatchObject({ s3: { prefix: 'a/b/', endpoint: 'https://minio.local', presign_hours: 168 }, slack: { workspace_url: 'https://x.slack.com', file_link_count: 25, file_links: false, folder_link: false } })
  })
  it('secrets are stored in the .env, never returned, a blank keeps the stored one, clear removes it, and nothing is logged with a value', async () => {
    const s = await configure()
    const shown = JSON.stringify(s)
    for (const v of [KEY_ID, KEY_SECRET, WEBHOOK, 'SECRETSECRET']) expect(shown).not.toContain(v)
    expect(s.s3.access_key_hint).toBe('••••1234'); expect(s.slack.webhook_hint).toBe('••••CRET'); expect(s.s3.ready && s.slack.ready).toBe(true)
    const env = readFileSync(join(dir, '.env'), 'utf8'); expect(env).toContain(`PUBLISH_S3_ACCESS_KEY_ID=${KEY_ID}`); expect(env).toContain(`PUBLISH_SLACK_WEBHOOK_URL=${WEBHOOK}`)
    await publish.setSettings({ s3: { bucket: 'my-internal-bucket', access_key_id: '', secret_access_key: '' }, slack: { webhook_url: '' } })
    expect((await publish.settings()).s3.access_key_hint).toBe('••••1234')
    const cleared = await publish.setSettings({ clear: ['s3_keys', 'slack_webhook'] })
    expect(cleared.s3.ready).toBe(false); expect(cleared.slack.ready).toBe(false)
    expect(readFileSync(join(dir, '.env'), 'utf8')).not.toContain(KEY_ID)
    const log = JSON.stringify(history.list({ limit: 50 })); for (const v of [KEY_ID, KEY_SECRET, WEBHOOK]) expect(log).not.toContain(v)
    expect(history.list({ limit: 50 }).some((e) => e.kind === 'change' && e.action === 'publishing settings changed' && /s3\.access_key_id/.test(e.detail ?? ''))).toBe(true)
    await expect(publish.setSettings({ s3: { access_key_id: 'short' } })).rejects.toMatchObject({ status: 400 })
  })
  it("credentials 'panama' needs no keys of its own: the Panama AWS keys are used for the upload", async () => {
    let s = await publish.setSettings({ s3: { credentials: 'panama', bucket: 'my-internal-bucket', region: 'us-west-2' } })
    expect(s.s3.ready).toBe(false)
    process.env.PANAMA_AWS_ACCESS_KEY_ID = KEY_ID; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = KEY_SECRET
    s = await publish.settings(); expect(s.s3.ready).toBe(true)
    write('a.mov'); const { job_id } = await publish.run({ items: ['a.mov'], targets: ['s3'], approved_by: 'L', round: 'qc_2026-11-02_r01' }); await finish(job_id)
    const cp = calls.find((c) => c.args[1] === 'cp')!; expect(cp.env).toMatchObject({ AWS_ACCESS_KEY_ID: KEY_ID, AWS_SECRET_ACCESS_KEY: KEY_SECRET }); expect(cp.args[3]).toBe('s3://my-internal-bucket/returns/BKK/qc_2026-11-02_r01/shot/a.mov')
  })
})

describe('test()', () => {
  it('s3: a read-only check (an ls and a listing, no cp), friendly when it fails', async () => {
    expect(await publish.test({ target: 's3' })).toMatchObject({ ok: false, detail: expect.stringContaining('Panama AWS keys') })
    await configure(); const r = await publish.test({ target: 's3' })
    expect(r.ok).toBe(true); expect(calls.map((c) => `${c.args[0]} ${c.args[1]}`)).toEqual(['s3 ls', 's3api list-objects-v2']); expect(calls.some((c) => c.args.includes('cp') || c.args.includes('rm'))).toBe(false)
    expect(calls[0].args).toEqual(['s3', 'ls', 's3://my-internal-bucket/renders/', '--region', 'us-west-2']); expect(calls[0].env).toMatchObject({ AWS_ACCESS_KEY_ID: KEY_ID })
    publish.setDeps({ aws: async () => ({ code: 255, stdout: '', stderr: `An error occurred (AccessDenied) at https://s3.amazonaws.com/x ${KEY_SECRET}` }) })
    const bad = await publish.test({ target: 's3' }); expect(bad.ok).toBe(false); expect(bad.detail).not.toMatch(/https?:|wJalr/)
    await expect(publish.test({ target: 'ftp' })).rejects.toMatchObject({ status: 400 })
  })
  it('slack posts the test message ONLY when called, with no URL in a failure', async () => {
    await configure(); expect(posts).toEqual([])
    expect(await publish.test({ target: 'slack' })).toMatchObject({ ok: true }); expect(posts).toHaveLength(1)
    expect(posts[0].body).toEqual({ text: 'RunPod Manager: test message', username: 'RunPod Manager', channel: '#renders' }); expect(posts[0].url).toBe(WEBHOOK)
    slackStatus = 404; const r = await publish.test({ target: 'slack' }); expect(r.ok).toBe(false); expect(r.detail).toMatch(/404/); expect(r.detail).not.toContain('hooks.slack.com')
  })
  it('slack: one retry on a network error, then a friendly message with no URL', async () => {
    await configure(); slackThrow = 1; expect((await publish.test({ target: 'slack' })).ok).toBe(true); expect(posts).toHaveLength(1)
    slackThrow = 2; const r = await publish.test({ target: 'slack' }); expect(r.ok).toBe(false); expect(r.detail).not.toMatch(/https?:|hooks/)
  })
})

describe('local()', () => {
  it('lists one level (dirs first), with sizes and weight flags, hides links, refuses .. and links in the path, caps at 2000', async () => {
    write('deliver/archival-085/v001/clip.mov', 100); write('a.mp4', 5); write('m.safetensors', 7); write('.proxies/x/p.mp4', 3)
    symlinkSync(dir, join(out, 'escape'))
    const top = await publish.local()
    expect(top.entries.map((e) => e.name)).toEqual(['.proxies', 'deliver', 'a.mp4', 'm.safetensors']); expect(top.parent).toBe('')
    expect(top.entries.find((e) => e.name === 'm.safetensors')).toMatchObject({ weight: true, bytes: 7, dir: false, path: 'm.safetensors' })
    const v = await publish.local({ dir: 'deliver/archival-085/v001' }); expect(v.entries).toMatchObject([{ name: 'clip.mov', path: 'deliver/archival-085/v001/clip.mov', bytes: 100 }]); expect(v.parent).toBe('deliver/archival-085')
    await expect(publish.local({ dir: '../x' })).rejects.toMatchObject({ status: 400 }); await expect(publish.local({ dir: '/etc' })).rejects.toMatchObject({ status: 400 })
    await expect(publish.local({ dir: 'escape' })).rejects.toMatchObject({ status: 400 }); await expect(publish.local({ dir: 'nope' })).rejects.toMatchObject({ status: 404 })
    for (let i = 0; i < 2100; i++) write(`big/f${String(i).padStart(4, '0')}.txt`, 1)
    const big = await publish.local({ dir: 'big' }); expect(big.entries).toHaveLength(2000); expect(big.truncated).toBe(100)
  })
  it('says so when no ComfyUI-Shared folder is mapped', async () => { publish.setDeps({ outputRoot: () => null }); await expect(publish.local()).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/not mapped/) }) })
})

describe('plan()', () => {
  it('blockers when nothing is configured (no default destination)', async () => {
    write('a.mov'); const p = await publish.plan({ items: ['a.mov'], targets: ['s3', 'slack'] })
    expect(p.ok).toBe(false); expect(p.blockers.join(' ')).toMatch(/S3 is not configured/); expect(p.blockers.join(' ')).toMatch(/Slack is not configured/)
  })
  it('expands folders, keeps the structure under the prefix, skips same-size objects already there with ONE listing per folder, and previews Slack', async () => {
    await configure(); write('deliver/archival-085/v001/clip.mov', 100); write('deliver/archival-085/v001/DELIVERY.md', 20); write('other.mp4', 5)
    bucket.set('renders/deliver/archival-085/v001/DELIVERY.md', 20); bucket.set('renders/deliver/archival-085/v001/clip.mov', 99)   // same size, and a different size
    const p = await publish.plan({ items: ['deliver/archival-085/v001', 'other.mp4'], targets: ['s3', 'slack'], approved_by: 'Lucas' })
    expect(p.ok).toBe(true); expect(p.files).toBe(3); expect(p.total_bytes).toBe(125)
    expect(p.items.map((i) => [i.s3_key, i.skip])).toEqual([['renders/deliver/archival-085/v001/clip.mov', null], ['renders/deliver/archival-085/v001/DELIVERY.md', 'same size already there'], ['renders/other.mp4', null]])
    expect(p.s3).toEqual({ dest: 's3://my-internal-bucket/renders/', count: 2, new_bytes: 105 })
    expect(calls.filter((c) => c.args[1] === 'ls')).toHaveLength(2)   // the folder once (recursive), the file's folder once
    expect(p.slack!.to).toBe('Beinghuman: #renders'); expect(p.slack!.preview).toContain('Published from RunPod Manager'); expect(p.slack!.preview).toContain('Approved by Lucas'); expect(p.slack!.preview).toContain('• clip.mov (100 B)')
    expect(p.slack!.preview).not.toContain('X-Amz'); expect(JSON.stringify(p)).not.toContain(WEBHOOK)
  })
  it('refuses model weights with the reason, and links, and paths outside output/', async () => {
    await configure(); write('m/x.safetensors', 3); write('m/ok.txt', 3); symlinkSync(dir, join(out, 'lnk'))
    for (const ext of ['ckpt', 'pt', 'pth', 'bin', 'gguf', 'onnx', 'pkl']) write(`w/a.${ext}`, 1)
    const p = await publish.plan({ items: ['m', 'w', 'lnk', '../x', '/etc/passwd'], targets: ['s3'] })
    expect(p.ok).toBe(false); expect(p.refused.filter((r) => /weights/.test(r.reason))).toHaveLength(8); expect(p.refused.some((r) => r.path === 'lnk')).toBe(true); expect(p.refused.filter((r) => /Not a path/.test(r.reason))).toHaveLength(2)
    expect(p.items.find((i) => i.path === 'm/x.safetensors')!.skip).toBe('weights')
  })
  it('marks a missing path, and 400s a bad target list', async () => {
    await configure(); write('a.mov'); const p = await publish.plan({ items: ['a.mov', 'gone.mov'], targets: ['s3'] })
    expect(p.items.find((i) => i.path === 'gone.mov')!.skip).toBe('missing'); expect(p.ok).toBe(true)
    await expect(publish.plan({ items: ['a.mov'], targets: [] })).rejects.toMatchObject({ status: 400 })
    expect((await publish.plan({ items: ['gone.mov'], targets: ['s3'] })).blockers.join()).toMatch(/Nothing to publish/)
  })
  it('caps at 20,000 files with a blocker, without holding the event loop', async () => {
    await configure(); mkdirSync(join(out, 'many'))
    for (let i = 0; i < 20_050; i++) writeFileSync(join(out, 'many', `f${i}`), '')
    let worst = 0, last = performance.now(); const t = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n }, 1)
    const p = await publish.plan({ items: ['many'], targets: ['slack'] }); clearInterval(t)
    expect(p.blockers.join()).toMatch(/More than 20,000 files/); expect(p.ok).toBe(false); expect(worst).toBeLessThan(750)
  }, 30_000)
})

describe('run()', () => {
  it('needs the approver, a ready plan, and no weights', async () => {
    await configure(); write('a.mov'); write('w.safetensors')
    await expect(publish.run({ items: ['a.mov'], targets: ['s3'] })).rejects.toMatchObject({ status: 400, message: 'Publishing needs the name of who says yes (approved_by)' })
    await expect(publish.run({ items: ['a.mov'], targets: ['s3'], approved_by: '  ' })).rejects.toMatchObject({ status: 400 })
    await expect(publish.run({ items: ['a.mov', 'w.safetensors'], targets: ['s3'], approved_by: 'Lucas' })).rejects.toMatchObject({ message: expect.stringMatching(/weights/) })
    expect(calls.some((c) => c.args[1] === 'cp')).toBe(false)
  })
  it('uploads with the right arguments, parallel at most sync_parallel, reports progress, presigns, then posts ONE Slack message once all succeeded', async () => {
    await configure({ s3: { endpoint: 'https://s3.example.test', presign_hours: 24 } }); for (let i = 0; i < 7; i++) write(`deliver/s/v001/c${i}.mov`, 100 + i)
    let release!: () => void; cpGate = new Promise((r) => { release = r })
    const { job_id } = await publish.run({ items: ['deliver/s/v001'], targets: ['s3', 'slack'], approved_by: 'Lucas' })
    await new Promise((r) => setTimeout(r, 50)); expect(publish.status(job_id).jobs[0].state).toBe('uploading'); expect(posts).toHaveLength(0)
    release(); const j = await finish(job_id)
    expect(maxLive).toBeLessThanOrEqual(3); expect(maxLive).toBeGreaterThan(1)
    expect(j).toMatchObject({ state: 'done', files_total: 7, files_done: 7, bytes_done: 721, approved_by: 'Lucas', targets: ['s3', 'slack'], slack: { state: 'sent' } })
    const cp = calls.find((c) => c.args[1] === 'cp')!; expect(cp.args.slice(0, 2)).toEqual(['s3', 'cp']); expect(cp.args[2]).toMatch(/shared\/output\/deliver\/s\/v001\/c\d\.mov$/); expect(cp.args[3]).toMatch(/^s3:\/\/my-internal-bucket\/renders\/deliver\/s\/v001\/c\d\.mov$/)
    expect(cp.args.slice(4)).toEqual(['--region', 'us-west-2', '--endpoint-url', 'https://s3.example.test']); expect(cp.env).toMatchObject({ AWS_ACCESS_KEY_ID: KEY_ID, AWS_SECRET_ACCESS_KEY: KEY_SECRET }); expect(cp.args.join(' ')).not.toContain(KEY_SECRET)
    const pre = calls.filter((c) => c.args[1] === 'presign'); expect(pre).toHaveLength(7); expect(pre[0].args).toContain('86400')
    expect(posts).toHaveLength(1); const t = posts[0].body.text
    expect(t).toContain('Published from RunPod Manager'); expect(t).toContain('Approved by Lucas'); expect(t).toContain('7 file(s)'); expect(t).toContain('s3://my-internal-bucket/renders/'); expect(t).toContain('X-Amz-Signature'); expect(t).toContain('c0.mov')
    expect(j.links).toHaveLength(7)
    expect(JSON.stringify(history.list({ limit: 20 }))).not.toMatch(/X-Amz|SECRET|wJalr/)
    const h = history.list({ limit: 20 }).find((e) => e.kind === 'job' && e.job === 'publish')!; expect(h).toMatchObject({ approved_by: 'Lucas', files: 7, state: 'done' })
  })
  it('more than 10 files: the message lists 10 names, "…and N more", and links for 10', async () => {
    await configure(); for (let i = 0; i < 13; i++) write(`d/f${String(i).padStart(2, '0')}.mov`, 10)
    const { job_id } = await publish.run({ items: ['d'], targets: ['s3', 'slack'], approved_by: 'Lucas' }); await finish(job_id)
    expect(posts[0].body.text).toContain('…and 3 more'); expect(posts[0].body.text.match(/X-Amz-Signature/g)).toHaveLength(10); expect(calls.filter((c) => c.args[1] === 'presign')).toHaveLength(10)
  })
  it('a custom template uses the placeholders; the approver is still named', async () => {
    await configure(); write('a.mov', 2048)
    const { job_id } = await publish.run({ items: ['a.mov'], targets: ['s3', 'slack'], approved_by: 'Lucas', message: 'Got {count} ({size}) at {dest} on {date}' }); await finish(job_id)
    expect(posts[0].body.text).toMatch(/Got 1 \(2\.0 KB\) at s3:\/\/my-internal-bucket\/renders\/ on 20\d\d-/); expect(posts[0].body.text).toContain('Approved by Lucas')
  })
  it('all-or-nothing: an upload that fails means NO Slack post, the job fails with a friendly message and no secret', async () => {
    await configure(); write('d/a.mov'); write('d/b.mov'); failCp.add('b.mov')
    const { job_id } = await publish.run({ items: ['d'], targets: ['s3', 'slack'], approved_by: 'Lucas' }); const j = await finish(job_id)
    expect(j.state).toBe('failed'); expect(posts).toHaveLength(0); expect(j.error).toContain('b.mov'); expect(JSON.stringify(j)).not.toContain(KEY_SECRET)
    expect(JSON.stringify(history.list({ limit: 10 }))).not.toContain(KEY_SECRET)
  })
  it('a Slack failure after a good upload is done_with_warning, and the message can be sent again', async () => {
    await configure(); write('a.mov'); slackStatus = 500
    const { job_id } = await publish.run({ items: ['a.mov'], targets: ['s3', 'slack'], approved_by: 'Lucas' }); const j = await finish(job_id)
    expect(j).toMatchObject({ state: 'done_with_warning', files_done: 1, slack: { state: 'failed' } }); expect(j.summary).toMatch(/files are up/); expect(j.error).not.toContain('hooks')
    slackStatus = 200; await publish.slack({ job_id }); const again = await finish(job_id)
    expect(again).toMatchObject({ state: 'done', slack: { state: 'sent' } }); expect(posts).toHaveLength(2); expect(calls.filter((c) => c.args[1] === 'cp')).toHaveLength(1)   // nothing uploaded twice
    await expect(publish.slack({ job_id })).rejects.toMatchObject({ status: 400 })
  })
  it('a same-size object already there is not uploaded again', async () => {
    await configure(); write('a.mov', 50); bucket.set('renders/a.mov', 50)
    const { job_id } = await publish.run({ items: ['a.mov'], targets: ['s3'], approved_by: 'Lucas' }); const j = await finish(job_id)
    expect(j).toMatchObject({ state: 'done', files_total: 0, skipped: 1 }); expect(calls.some((c) => c.args[1] === 'cp')).toBe(false)
  })
  it('cancel stops the aws children and ends the job as cancelled with no Slack post', async () => {
    await configure(); write('a.mov'); write('b.mov'); cpGate = new Promise(() => undefined)
    publish.setDeps({ aws: async (a, e, o) => { if (a[1] === 'cp') return new Promise((res) => o!.signal!.addEventListener('abort', () => res({ code: 130, stdout: '', stderr: '' }))); return fakeAws(a, e, o) } })
    const { job_id } = await publish.run({ items: ['a.mov', 'b.mov'], targets: ['s3', 'slack'], approved_by: 'Lucas' })
    await new Promise((r) => setTimeout(r, 30)); publish.cancel(job_id); const j = await finish(job_id)
    expect(j.state).toBe('cancelled'); expect(posts).toHaveLength(0)
  })
  it('progress text is parsed, stall detection is per progress line (the stall limit is passed to every upload)', async () => {
    expect(publish.parseProgress('Completed 5.0 MiB/1.2 GiB (3 MiB/s) with 1 file(s) remaining\rCompleted 10.0 MiB/1.2 GiB (3 MiB/s) with 1 file(s) remaining\r')).toBe(10 * 1024 ** 2)
    expect(publish.parseProgress('Completed 512 Bytes/1 KiB')).toBe(512); expect(publish.parseProgress('upload: a to b')).toBeNull()
    await configure(); write('a.mov'); let seen: number | undefined
    publish.setDeps({ aws: async (a, e, o) => { if (a[1] === 'cp') seen = o?.stallMs; return fakeAws(a, e, o) } })
    await finish((await publish.run({ items: ['a.mov'], targets: ['s3'], approved_by: 'L' })).job_id); expect(seen).toBe(publish.STALL_MS)
  })
  it('finished jobs are kept in publish-jobs.json without the signed links', async () => {
    await configure(); write('a.mov'); const { job_id } = await publish.run({ items: ['a.mov'], targets: ['s3'], approved_by: 'L' }); await finish(job_id)
    const disk = readFileSync(join(dir, 'publish-jobs.json'), 'utf8'); expect(disk).toContain(job_id); expect(disk).not.toContain('X-Amz'); expect(disk).not.toContain(KEY_SECRET)
  })
  it('a Slack-only run posts the names and sizes, with no links and no upload', async () => {
    await configure(); write('a.mov'); const { job_id } = await publish.run({ items: ['a.mov'], targets: ['slack'], approved_by: 'L' }); const j = await finish(job_id)
    expect(j.state).toBe('done'); expect(calls.some((c) => c.args[1] === 'cp')).toBe(false); expect(posts[0].body.text).toContain('a.mov')
  })
})

describe('async rule', () => {
  it('publish.ts has no synchronous process or file calls', () => {
    expect(PUBLISH_SRC().match(/\b(spawnSync|execSync|execFileSync|readFileSync|writeFileSync|statSync|readdirSync|existsSync)\b/g) ?? []).toEqual([])
  })
})
const PUBLISH_SRC = (): string => readFileSync(join(import.meta.dirname, '..', 'src', 'publish.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
