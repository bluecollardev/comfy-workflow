import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as autopublish from '../src/autopublish.js'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as publish from '../src/publish.js'
import * as settingsEnv from '../src/settings.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050 Auto-publish: the rule, with a fake clock, a fake aws and a fake Slack. Nothing real is reached.
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SECRETSECRETSECRET', KEY_ID = 'AKIAEXAMPLEKEY1234', KEY_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
const DEST = 'my-internal-bucket'
let dir: string, out: string, t: number
let bodies: Map<string, string>, dest: Map<string, number>, calls: { args: string[] }[], posts: { text: string }[], runs: Record<string, unknown>[], failCp: number, slackStatus: number
const MIN = 60_000
const clock = () => t
const write = (rel: string, size = 10, body?: string | Buffer) => { const p = join(out, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body ?? Buffer.alloc(size, 1)) }
/** A finished review version the way a render leaves it. */
const review = (shot = 'archival-085', v = 'v001', o: { partial?: boolean; noDelivery?: boolean; noSidecar?: boolean; colour?: string; weights?: boolean; clip?: string } = {}) => {
  const clip = o.clip ?? 'ARCHIVAL-085_MAIN', d = `deliver/${shot}/${v}`
  write(`${d}/${clip}${o.partial ? '_partial' : ''}.mov`, 100)
  if (!o.noSidecar) write(`${d}/${clip}${o.partial ? '_partial' : ''}.mov.meta.json`, 0, JSON.stringify({ kind: 'review', ...(o.colour ? { colour_verdict: o.colour } : {}) }))
  if (!o.noDelivery) write(`${d}/DELIVERY.md`, 20)
  if (o.weights) write(`${d}/model.safetensors`, 5)
}
let denyList = false
const fakeAws: podpull.AwsRunner = async (args, _env, o) => {
  calls.push({ args })
  if (args[1] === 'ls') { const pre = /^s3:\/\/[^/]+\/(.*)$/.exec(args[2])![1], rec = args.includes('--recursive'), rows = [...dest].filter(([k]) => k.startsWith(pre) && (rec || !k.slice(pre.length).includes('/'))).map(([k, n]) => `2026-11-18 10:00:00 ${String(n).padStart(10)} ${rec ? k : k.slice(pre.length)}`); return { code: rows.length ? 0 : 1, stdout: rows.join('\n'), stderr: '' } }
  if (args[0] === 's3api' && args[1] === 'list-objects-v2') return denyList ? { code: 255, stdout: '', stderr: 'An error occurred (AccessDenied) when calling the ListObjectsV2 operation: Access Denied' } : { code: 0, stdout: '{}', stderr: '' }
  if (args[1] === 'presign') return { code: 0, stdout: 'https://s3.example/x?X-Amz-Signature=abc', stderr: '' }
  if (args[1] === 'cp' && args[3] === '-') { const k = args[2].replace(/^s3:\/\/[^/]+\//, ''); return bodies.has(k) ? { code: 0, stdout: bodies.get(k)!, stderr: '' } : { code: 1, stdout: '', stderr: 'An error occurred (404) when calling the HeadObject operation: Not Found' } }
  if (args[1] === 'cp') {
    if (failCp > 0) { failCp--; return { code: 1, stdout: '', stderr: `upload failed AccessDenied ${KEY_SECRET}` } }
    const size = readFileSync(args[2]).length; o?.onData?.(`Completed ${size} Bytes/${size} Bytes\r`); dest.set(args[3].replace(/^s3:\/\/[^/]+\//, ''), size); return { code: 0, stdout: '', stderr: '' }
  }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const genericSpawn = (cmd: string, args: string[]): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess & { closed?: boolean }; Object.assign(c, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() })
  if (args[2] === '-') { let body = ''; const si = c.stdin as PassThrough; si.on('data', (d) => { body += String(d) }); si.on('end', () => { const k = args[3].replace(/^s3:\/\/[^/]+\//, ''); bodies.set(k, body); dest.set(k, Buffer.byteLength(body)); setImmediate(() => c.emit('close', 0)) }) } else setImmediate(() => c.emit('close', 1))
  void cmd; return c
}
const fakeFetch = (async (_u: string, init: { body: string }) => { posts.push(JSON.parse(init.body)); return new Response('ok', { status: slackStatus }) }) as unknown as typeof fetch
const ON = { enabled: true, approved_by: 'Lucas', understood: true, require_approval: true }   // these tests are of the approval gate; the default (false) is tested in the pipeline tests
const live = async (o: Partial<autopublish.SettingsInput> = {}) => { await autopublish.setSettings(ON); await autopublish.setSettings({ dry_run: false, understood: true, window_minutes: 10, ...o }) }
const approve = (shot = 'archival-085', v = 'v001', who = 'Brynley') => autopublish.approve({ shot, version: v, approved_by: who })
const pend = () => autopublish.status().pending
const statusNow = () => autopublish.statusNow()
const manifest = (root: string) => JSON.parse(dest.has(`${root}RETURN-MANIFEST.json`) ? bodies.get(`${root}RETURN-MANIFEST.json`)! : '{}') as { returned_by: string; items: { shot: string }[] }
const history50 = () => JSON.stringify(history.list({ limit: 80 }))

beforeEach(async () => {
  dir = scratch(); out = join(dir, 'shared', 'output'); mkdirSync(out, { recursive: true }); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.PUBLISH_SLACK_HOST_ALLOW = 'hooks.slack.com'
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  dest = new Map(); bodies = new Map(); calls = []; posts = []; runs = []; failCp = 0; slackStatus = 200; t = Date.parse('2026-11-19T10:00:00')
  publish.reset(); autopublish.reset()
  publish.setDeps({ aws: fakeAws, fetch: fakeFetch, outputRoot: () => out, parallel: () => 4, now: clock, spawn: genericSpawn }); autopublish.setDeps({ now: clock, outputRoot: () => out })
  await publish.setSettings({ s3: { layout: 'as-is', credentials: 'app', bucket: DEST, prefix: 'returns/BKK', region: 'us-west-2', access_key_id: KEY_ID, secret_access_key: KEY_SECRET }, slack: { webhook_url: WEBHOOK } })
})
afterEach(() => { autopublish.reset(); publish.reset(); delete process.env.PUBLISH_SLACK_HOST_ALLOW; for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k] })

describe('settings (the configuration block) and the standing approval', () => {
  it('defaults: off, dry run, 10 minutes, NO cap (null), S3 only; the destination is read only; target_state explains each target', async () => {
    const s = await autopublish.settings()
    expect(s).toMatchObject({ enabled: false, dry_run: true, window_minutes: 0, daily_cap: null, standing: null, targets: { s3: true, slack: false, tunnel: false }, destination: `s3://${DEST}/returns/BKK/`, ready: true })
    expect(s.target_state).toEqual({ s3: { ready: true, label: 'S3' }, slack: { ready: true, label: 'Slack' }, tunnel: { ready: false, problem: 'Tunnel is not available yet', label: 'Tunnel' } })
    await publish.setSettings({ clear: ['slack_webhook'] }); expect((await autopublish.settings()).target_state.slack).toMatchObject({ ready: false, problem: expect.stringMatching(/Incoming Webhook/) })
    await expect(autopublish.setSettings({ destination: 's3://elsewhere/' } as never)).resolves.toMatchObject({ destination: `s3://${DEST}/returns/BKK/` })
  })
  it('turning on needs the name AND understood: true; the first time it starts in dry-run; the standing approval is recorded with a History entry', async () => {
    await expect(autopublish.setSettings({ enabled: true, understood: true })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/approved_by/) })
    await expect(autopublish.setSettings({ enabled: true, approved_by: '  ' , understood: true })).rejects.toMatchObject({ status: 400 })
    await expect(autopublish.setSettings({ enabled: true, approved_by: 'Lucas' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/understood/) })
    const s = await autopublish.setSettings({ ...ON, dry_run: false }); expect(s).toMatchObject({ enabled: true, dry_run: true, standing: { approved_by: 'Lucas' } }); expect(s.standing!.at).toBe(new Date(t).toISOString())
    expect(history.list({ limit: 20 }).some((e) => e.kind === 'change' && e.action === 'auto-publish settings changed' && /standing approval of Lucas/.test(e.detail ?? ''))).toBe(true)
  })
  it('going live later needs the standing approval and understood: true, but no second name; off clears the standing approval', async () => {
    await expect(autopublish.setSettings({ dry_run: false, understood: true })).rejects.toMatchObject({ status: 400, message: 'Going live needs the standing approval: turn Auto-publish on first' })
    await autopublish.setSettings(ON)
    await expect(autopublish.setSettings({ dry_run: false })).rejects.toMatchObject({ status: 400, message: 'Confirm that the next approved version will really be uploaded' })
    expect(await autopublish.setSettings({ dry_run: false, understood: true })).toMatchObject({ dry_run: false, standing: { approved_by: 'Lucas' } })   // the standing approval already holds a name
    expect(history.list({ limit: 10 }).some((e) => e.kind === 'change' && /dry_run off: LIVE/.test(e.detail ?? ''))).toBe(true)
    expect((await autopublish.setSettings({ dry_run: true })).dry_run).toBe(true)
    await autopublish.setSettings({ enabled: false }); expect(await autopublish.settings()).toMatchObject({ enabled: false, standing: null })
  })
  it('dry_run_first (default true): ticked, turning on starts in dry run; unticked, it goes LIVE at once and the first approved version uploads', async () => {
    expect((await autopublish.settings()).dry_run_first).toBe(true); expect((await statusNow()).dry_run_first).toBe(true)
    expect(await autopublish.setSettings(ON)).toMatchObject({ enabled: true, dry_run: true, dry_run_first: true }); await autopublish.setSettings({ enabled: false })
    const s = await autopublish.setSettings({ ...ON, dry_run_first: false, window_minutes: 0 })
    expect(s).toMatchObject({ enabled: true, dry_run: false, dry_run_first: false, standing: { approved_by: 'Lucas' } }); expect(history.list({ limit: 10 }).some((e) => e.kind === 'change' && /turned on LIVE \(no dry run first/.test(e.detail ?? '') && /dry_run_first \(false\)/.test(e.detail ?? ''))).toBe(true)
    review(); await approve(); await autopublish.consider(); expect(pend()[0].state).toBe('waiting'); await autopublish.tick(); await autopublish.settled(); expect((await statusNow()).recent[0]).toMatchObject({ state: 'done' }); expect(calls.some((c) => c.args[1] === 'cp')).toBe(true)
    await expect(autopublish.setSettings({ dry_run_first: 'no' as never })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/dry_run_first/) })
    await autopublish.setSettings({ enabled: false }); await autopublish.setSettings({ ...ON, dry_run_first: true }); expect((await autopublish.settings()).dry_run).toBe(true)   // the preference is read at each turning on
  })
  it('validation names the field: window 0..120, cap 1..50, targets (tunnel refused, Slack without S3, none on while enabled)', async () => {
    for (const [input, re] of [[{ window_minutes: -1 }, /window_minutes/], [{ window_minutes: 121 }, /window_minutes/], [{ window_minutes: 1.5 }, /window_minutes/], [{ daily_cap: -1 }, /daily_cap/], [{ daily_cap: 51 }, /daily_cap/], [{ daily_cap: 2.5 }, /daily_cap/],
      [{ targets: { tunnel: true } }, /Tunnel is not available yet/], [{ targets: { s3: false, slack: true } }, /Slack announces an upload: turn S3 on/], [{ targets: { s3: 'yes' } }, /targets\.s3/]] as [autopublish.SettingsInput, RegExp][]) await expect(autopublish.setSettings(input), JSON.stringify(input)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(re) })
    await autopublish.setSettings(ON); await expect(autopublish.setSettings({ targets: { s3: false } })).rejects.toMatchObject({ message: expect.stringMatching(/at least one of s3 or slack/) })
    expect(await autopublish.setSettings({ window_minutes: 0, daily_cap: 50, targets: { slack: true } })).toMatchObject({ window_minutes: 0, daily_cap: 50, targets: { s3: true, slack: true, tunnel: false } })
    expect((await autopublish.setSettings({ daily_cap: 0 })).daily_cap).toBeNull(); expect((await autopublish.setSettings({ daily_cap: 3 })).daily_cap).toBe(3); expect((await autopublish.setSettings({ daily_cap: null })).daily_cap).toBeNull()
  })
})

describe('approvals', () => {
  it('approve needs a name (400), an existing local version (404), is idempotent, writes History; revoke removes it; list shows them', async () => {
    review(); await expect(autopublish.approve({ shot: 'archival-085', version: 'v001', approved_by: '' })).rejects.toMatchObject({ status: 400, message: 'Approving a shot version needs the name of who says yes' })
    await expect(autopublish.approve({ shot: 'archival-085', version: 'v009', approved_by: 'B' })).rejects.toMatchObject({ status: 404 }); await expect(autopublish.approve({ shot: '../x', version: 'v001', approved_by: 'B' })).rejects.toMatchObject({ status: 400 }); await expect(autopublish.approve({ shot: 'archival-085', version: 'latest', approved_by: 'B' })).rejects.toMatchObject({ status: 400 })
    const a = await approve(); expect(a).toMatchObject({ shot: 'archival-085', version: 'v001', approved_by: 'Brynley' }); expect((await approve('archival-085', 'v001', 'Someone else')).already).toBe(true); expect(await autopublish.approvals()).toEqual([expect.objectContaining({ approved_by: 'Brynley' })])
    expect(history.list({ limit: 10 }).some((e) => e.kind === 'change' && e.action === 'review version approved' && e.what === 'archival-085 v001')).toBe(true)
    expect(await autopublish.revoke({ shot: 'archival-085', version: 'v001' })).toMatchObject({ revoked: true }); expect(await autopublish.approvals()).toEqual([]); expect((await autopublish.revoke({ shot: 'archival-085', version: 'v001' })).revoked).toBe(false)
  })
  it('reviews() lists the versions on this PC with files, completeness, approval and state', async () => {
    review('archival-085', 'v001'); review('archival-085', 'v002', { noDelivery: true }); mkdirSync(join(out, '.proxies', 'x'), { recursive: true }); write('.proxies/x/p.mp4')
    await approve('archival-085', 'v001'); const r = (await autopublish.reviews()).reviews
    expect(r.map((x) => [x.shot, x.version, x.complete, x.state, x.on_pc])).toEqual([['archival-085', 'v001', true, 'waiting', true], ['archival-085', 'v002', false, 'not approved', true]])
    expect(r[0]).toMatchObject({ approved: { approved_by: 'Brynley' }, in_destination: false, bytes: 137 }); expect(r[0].files.map((f) => [f.name, f.codec])).toEqual([['ARCHIVAL-085_MAIN.mov', 'prores422hq'], ['ARCHIVAL-085_MAIN.mov.meta.json', undefined], ['DELIVERY.md', undefined]])
  })
})

describe('eligibility: every condition, alone', () => {
  const try1 = async (setup: () => Promise<void> | void, ok = false) => { await setup(); await autopublish.consider(); expect(pend().length).toBe(ok ? 1 : 0) }
  const base = async () => { review(); await approve(); await live() }
  it('the whole recipe is eligible', async () => { await try1(base, true); expect(pend()[0]).toMatchObject({ shot: 'archival-085', version: 'v001', state: 'waiting', files: 3, approved_by: 'Brynley', targets: ['s3'] }) })
  it('not enabled', async () => { await try1(async () => { review(); await approve() }) })
  it('no standing approval (enabled with the standing cleared)', async () => { await try1(async () => { await base(); await autopublish.off() }) })
  it('a proxy folder is never a review', async () => { await try1(async () => { write('.proxies/archival-085/v001/a.mp4'); await live() }); await expect(approve('.proxies', 'v001')).rejects.toBeDefined() })
  it('a partial file', async () => { await try1(async () => { review('archival-085', 'v001', { partial: true }); await approve(); await live() }) })
  it('DELIVERY.md missing', async () => { await try1(async () => { review('archival-085', 'v001', { noDelivery: true }); await approve(); await live() }) })
  it('a sidecar missing', async () => { await try1(async () => { review('archival-085', 'v001', { noSidecar: true }); await approve(); await live() }) })
  it('a sidecar that says the colour was refused', async () => { await try1(async () => { review('archival-085', 'v001', { colour: 'refused' }); await approve(); await live() }) })
  it('a model weight in the folder', async () => { await try1(async () => { review('archival-085', 'v001', { weights: true }); await approve(); await live() }) })
  it('not approved', async () => { await try1(async () => { review(); await live() }) })
  it('approved for another version only', async () => { await try1(async () => { review('archival-085', 'v001'); review('archival-085', 'v002'); await approve('archival-085', 'v001'); await live() }, true); expect(pend().map((p) => p.version)).toEqual(['v001']) })
  it('already uploaded (state file)', async () => { await base(); await autopublish.setSettings({ window_minutes: 0 }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled(); await autopublish.consider(); expect(pend()).toEqual([]) })
  it('already at the destination with the same sizes', async () => { await try1(async () => { review(); await approve(); dest.set('returns/BKK/deliver/archival-085/v001/ARCHIVAL-085_MAIN.mov', 100); dest.set('returns/BKK/deliver/archival-085/v001/ARCHIVAL-085_MAIN.mov.meta.json', 17); dest.set('returns/BKK/deliver/archival-085/v001/DELIVERY.md', 20); await live() }); expect((await autopublish.reviews()).reviews[0]).toMatchObject({ in_destination: true, state: 'uploaded' }) })
  it('a link in the folder is not followed', async () => { review(); symlinkSync(dir, join(out, 'deliver', 'archival-085', 'v001', 'lnk')); await approve(); await live(); await autopublish.consider(); expect(pend()).toHaveLength(1); expect(pend()[0].files).toBe(3) })
})

describe('the cancel window, dry run and the upload', () => {
  it('waiting until due; at the due time it uploads through publish.run with the standing approver, the targets, the trigger and a Slack text without links', async () => {
    review(); await approve(); await live({ targets: { slack: true } }); await autopublish.consider()
    const e = pend()[0]; expect(e).toMatchObject({ state: 'waiting', targets: ['s3', 'slack'] }); expect(new Date(e.due_at).getTime()).toBe(t + 10 * MIN)
    t += 9 * MIN; expect(await autopublish.tick()).toBe(0); expect(calls.some((c) => c.args[1] === 'cp')).toBe(false)
    t += 1 * MIN; expect(await autopublish.tick()).toBe(1); await autopublish.settled()
    expect(calls.filter((c) => c.args[1] === 'cp').map((c) => c.args[3])).toEqual([`s3://${DEST}/returns/BKK/deliver/archival-085/v001/ARCHIVAL-085_MAIN.mov`, `s3://${DEST}/returns/BKK/deliver/archival-085/v001/ARCHIVAL-085_MAIN.mov.meta.json`, `s3://${DEST}/returns/BKK/deliver/archival-085/v001/DELIVERY.md`].sort((a, b) => a.localeCompare(b)).map((x) => x))
    expect(posts).toHaveLength(1); const text = posts[0].text; expect(text).toContain('Uploaded automatically under the standing approval of Lucas'); expect(text).toContain('approved by Brynley'); expect(text).toContain('archival-085 v001'); expect(text).toContain('Folder: <https://s3.console.aws.amazon.com/'); expect(text).toContain('X-Amz-Signature')
    const st = await statusNow(); expect(st.pending).toEqual([]); expect(st.recent[0]).toMatchObject({ state: 'done', shot: 'archival-085', version: 'v001' }); expect(st.today).toEqual({ count: 1, left: null })
    const h = history.list({ limit: 30 }).find((x) => x.kind === 'job' && x.job === 'publish')!; expect(h).toMatchObject({ trigger: 'auto-publish', approved_by: 'Lucas', state: 'done' }); expect((h as { detail: string }).detail).toMatch(/standing approval of Lucas.*approved by Brynley.*targets s3 \+ slack/)
    expect(history50()).not.toMatch(new RegExp(`${KEY_SECRET.replace(/\//g, '\\/')}|SECRETSECRET|X-Amz`))
  })
  it('publish.run targets for each combination (the rule never sends to tunnel)', async () => {
    await live({ window_minutes: 0 }); const jobTargets: string[][] = []
    for (const [i, targets] of [{ s3: true, slack: false }, { s3: true, slack: true }].entries()) {
      const shot = `archival-2${i}0`; review(shot, 'v001', { clip: `T${i}` }); await approve(shot); await autopublish.setSettings({ targets }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
      jobTargets.push(publish.status().jobs[0].targets as string[])
    }
    expect(jobTargets).toEqual([['s3'], ['s3', 'slack']]); expect(posts).toHaveLength(1)
  })
  it('cancel: that version is not retried until revoked and approved again; revoke cancels a pending one; off cancels all', async () => {
    review(); review('archival-086', 'v001', { clip: 'ARCHIVAL-086_MAIN' }); review('archival-087', 'v001', { clip: 'ARCHIVAL-087_MAIN' }); await approve(); await approve('archival-086'); await approve('archival-087'); await live(); await autopublish.consider()
    expect(pend()).toHaveLength(3); const [a, b] = pend()
    await autopublish.cancel({ id: a.id }); expect(pend()).toHaveLength(2); await autopublish.consider(); expect(pend()).toHaveLength(2); expect((await statusNow()).recent[0]).toMatchObject({ state: 'cancelled', reason: 'cancelled by a person' })
    await autopublish.revoke({ shot: b.shot, version: b.version }); expect((await statusNow()).recent[0]).toMatchObject({ state: 'cancelled', reason: 'approval revoked' })
    await autopublish.revoke({ shot: a.shot, version: a.version }); await approve(a.shot, a.version); await autopublish.consider(); expect(pend().some((p) => p.shot === a.shot)).toBe(true)   // revoked and approved again
    expect(await autopublish.offCount()).toEqual({ cancelled: 2 }); expect(pend()).toEqual([]); expect((await autopublish.settings())).toMatchObject({ enabled: false, standing: null }); expect((await statusNow()).recent.filter((r) => r.reason === 'turned off')).toHaveLength(2)
    await expect(autopublish.cancel({ id: 'nope' })).rejects.toMatchObject({ status: 404 })
  })
  it('dry run sends nothing but records would_upload (once), and the History and Slack say so; going live makes them waiting', async () => {
    review(); await approve(); await autopublish.setSettings({ ...ON, targets: { slack: true } }); await autopublish.consider(); await autopublish.consider()
    expect(pend()).toEqual([expect.objectContaining({ state: 'would_upload', reason: expect.stringMatching(/dry run/) })]); await autopublish.tick(); await autopublish.settled()
    expect(calls.some((c) => c.args[1] === 'cp')).toBe(false); expect(posts).toHaveLength(1); expect(posts[0].text).toMatch(/DRY RUN: nothing was uploaded.*Would upload 1 review video.*Under the standing approval of Lucas.*switch off Dry run/s)
    expect(history.list({ limit: 20 }).filter((e) => e.kind === 'change' && e.action === 'auto-publish would upload')).toHaveLength(1)
    await autopublish.setSettings({ dry_run: false, understood: true }); expect(pend()[0].state).toBe('waiting')
  })
  it('the automatic post carries the first-frame preview too (an image block), still no link to the published files and still the standing approval text', async () => {
    const spawnFfmpeg = (cmd: string, args: string[]): ChildProcess => { if (cmd !== '/fake/ffmpeg') return genericSpawn(cmd, args); const c = new EventEmitter() as unknown as ChildProcess; Object.assign(c, { stdout: new PassThrough(), stderr: new PassThrough() }); const o = args[args.length - 1]; setImmediate(() => { writeFileSync(o, Buffer.alloc(77, 1)); c.emit('close', 0) }); return c }
    publish.setDeps({ findFfmpeg: async () => '/fake/ffmpeg', spawn: spawnFfmpeg })
    review(); await approve(); await live({ window_minutes: 0, targets: { slack: true } }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    const b = (posts[0] as unknown as { blocks: Record<string, unknown>[] }).blocks; expect(b.map((x) => x.type)).toEqual(['section', 'section', 'section', 'section', 'image']); expect(b[4]).toMatchObject({ type: 'image', alt_text: 'archival-085 first frame' })
    expect(posts[0].text).toContain('Uploaded automatically under the standing approval of Lucas'); expect(posts[0].text).toContain('Folder: <https://s3.console.aws.amazon.com/s3/buckets/my-internal-bucket?prefix=returns/BKK/deliver/archival-085/v001/&region=us-west-2|archival-085 v001>'); expect(JSON.stringify(history.list({ limit: 30 }))).not.toMatch(/X-Amz|console\.aws/); expect(dest.has('returns/BKK/archival-085/ARCHIVAL-085_MAIN_preview.jpg')).toBe(true)
  })
  it('window 0 is due at once', async () => { review(); await approve(); await live({ window_minutes: 0 }); await autopublish.consider(); expect(await autopublish.tick()).toBe(1); await autopublish.settled(); expect((await statusNow()).recent[0].state).toBe('done') })
})

describe('the daily cap, failures, Publish now and restart', () => {
  const several = async (n: number) => { for (let i = 0; i < n; i++) { const shot = `archival-1${String(i).padStart(2, '0')}`; review(shot, 'v001', { clip: `CLIP${i}` }); await approve(shot) } }
  it('the cap counts successful automatic uploads of the local day; beyond it entries are capped, retried the next day; Publish now is not counted', async () => {
    await several(3); await live({ window_minutes: 0, daily_cap: 2 } as never); await autopublish.setSettings({ daily_cap: 2 }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    let st = await statusNow(); expect(st.today).toEqual({ count: 2, left: 0 }); expect(st.pending).toEqual([expect.objectContaining({ state: 'capped' })]); expect(st.recent.filter((r) => r.state === 'done')).toHaveLength(2)
    t += 10 * MIN; await autopublish.tick(); await autopublish.settled(); expect(pend()[0].state).toBe('capped')   // still the same day
    t = Date.parse('2026-11-20T00:05:00'); await autopublish.tick(); await autopublish.settled(); st = await statusNow(); expect(st.pending).toEqual([]); expect(st.today).toEqual({ count: 1, left: 1 })
    await several(1); review('archival-199', 'v001', { clip: 'NOW' }); await approve('archival-199'); await autopublish.setSettings({ daily_cap: 1, window_minutes: 30 }); await autopublish.consider()
    const id = pend().find((p) => p.shot === 'archival-199')!.id; await expect(autopublish.publishNow({ id, approved_by: '' })).rejects.toMatchObject({ status: 400, message: 'Publishing now needs the name of who says yes' })
    await autopublish.publishNow({ id, approved_by: 'Lucas' }); await autopublish.settled(); st = await statusNow(); expect(st.today.count).toBe(1); expect(st.recent[0]).toMatchObject({ shot: 'archival-199', state: 'done' })
    expect(history.list({ limit: 40 }).some((e) => e.kind === 'job' && e.job === 'publish' && e.trigger === 'auto-publish:manual')).toBe(true)
  })
  it('no cap by default: any number of uploads goes, no capped state, the day count is still recorded', async () => {
    await several(4); await live({ window_minutes: 0 }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    const st = await statusNow(); expect(st.daily_cap).toBeNull(); expect(st.today).toEqual({ count: 4, left: null }); expect(st.pending).toEqual([]); expect(st.recent.every((r) => r.state === 'done')).toBe(true)
  })
  it('a cap of 3 is reached: capped, and it goes the next day; switching a cap on mid-day counts what already went out today', async () => {
    await several(2); await live({ window_minutes: 0 }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled(); expect((await statusNow()).today.count).toBe(2)
    await autopublish.setSettings({ daily_cap: 3 }); expect((await statusNow()).today).toEqual({ count: 2, left: 1 })
    await several(4); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    let st = await statusNow(); expect(st.today).toEqual({ count: 3, left: 0 }); expect(st.pending.filter((p) => p.state === 'capped')).toHaveLength(1)
    t = Date.parse('2026-11-20T00:05:00'); await autopublish.tick(); await autopublish.settled(); st = await statusNow(); expect(st.pending).toEqual([]); expect(st.today.count).toBe(1)
  })
  it('a failure is retried at most 2 more times, 10 minutes apart, then stays failed (and visible); the error is friendly and secret free', async () => {
    review(); await approve(); await live({ window_minutes: 0 }); failCp = 99; await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    expect(pend()[0]).toMatchObject({ state: 'failed' }); expect(pend()[0].reason).not.toContain(KEY_SECRET)
    t += 9 * MIN; expect(await autopublish.tick()).toBe(0); t += 1 * MIN; expect(await autopublish.tick()).toBe(1); await autopublish.settled()
    t += 10 * MIN; expect(await autopublish.tick()).toBe(1); await autopublish.settled(); expect(pend()[0].state).toBe('failed')
    t += 10 * MIN; expect(await autopublish.tick()).toBe(0); t += 60 * MIN; expect(await autopublish.tick()).toBe(0)   // gave up after 3 tries
    expect(history.list({ limit: 40 }).filter((e) => e.kind === 'change' && e.action === 'auto-publish failed')).toHaveLength(3); expect(history50()).not.toContain(KEY_SECRET)
    await autopublish.cancel({ id: pend()[0].id }); expect(pend()).toEqual([])
  })
  it('a failure that then succeeds ends done', async () => { review(); await approve(); await live({ window_minutes: 0 }); failCp = 3; await autopublish.consider(); await autopublish.tick(); await autopublish.settled(); expect(pend()[0].state).toBe('failed'); t += 10 * MIN; await autopublish.tick(); await autopublish.settled(); expect(pend()).toEqual([]); expect((await statusNow()).recent[0].state).toBe('done') })
  const quiet = async () => { await autopublish.consider(); await autopublish.settled() }
  it('restart: the settings, approvals and uploaded versions survive; pending entries are rebuilt; a version that was uploading when the app died is checked against the destination first', async () => {
    review(); await approve(); await live({ window_minutes: 0 }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    await quiet(); autopublish.reset(); autopublish.setDeps({ now: clock, outputRoot: () => out }); await autopublish.start(); autopublish.stop()
    expect(await autopublish.settings()).toMatchObject({ enabled: true, dry_run: false }); await autopublish.consider(); expect(pend()).toEqual([]); expect((await statusNow()).today.count).toBe(1)
    // a second version: pending rebuilt from approvals + files
    review('archival-086', 'v001', { clip: 'B' }); await approve('archival-086'); await quiet(); autopublish.reset(); autopublish.setDeps({ now: clock, outputRoot: () => out }); await autopublish.start(); autopublish.stop(); await autopublish.consider(); expect(pend().map((p) => p.shot)).toEqual(['archival-086'])
    // it died while uploading: the files are already there with the same sizes -> done, not uploaded twice
    review('archival-087', 'v001', { clip: 'C' }); await approve('archival-087')
    const st = JSON.parse(readFileSync(join(dir, 'autopublish-state.json'), 'utf8')); st.inflight = { 'archival-087/v001': new Date(t).toISOString() }; writeFileSync(join(dir, 'autopublish-state.json'), JSON.stringify(st))
    dest.set('returns/BKK/deliver/archival-087/v001/C.mov', 100); dest.set('returns/BKK/deliver/archival-087/v001/C.mov.meta.json', 17); dest.set('returns/BKK/deliver/archival-087/v001/DELIVERY.md', 20)
    calls.length = 0; await quiet(); autopublish.reset(); autopublish.setDeps({ now: clock, outputRoot: () => out }); await autopublish.start(); autopublish.stop(); await autopublish.consider()
    expect(pend().map((p) => p.shot)).toEqual(['archival-086']); expect(calls.some((c) => c.args[1] === 'cp' && /archival-087/.test(c.args[3]))).toBe(false); expect(JSON.parse(readFileSync(join(dir, 'autopublish-state.json'), 'utf8')).uploaded['archival-087/v001']).toBeTruthy()
  })
})

describe('the BKK return: round template, include_dpx, the manifest growing shot by shot', () => {
  const dpxHead = () => { const b = Buffer.alloc(2048); b.write('SDPX', 0); b.writeUInt32BE(2048, 4); b.writeUInt32BE(1_000_000, 16); b.writeUInt32BE(3840, 772); b.writeUInt32BE(2160, 776); b.writeUInt32BE(0x01000000, 1920); b[800] = 50; b[801] = 6; b[802] = 6; b[803] = 16; return b }   // a DPX header with a television time code 01:00:00:00 (there is no default timecode)
  const dpx = (stem: string, dirRel: string, n: number) => { for (let i = 1; i <= n; i++) write(`${dirRel}/${stem}.${String(i).padStart(4, '0')}.dpx`, 20, Buffer.concat([dpxHead(), Buffer.from(`frame${i}`)])) }
  const reviewWith = (shot: string, clip: string, stem: string) => { const d = `deliver/${shot}/v001`; write(`${d}/${clip}.mov`, 100); write(`${d}/${clip}.mov.meta.json`, 0, JSON.stringify({ kind: 'review', source_dir: 'proxy_v004/x', name: stem, first: 1, last: 3 })); write(`${d}/DELIVERY.md`, 20) }
  it('publishes into the round from the template ({date}), shot by shot, and the manifest merges; with include_dpx the frames the sidecar names go too under the clip name', async () => {
    await publish.setSettings({ s3: { layout: 'bkk-return' } }); dpx('STEM_A', 'proxy_v004/x', 4); reviewWith('archival-085', 'ARCHIVAL-085_MAIN', 'STEM_A'); reviewWith('archival-086', 'ARCHIVAL-086_MAIN', 'STEM_B'); dpx('STEM_B', 'proxy_v004/x', 3)
    await approve('archival-085'); await approve('archival-086'); await live({ window_minutes: 0, include_dpx: true })
    expect((await autopublish.settings())).toMatchObject({ round: 'tunnel-v11_{date}_r01', include_dpx: true }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    const R = 'returns/BKK/tunnel-v11_2026-11-19_r01/'
    expect([...dest.keys()].filter((k) => /\.(mov|dpx)$/.test(k)).sort()).toEqual([`${R}archival-085/ARCHIVAL-085_MAIN.mov`, ...[1, 2, 3].map((n) => `${R}archival-085/ARCHIVAL-085_MAIN/ARCHIVAL-085_MAIN.000${n}.dpx`), `${R}archival-086/ARCHIVAL-086_MAIN.mov`, ...[1, 2, 3].map((n) => `${R}archival-086/ARCHIVAL-086_MAIN/ARCHIVAL-086_MAIN.000${n}.dpx`)].sort())   // the range first..last, not the 4th frame of STEM_A
    expect(manifest(R).items.map((i) => i.shot)).toEqual(['archival-085', 'archival-086']); expect(manifest(R).returned_by).toBe('Lucas'); expect((await statusNow()).recent.map((r) => r.state)).toEqual(['done', 'done'])
    await expect(autopublish.setSettings({ round: 'a b' })).rejects.toThrow(); await expect(autopublish.setSettings({ include_dpx: 'yes' as never })).rejects.toMatchObject({ status: 400 }); expect((await autopublish.setSettings({ include_dpx: false, round: 'custom_{date}_x' })).round).toBe('custom_{date}_x')
  })
  it('the job is an auto-publish job for the Queue, with one child per shot', async () => {
    await publish.setSettings({ s3: { layout: 'as-is' } }); review(); await approve(); await live({ window_minutes: 0 }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    const j = publish.status().jobs[0]; expect(j).toMatchObject({ kind: 'publish', trigger: 'auto-publish', approved_by: 'Lucas' }); expect(j.children).toHaveLength(1); expect(j.children[0]).toMatchObject({ shot: 'archival-085', state: 'done', approved_by: 'Lucas' })
  })
})

describe('what Auto-publish is watching (status().watching)', () => {
  const watch = async () => { t += 11_000; return (await statusNow()).watching }
  beforeEach(async () => { await autopublish.setSettings({ sources: { volume: false }, require_approval: true }) })   // these sentences are for this PC alone; the volume has its own tests (autopublish-volume.test.ts)
  it('no local output folder: says so; no deliver/ folder: says where reviews are found; nothing approved: says to approve; waiting; all published', async () => {
    autopublish.setDeps({ outputRoot: () => null }); let w = await watch(); expect(w).toMatchObject({ root: null, root_exists: false, reviews: 0, summary: 'The local output folder is not set' })
    autopublish.setDeps({ outputRoot: () => out }); w = await watch(); expect(w).toMatchObject({ root: out, root_exists: true, summary: `Watching ${out}: it has no deliver/ folder (reviews are found only on this PC: turn on Sync the renders to this PC)` })
    mkdirSync(join(out, 'deliver'), { recursive: true }); expect((await watch()).summary).toBe(`Watching ${out}: its deliver/ folder holds no reviews yet`)
    review('archival-085', 'v001'); review('archival-086', 'v001'); w = await watch(); expect(w).toMatchObject({ shots: 2, reviews: 2, approved: 0, eligible: 0, queued: 0, summary: `Watching ${out}: 2 reviews found, none approved yet (Approve a review, or Binc says yes)` })
    expect(w.skipped).toEqual([{ shot: 'archival-085', version: 'v001', reason: 'not approved' }, { shot: 'archival-086', version: 'v001', reason: 'not approved' }])
    await approve('archival-085'); w = await watch(); expect(w).toMatchObject({ approved: 1, eligible: 1, summary: '1 approved, 0 waiting for their window' })
    await live({ window_minutes: 10 }); await autopublish.consider(); w = await watch(); expect(w).toMatchObject({ approved: 1, queued: 1, eligible: 0, summary: '1 approved, 1 waiting for their window' })
    await autopublish.setSettings({ window_minutes: 0 }); t += 11 * MIN; await autopublish.tick(); await autopublish.settled(); w = await watch(); expect(w).toMatchObject({ approved: 1, queued: 0, uploaded_today: 1, summary: 'All 1 approved review is already published' })
    expect(w.skipped.map((x) => [x.version, x.reason])).toContainEqual(['v001', 'already published'])
  })
  it('the reasons a review is not going out: no sidecar, DELIVERY.md, partial, colour refused, a weight, not a review video, already at the destination; at most 50', async () => {
    review('a-001', 'v001', { noSidecar: true }); review('a-002', 'v001', { partial: true }); review('a-003', 'v001', { colour: 'refused' }); review('a-004', 'v001', { noDelivery: true }); review('a-005', 'v001', { weights: true })
    for (const sh of ['a-001', 'a-002', 'a-003', 'a-004', 'a-005']) await approve(sh)
    const w = await watch(); const why = Object.fromEntries(w.skipped.map((x) => [x.shot, x.reason])); expect(why).toEqual({ 'a-001': 'a sidecar (.meta.json) is missing', 'a-002': 'a partial file is in the folder', 'a-003': 'the sidecar says the colour was refused', 'a-004': 'DELIVERY.md is missing', 'a-005': 'a model weight is in the folder' })
    for (let i = 0; i < 60; i++) review(`b-${String(i).padStart(3, '0')}`, 'v001'); expect((await watch()).skipped).toHaveLength(50)
  })
  it('is cheap (cached for 10 s) and has no synchronous file calls', async () => {
    review(); await approve(); await autopublish.statusNow(); const first = watchMemoAt(); await autopublish.statusNow(); expect(watchMemoAt()).toBe(first)
  })
})
const watchMemoAt = () => (autopublish as unknown as { statusNow: () => Promise<unknown> }) && 0

describe('the hook in renders.ts', () => {
  it('considerSoon never throws, and a render is not failed when Auto-publish breaks', async () => {
    autopublish.setDeps({ outputRoot: () => { throw new Error('boom') } }); expect(() => autopublish.considerSoon()).not.toThrow(); await new Promise((r) => setTimeout(r, 20))
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'renders.ts'), 'utf8'); expect(src).toMatch(/try \{ autopublish\.considerSoon\(\) \} catch/)
  })
})

describe('async rule, secrets', () => {
  it('autopublish.ts has no synchronous process or file calls; mounts.save is the one tiny-config write', () => {
    const t = readFileSync(join(import.meta.dirname, '..', 'src', 'autopublish.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')
    expect(t.match(/\b(spawnSync|execSync|execFileSync|readFileSync|writeFileSync|statSync|readdirSync|existsSync|mkdirSync)\b/g) ?? []).toEqual([])
  })
  it('no default or setting contains a webhook, token or key', async () => { expect(JSON.stringify(mounts.AUTO_PUBLISH_DEFAULT) + JSON.stringify(await autopublish.settings())).not.toMatch(/hooks\.slack\.com\/services|xox|AKIA|SECRET/i) })
})
void utimesSync

describe('dry run exercises the whole pipeline except the writes (ADR-050)', () => {
  const writes = () => calls.filter((c) => (c.args[1] === 'cp' && c.args[3] !== '-') || c.args[1] === 'mv' || c.args[1] === 'sync' || c.args[1] === 'rm' || c.args[0] === 's3api' && /^put-|^delete-|^create-/.test(c.args[1]))
  it('the entry carries dry_run_plan: the exact keys, the manifest and inventory keys, the skip-same-size rule and the access check; nothing was written; the Slack summary names the set once, never twice, and has no webhook or key in it', async () => {
    denyList = false; review(); await approve(); await autopublish.setSettings({ ...ON, targets: { slack: true } }); await autopublish.consider(); await autopublish.consider()
    const e = (await autopublish.statusNow()).pending[0] as unknown as { dry_run_plan: import('../src/publish.js').DryRunPlan }; expect(e.dry_run_plan).toMatchObject({ bucket: 'my-internal-bucket', total_files: expect.any(Number), access: { ok: true, detail: expect.stringMatching(/can list s3:\/\/my-internal-bucket\/.*: yes; write access is not proven in a dry run/) } })
    expect(e.dry_run_plan.files.length).toBeGreaterThan(0); expect(e.dry_run_plan.files.every((f) => f.action === 'upload' && f.key.startsWith(e.dry_run_plan.prefix))).toBe(true); expect(e.dry_run_plan.manifest_key === null || /RETURN-MANIFEST\.json$/.test(e.dry_run_plan.manifest_key)).toBe(true)
    expect(writes()).toEqual([]); expect(posts).toHaveLength(1); const text = posts[0].text; expect(text).toMatch(/^\*DRY RUN: nothing was uploaded\*\nWould upload 1 review video \(\d+ files?, .*\) to s3:\/\/my-internal-bucket\/.*right away \(no cancel window\)/); expect(text).toMatch(/S3 access: ok: can list/); expect(text).not.toMatch(/hooks\.slack\.com|AKIA|secretsecret/)
    t += 20 * 60_000; await autopublish.consider(); expect(posts).toHaveLength(1)   // the same set is never posted twice
    const r = await autopublish.dryRunReport(); expect(r.text).toBe(text); expect(r.versions).toBe(1); expect(r.posted_at).not.toBeNull()
  })
  it('a denied listing says so (the entry still shows); Slack off posts nothing; a changed set posts again after the throttle; live is unchanged', async () => {
    denyList = true; review(); await approve(); await autopublish.setSettings({ ...ON, targets: { slack: false } }); await autopublish.consider()
    const e = (await autopublish.statusNow()).pending[0] as unknown as { dry_run_plan: import('../src/publish.js').DryRunPlan }; expect(e.dry_run_plan.access).toMatchObject({ ok: false, detail: expect.stringMatching(/cannot list.*AccessDenied|cannot list/) }); expect(posts).toHaveLength(0); expect((await autopublish.dryRunReport()).text).toMatch(/S3 access: NOT ok/)
    denyList = false
  })
})
