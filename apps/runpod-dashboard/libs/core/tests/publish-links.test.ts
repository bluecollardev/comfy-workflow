import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as history from '../src/history.js'
import * as publish from '../src/publish.js'
import * as settingsEnv from '../src/settings.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050 "Links in the Slack post": the destination folder (the AWS console) and expiring links to the first files, in every kind of message. Fakes only.
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SECRETSECRETSECRET'
let dir: string, out: string, calls: { args: string[] }[], posts: { text: string; blocks?: Record<string, unknown>[] }[], failPresign: Set<string>, now: number
const write = (rel: string, size = 10) => { const p = join(out, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, Buffer.alloc(size, 1)) }
const fakeAws: podpull.AwsRunner = async (args, _e, o) => {
  calls.push({ args })
  if (args[1] === 'presign') { const key = args[2].replace(/^s3:\/\/[^/]+\//, ''); return [...failPresign].some((f) => key.endsWith(f)) ? { code: 255, stdout: '', stderr: 'boom' } : { code: 0, stdout: `https://s3.example/${key}?X-Amz-Signature=sig${args.indexOf('--expires-in')}\n`, stderr: '' } }
  if (args[1] === 'ls') return { code: 1, stdout: '', stderr: '' }
  if (args[1] === 'cp') { o?.onData?.('Completed 1 Bytes/1 Bytes\r'); return { code: 0, stdout: '', stderr: '' } }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const fakeFetch = (async (_u: string, init: { body: string }) => { posts.push(JSON.parse(init.body)); return new Response('ok') }) as unknown as typeof fetch
const finish = async (id: string) => { await publish.settled(); return publish.status(id).jobs[0] }
const go = async (items: unknown[], o: Record<string, unknown> = {}) => { const { job_id } = await publish.run({ items, targets: ['s3', 'slack'], approved_by: 'Lucas', ...o }); return finish(job_id) }
const presigns = () => calls.filter((c) => c.args[1] === 'presign').map((c) => c.args[2].replace(/^s3:\/\/[^/]+\//, ''))
const text = () => posts[0].text
const blockText = (i = 0) => (posts[i].blocks ?? []).filter((b) => b.type === 'section').map((b) => (b.text as { text: string }).text).join('\n---\n')
const folder = (shot = 'archival-085', v = 'v001', names = ['clip.mov']) => { for (const n of names) write(`deliver/${shot}/${v}/${n}`, 100); return `deliver/${shot}/${v}` }

beforeEach(async () => {
  dir = scratch(); out = join(dir, 'shared', 'output'); mkdirSync(out, { recursive: true }); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.PUBLISH_SLACK_HOST_ALLOW = 'hooks.slack.com'
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  calls = []; posts = []; failPresign = new Set(); now = Date.parse('2026-11-19T10:00:00Z')
  publish.reset(); publish.setDeps({ aws: fakeAws, fetch: fakeFetch, outputRoot: () => out, parallel: () => 4, now: () => now, findFfmpeg: async () => null })
  await publish.setSettings({ s3: { layout: 'as-is', credentials: 'app', bucket: 'my-bucket', prefix: 'returns/BKK', region: 'us-west-2', presign_hours: 72, access_key_id: 'AKIAEXAMPLEKEY1234', secret_access_key: 'secretsecretsecret1234' }, slack: { webhook_url: WEBHOOK, preview_frame: false, volume_source: false } })
})
afterEach(() => { publish.reset(); delete process.env.PUBLISH_SLACK_HOST_ALLOW; for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k] })

describe('defaults and the plan', () => {
  it('on by default: 10 files, a folder link; the plan says what links the post will carry and when they expire', async () => {
    const s = (await publish.settings()).slack; expect(s).toMatchObject({ file_links: true, file_link_count: 10, folder_link: true })
    const f = folder('archival-085', 'v001', ['clip.mov', 'clip.mov.meta.json', 'DELIVERY.md']); const p = await publish.plan({ items: [f], targets: ['s3', 'slack'], approved_by: 'L' })
    expect(p.slack!.links).toEqual({ folder: true, files: 1, expires_at: '2026-11-22T10:00:00.000Z' }); expect(p.slack!.preview).toContain('With a link to the destination folder and links to the first 1 file, expiring 2026-11-22')
    await publish.setSettings({ slack: { file_links: false } }); expect((await publish.plan({ items: [f], targets: ['s3', 'slack'] })).slack!.links).toEqual({ folder: true, files: 0, expires_at: null })
    await publish.setSettings({ slack: { folder_link: false } }); const none = await publish.plan({ items: [f], targets: ['s3', 'slack'] }); expect(none.slack!.links).toEqual({ folder: false, files: 0, expires_at: null }); expect(none.slack!.preview).not.toMatch(/With (a )?link/)
  })
})

describe('the post', () => {
  it('the folder link is the AWS console, never signed; the file links are expiring presigned URLs; the header block holds neither; the sidecars, DELIVERY.md and previews get no file link', async () => {
    const f = folder('archival-085', 'v002', ['clip.mov', 'clip.mov.meta.json', 'DELIVERY.md', 'clip_preview.jpg', 'second.mov']); const j = await go([f])
    expect(j.state).toBe('done'); expect(presigns()).toEqual(['returns/BKK/deliver/archival-085/v002/clip.mov', 'returns/BKK/deliver/archival-085/v002/second.mov'])
    expect(text()).toContain('Folder: <https://s3.console.aws.amazon.com/s3/buckets/my-bucket?prefix=returns/BKK/deliver/archival-085/v002/&region=us-west-2|archival-085 v002> (s3://my-bucket/returns/BKK/deliver/archival-085/v002/)')
    expect(text()).toContain('<https://s3.example/returns/BKK/deliver/archival-085/v002/clip.mov?X-Amz-Signature='); expect(text()).toContain('expires 2026-11-22'); expect(text()).not.toMatch(/meta\.json\||DELIVERY\.md\||_preview\.jpg\|/)
    const b = posts[0].blocks!; expect((b[0].text as { text: string }).text).not.toMatch(/https?:|X-Amz/); expect(b.map((x) => x.type)).toEqual(['section', 'section', 'section']); expect(blockText()).toContain('*Files* (links expire 2026-11-22)'); expect(blockText()).toContain('Folder: <https://s3.console.aws.amazon.com/')
    expect(j.links.filter((l) => l.kind === 'file').map((l) => l.path)).toEqual(['deliver/archival-085/v002/clip.mov', 'deliver/archival-085/v002/second.mov']); expect(j.links.filter((l) => l.kind === 'folder')).toEqual([{ path: 'returns/BKK/deliver/archival-085/v002/', url: expect.stringContaining('console.aws.amazon.com'), expires_at: '', kind: 'folder' }]); expect(j.links.find((l) => l.kind === 'file')!.expires_at).toBe('2026-11-22T10:00:00.000Z')
  })
  it('the number of file links is the setting (default 10, 3, 25), with "+N more" and the folder link covering the rest', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `c${String(i).padStart(2, '0')}.mov`); const f = folder('archival-085', 'v001', names)
    await go([f]); expect(presigns()).toHaveLength(10); expect(text()).toContain('+20 more (the folder link covers them)')
    await publish.setSettings({ slack: { file_link_count: 3 } }); calls.length = 0; posts.length = 0; await go([f]); expect(presigns()).toEqual(names.slice(0, 3).map((n) => `returns/BKK/deliver/archival-085/v001/${n}`)); expect(text()).toContain('+27 more')
    await publish.setSettings({ slack: { file_link_count: 25 } }); calls.length = 0; posts.length = 0; await go([f]); expect(presigns()).toHaveLength(25); expect(text()).toContain('+5 more'); expect(posts[0].blocks!.length).toBeLessThanOrEqual(50)
    for (const b of posts[0].blocks!) if (b.type === 'section') expect((b.text as { text: string }).text.length).toBeLessThan(3000)   // Slack's limit; the links are split over blocks
  })
  it('the folder link URL-encodes a prefix with spaces, an ampersand and non-ASCII characters (the slashes stay)', async () => {
    await publish.setSettings({ s3: { prefix: 'returns/B K&K/ü #1' } }); write('x/a.mov'); await go(['x'])
    expect(text()).toContain('?prefix=returns/B%20K%26K/%C3%BC%20%231/x/&region=us-west-2|'); expect(publish.consoleFolderUrl('b', 'a b/c&d/', 'eu-west-1')).toBe('https://s3.console.aws.amazon.com/s3/buckets/b?prefix=a%20b/c%26d/&region=eu-west-1')
  })
  it('one folder link per shot folder, at most five', async () => {
    const fs = ['085', '086', '087', '088', '089', '090', '091'].map((n) => folder(`archival-${n}`, 'v001', ['c.mov'])); await go(fs)
    expect(text().match(/Folder: </g)).toHaveLength(5); expect(text()).toContain('|archival-087 v001>'); expect(text()).not.toContain('archival-090 v001>')
  })
  it('the settings work independently: files off, folder off, both off', async () => {
    const f = folder(); await publish.setSettings({ slack: { file_links: false } }); await go([f]); expect(presigns()).toEqual([]); expect(text()).toContain('Folder: <'); expect(text()).not.toContain('X-Amz'); expect(posts[0].blocks).toBeDefined()
    posts.length = 0; await publish.setSettings({ slack: { file_links: true, folder_link: false } }); await go([f]); expect(text()).not.toContain('Folder:'); expect(text()).toContain('X-Amz-Signature')
    posts.length = 0; calls.length = 0; await publish.setSettings({ slack: { file_links: false } }); await go([f]); expect(text()).not.toMatch(/Folder:|X-Amz|https?:/); expect(posts[0].blocks).toBeUndefined(); expect(presigns()).toEqual([])
  })
  it('a presign failure leaves that one link out and adds a warning; the others stay', async () => {
    const f = folder('archival-085', 'v001', ['a.mov', 'b.mov', 'c.mov']); failPresign.add('b.mov'); const j = await go([f])
    expect(j.state).toBe('done'); expect(text()).toContain('|a.mov>'); expect(text()).toContain('|c.mov>'); expect(text()).not.toContain('|b.mov>'); expect(j.warnings).toEqual(['No link for b.mov: it could not be made'])
  })
  it('a custom S3 endpoint has no AWS console page: no folder link, the S3 address stays as text; a custom template with {links} still gets the links', async () => {
    await publish.setSettings({ s3: { endpoint: 'https://minio.example.test' } }); const f = folder(); await go([f], { message: 'Files:\n{links}\nTo {dest}' })
    expect(text()).not.toContain('console.aws'); expect(text()).toContain('To s3://my-bucket/returns/BKK/'); expect(text()).toMatch(/Files:\n• <https:\/\/s3\.example\/.*clip\.mov/)
  })
  it('no signed URL or console link is ever written to the History or the jobs file', async () => {
    const f = folder(); await go([f]); expect(JSON.stringify(history.list({ limit: 40 }))).not.toMatch(/X-Amz|console\.aws|sig\d/)
    const { readFileSync } = await import('node:fs'); expect(readFileSync(join(dir, 'publish-jobs.json'), 'utf8')).not.toMatch(/X-Amz|sig\d/)
  })
  it('the setting file_link_count is validated 1..25 and shown by settings()', async () => {
    await expect(publish.setSettings({ slack: { file_link_count: 0 } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/1 to 25/) }); await expect(publish.setSettings({ slack: { file_link_count: 26 } })).rejects.toMatchObject({ status: 400 })
    expect((await publish.setSettings({ slack: { file_link_count: 25, file_links: false, folder_link: false } })).slack).toMatchObject({ file_link_count: 25, file_links: false, folder_link: false })
  })
})
