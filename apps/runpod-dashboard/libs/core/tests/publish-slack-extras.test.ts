import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import * as history from '../src/history.js'
import * as publish from '../src/publish.js'
import * as settingsEnv from '../src/settings.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050 "Slack previews": a first-frame image and the source on the volume in the Slack post. Fakes only: ffmpeg, aws, Slack.
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SECRETSECRETSECRET', SIGNED = 'https://s3.example/x?X-Amz-Signature=abc123'
const FF = '/fake/ffmpeg', VOLB = 'vol1', O = 'comfy-shared/output/'
let dir: string, out: string, calls: { args: string[] }[], posts: { text: string; blocks?: Record<string, unknown>[] }[], ffmpeg: { args: string[] }[], dest: Map<string, number>, vol: Map<string, number>
let ffmpegOk: boolean, ffmpegFound: boolean, presignOk: boolean, outsMade: string[], dc: string, record: boolean

const write = (rel: string, size = 10, body?: string) => { const p = join(out, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body ?? Buffer.alloc(size, 1)) }
const fakeAws: podpull.AwsRunner = async (args, _env, o) => {
  calls.push({ args })
  if (args[1] === 'presign') return presignOk ? { code: 0, stdout: `${SIGNED}\n`, stderr: '' } : { code: 255, stdout: '', stderr: 'boom' }
  if (args[1] === 'ls') {
    const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(args[2])!, store = m[1] === VOLB ? vol : dest, pre = m[2], rec = args.includes('--recursive')
    const rows = [...store].filter(([k]) => k.startsWith(pre) && (rec || !k.slice(pre.length).includes('/'))).map(([k, n]) => `2026-11-18 10:00:00 ${String(n).padStart(10)} ${rec ? k : k.slice(pre.length)}`)
    return { code: rows.length ? 0 : 1, stdout: rows.join('\n'), stderr: '' }
  }
  if (args[1] === 'cp') { const src = args[2]; dest.set(args[3].replace(/^s3:\/\/[^/]+\//, ''), existsSync(src) ? readFileSync(src).length : 1); o?.onData?.('Completed 1 Bytes/1 Bytes\r'); return { code: 0, stdout: '', stderr: '' } }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const fakeSpawn = (cmd: string, args: string[]): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess & { closed?: boolean }, so = new PassThrough(), se = new PassThrough(), si = new PassThrough(); Object.assign(c, { stdout: so, stderr: se, stdin: si })
  const close = (code: number | null) => { if (!c.closed) { c.closed = true; c.emit('close', code) } }
  ;(c as unknown as { kill: () => boolean }).kill = () => { setImmediate(() => close(null)); return true }
  if (cmd === FF) { ffmpeg.push({ args }); const o = args[args.length - 1]; outsMade.push(o); setImmediate(() => { if (ffmpegOk) writeFileSync(o, Buffer.alloc(321, 7)); close(ffmpegOk ? 0 : 1) }) }
  else if (args[3] === '-') { const n = vol.get(args[2].replace(/^s3:\/\/[^/]+\//, '')) ?? 0; setImmediate(() => { so.write(Buffer.alloc(n, 2)); so.end(); setImmediate(() => close(0)) }) }
  else if (args[2] === '-') { si.on('data', () => undefined); si.on('end', () => { dest.set(args[3].replace(/^s3:\/\/[^/]+\//, ''), 1); setImmediate(() => close(0)) }) }
  return c
}
const fakeFetch = (async (_u: string, init: { body: string }) => { posts.push(JSON.parse(init.body)); return new Response('ok') }) as unknown as typeof fetch
const finish = async (id: string) => { await publish.settled(); return publish.status(id).jobs[0] }
const go = async (items: unknown[], o: Record<string, unknown> = {}) => { const { job_id } = await publish.run({ items, targets: ['s3', 'slack'], approved_by: 'Lucas', ...o }); return finish(job_id) }
const clipFile = (shot: string, clip: string, v = 'v001') => { write(`deliver/${shot}/${v}/${clip}.mov`, 100); return `deliver/${shot}/${v}/${clip}.mov` }

beforeEach(async () => {
  dir = scratch(); out = join(dir, 'shared', 'output'); mkdirSync(out, { recursive: true }); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.PUBLISH_SLACK_HOST_ALLOW = 'hooks.slack.com'
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  calls = []; posts = []; ffmpeg = []; dest = new Map(); outsMade = []; ffmpegOk = true; ffmpegFound = true; presignOk = true; dc = 'EU-RO-1'; record = true
  vol = new Map([[`${O}delivery_v007/a.mov`, 40], [`${O}delivery_v007/b.mov`, 50]])
  publish.reset(); publish.setDeps({ aws: fakeAws, fetch: fakeFetch, outputRoot: () => out, parallel: () => 4, spawn: fakeSpawn, findFfmpeg: async () => (ffmpegFound ? FF : null), volumeId: () => VOLB,
    volumeRecord: async () => (record ? { id: VOLB, name: 'Shared volume', datacenter: dc } : null), volumeAccess: async () => ({ ok: true, id: 'RPKEY', secret: 'RPSECRET', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: VOLB, region: 'EU-RO-1' }) })
  await publish.setSettings({ s3: { credentials: 'app', bucket: 'my-internal-bucket', prefix: 'renders', region: 'us-west-2', access_key_id: 'AKIAEXAMPLEKEY1234', secret_access_key: 'secretsecretsecret1234' }, slack: { webhook_url: WEBHOOK, file_links: false, folder_link: false } })   // the links have their own tests (publish-links.test.ts)
})
afterEach(() => { publish.reset(); delete process.env.PUBLISH_SLACK_HOST_ALLOW; for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k] })

describe('the preview frame', () => {
  it('a video: its first frame by ffmpeg (array arguments, a plain scale), uploaded next to the files as <shot>/<clip>_preview.jpg, flagged apart, and an image block in the post', async () => {
    const f = clipFile('archival-085', 'ARCHIVAL-085_MAIN'); const j = await go([f])
    expect(ffmpeg).toHaveLength(1); expect(ffmpeg[0].args).toEqual(['-y', '-nostdin', '-loglevel', 'error', '-i', join(out, f), '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', outsMade[0]])
    expect(outsMade[0]).toMatch(/cache\/publish-previews\/.+-0\.jpg$/); expect(existsSync(outsMade[0])).toBe(false)   // the temp file is gone
    expect(dest.get('renders/archival-085/ARCHIVAL-085_MAIN_preview.jpg')).toBe(321); expect(j.previews).toEqual([{ name: 'ARCHIVAL-085_MAIN_preview.jpg', s3_key: 'renders/archival-085/ARCHIVAL-085_MAIN_preview.jpg', bytes: 321, preview: true }]); expect(j).toMatchObject({ state: 'done', files_total: 1, files_done: 1 })
    expect(posts).toHaveLength(1); const b = posts[0].blocks!; expect(posts[0].text).toContain('Published from RunPod Manager')
    expect(b.map((x) => x.type)).toEqual(['section', 'section', 'image']); expect((b[0].text as { text: string }).text).toBe(posts[0].text); expect((b[1].text as { text: string }).text).toBe('*archival-085* ARCHIVAL-085_MAIN.mov (100 B)'); expect(b[2]).toEqual({ type: 'image', image_url: SIGNED, alt_text: 'archival-085 first frame' })
    expect(JSON.stringify(history.list({ limit: 30 }))).not.toMatch(/X-Amz|abc123/); expect(JSON.stringify(j.previews)).not.toMatch(/abc123|https/); expect(readFileSync(join(dir, 'publish-jobs.json'), 'utf8')).not.toMatch(/abc123/)
  })
  it('a DPX sequence: the lowest-numbered frame goes through ffmpeg the same way', async () => {
    for (const n of ['0003', '0001', '0002']) write(`seqs/corrosion-015_L/corrosion-015_L.${n}.dpx`, 50)
    const j = await go(['seqs/corrosion-015_L']); expect(j.state).toBe('done'); expect(ffmpeg[0].args[ffmpeg[0].args.indexOf('-i') + 1]).toBe(join(out, 'seqs/corrosion-015_L/corrosion-015_L.0001.dpx'))
    expect(j.previews![0]).toMatchObject({ name: 'corrosion-015_L_preview.jpg', s3_key: 'renders/corrosion-015/corrosion-015_L_preview.jpg' })
  })
  it('up to 3 previews, the first three clips (different shots) in the list', async () => {
    const files = ['085', '086', '087', '088', '089'].map((n) => clipFile(`archival-${n}`, `ARCHIVAL-${n}_MAIN`)); const j = await go(files)
    expect(ffmpeg).toHaveLength(3); expect(j.previews!.map((x) => x.name)).toEqual(['ARCHIVAL-085_MAIN_preview.jpg', 'ARCHIVAL-086_MAIN_preview.jpg', 'ARCHIVAL-087_MAIN_preview.jpg']); expect(posts[0].blocks!.length).toBe(7); expect(posts[0].blocks!.filter((b) => b.type === 'image')).toHaveLength(3)
    expect(j.files_total).toBe(5)   // the previews are not files of the run
  })
  it('preview_frame off: the post is text only and ffmpeg is never run', async () => {
    await publish.setSettings({ slack: { preview_frame: false } }); expect((await publish.settings()).slack.preview_frame).toBe(false)
    const f = clipFile('archival-085', 'A'); const j = await go([f]); expect(ffmpeg).toHaveLength(0); expect(posts[0].blocks).toBeUndefined(); expect(j.previews).toBeUndefined(); await expect(publish.setSettings({ slack: { preview_frame: 'yes' as never } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/slack\.preview_frame/) })
  })
  it('ffmpeg missing: a quiet warning, no preview, the publish still succeeds; ffmpeg failing is the same', async () => {
    ffmpegFound = false; const f = clipFile('archival-085', 'A'); let j = await go([f]); expect(j.state).toBe('done'); expect(j.warnings).toEqual(['No preview frame: ffmpeg is not installed']); expect(posts[0].blocks).toBeUndefined()
    ffmpegFound = true; ffmpegOk = false; posts.length = 0; dest.clear(); j = await go([f]); expect(j.state).toBe('done'); expect(j.warnings![0]).toMatch(/No preview frame for A: ffmpeg could not read it/); expect(posts[0].blocks).toBeUndefined()
  })
  it('a file only on the volume gives no preview, says so once, and never fails', async () => {
    const j = await go([{ where: 'volume', path: 'delivery_v007' }]); expect(j.state).toBe('done'); expect(ffmpeg).toHaveLength(0); expect(j.warnings).toEqual(['Preview unavailable: the files are only on the volume (this version makes no frame from them)'])
  })
  it('a presign failure posts the text only', async () => {
    presignOk = false; const f = clipFile('archival-085', 'A'); const j = await go([f]); expect(j.state).toBe('done'); expect(posts).toHaveLength(1); expect(posts[0].blocks).toBeUndefined(); expect(j.warnings!.join()).toMatch(/link could not be made/)
  })
  it('a Slack-only run has nowhere to host an image: text only, with a quiet note', async () => {
    const f = clipFile('archival-085', 'A'); const { job_id } = await publish.run({ items: [f], targets: ['slack'], approved_by: 'L' }); const j = await finish(job_id); expect(j.state).toBe('done'); expect(posts[0].blocks).toBeUndefined(); expect(j.warnings![0]).toMatch(/S3 is not a target/)
  })
  it('the plan says so: preview_frames, the previews apart from the files, and the preview text', async () => {
    const files = ['085', '086'].map((n) => clipFile(`archival-${n}`, `ARCHIVAL-${n}_MAIN`)); const p = await publish.plan({ items: files, targets: ['s3', 'slack'], approved_by: 'L' })
    expect(p.slack!.preview_frames).toBe(2); expect(p.previews).toEqual([{ name: 'ARCHIVAL-085_MAIN_preview.jpg', s3_key: 'renders/archival-085/ARCHIVAL-085_MAIN_preview.jpg' }, { name: 'ARCHIVAL-086_MAIN_preview.jpg', s3_key: 'renders/archival-086/ARCHIVAL-086_MAIN_preview.jpg' }]); expect(p.slack!.preview).toContain('With a preview of the first frame of ARCHIVAL-085_MAIN (and 1 more)'); expect(p.files).toBe(2)
    const s3only = await publish.plan({ items: files, targets: ['s3'] }); expect(s3only.previews).toEqual([]); expect(s3only.slack).toBeNull()
    await publish.setSettings({ slack: { preview_frame: false } }); const off = await publish.plan({ items: files, targets: ['s3', 'slack'] }); expect(off.slack!.preview_frames).toBe(0); expect(off.slack!.preview).not.toMatch(/preview of the first frame/)
  })
})

describe('plan.slack: what the post will carry, and why not', () => {
  const planOf = (items: unknown[], o: Record<string, unknown> = {}) => publish.plan({ items, targets: ['s3', 'slack'], approved_by: 'L', ...o })
  it('preview_frames, preview_problem and volume_source are always there; the warnings carry the problem; job.warnings is always a list', async () => {
    const f = clipFile('archival-085', 'A'); let p = await planOf([f]); expect(p.slack).toMatchObject({ preview_frames: 1, preview_problem: null, volume_source: false }); expect(p.warnings).toEqual([])
    write('notes/readme.txt', 5); p = await planOf(['notes/readme.txt']); expect(p.slack).toMatchObject({ preview_frames: 0, preview_problem: 'No local video or sequence in the selection', volume_source: false }); expect(p.warnings).toEqual(['No local video or sequence in the selection']); expect(p.previews).toEqual([])
    p = await planOf([{ where: 'volume', path: 'delivery_v007' }]); expect(p.slack).toMatchObject({ preview_frames: 0, preview_problem: 'The selection is only on the volume (streamed)', volume_source: true }); expect(p.slack!.preview).toContain('With the source location on the volume')
    ffmpegFound = false; p = await planOf([f]); expect(p.slack).toMatchObject({ preview_frames: 0, preview_problem: 'ffmpeg is not installed on this PC (brew install ffmpeg)' }); expect(p.previews).toEqual([]); expect(p.slack!.preview).not.toMatch(/preview of the first frame/); ffmpegFound = true
    p = await publish.plan({ items: [f], targets: ['slack'] }); expect(p.slack!.preview_problem).toMatch(/need S3/); expect((await publish.plan({ items: [f], targets: ['s3'] })).slack).toBeNull()
    const j = await go([f]); expect(Array.isArray(j.warnings)).toBe(true)
  })
  it('the setting off: no problem to report (nothing was wanted); a per-run preview_frame overrides the setting in plan and run', async () => {
    const f = clipFile('archival-085', 'A'); await publish.setSettings({ slack: { preview_frame: false } })
    let p = await planOf([f]); expect(p.slack).toMatchObject({ preview_frames: 0, preview_problem: null })
    p = await planOf([f], { preview_frame: true }); expect(p.slack!.preview_frames).toBe(1)
    const j = await go([f], { preview_frame: true }); expect(j.previews).toHaveLength(1); expect(posts[0].blocks!.some((b) => b.type === 'image')).toBe(true)
    await publish.setSettings({ slack: { preview_frame: true } }); dest.clear(); posts.length = 0; ffmpeg.length = 0
    expect((await planOf([f], { preview_frame: false })).slack!.preview_frames).toBe(0); const k = await go([f], { preview_frame: false }); expect(k.previews).toBeUndefined(); expect(ffmpeg).toHaveLength(0); expect(posts[0].blocks).toBeUndefined()
  })
})

describe('the source on the volume', () => {
  const srcBlocks = (i = 0) => posts[i].blocks!.filter((b) => b.type === 'section' && /Source on the volume/.test((b.text as { text: string }).text) || b.type === 'context')
  it('a volume item: the volume name and datacenter, where in it, the console link and the exact aws command (EU-RO-1 -> eu-ro-1); no key, secret or signed URL', async () => {
    const j = await go([{ where: 'volume', path: 'delivery_v007' }]); expect(j.state).toBe('done')
    const [sec, ctx] = srcBlocks(); expect((sec.text as { text: string }).text).toBe('*Source on the volume:* Shared volume (EU-RO-1) · `comfy-shared/output/delivery_v007/` · <https://console.runpod.io/user/storage|RunPod console: Storage>')
    expect(ctx.type).toBe('context'); expect(((ctx.elements as { text: string }[])[0]).text).toBe('`aws s3 ls s3://vol1/comfy-shared/output/delivery_v007/ --endpoint-url https://s3api-eu-ro-1.runpod.io --region eu-ro-1`')
    const body = JSON.stringify(posts[0]); expect(body).not.toMatch(/RPKEY|RPSECRET|AKIAEXAMPLE|secretsecret/); expect(posts[0].blocks![0].type).toBe('section')
  })
  it('another datacenter builds its own endpoint and region; an unknown volume record leaves the path and no command', async () => {
    dc = 'US-TX-3'; await go([{ where: 'volume', path: 'delivery_v007' }]); expect(JSON.stringify(posts[0].blocks)).toContain('--endpoint-url https://s3api-us-tx-3.runpod.io --region us-tx-3')
    record = false; dest.clear(); posts.length = 0; await go([{ where: 'volume', path: 'delivery_v007' }]); const [sec, ctx] = srcBlocks(); expect((sec.text as { text: string }).text).toContain('vol1 · `comfy-shared/output/delivery_v007/`'); expect(ctx).toBeUndefined()
  })
  it('more than 3 folders: the first three and +N more', async () => {
    for (let i = 0; i < 5; i++) vol.set(`${O}f${i}/x.mov`, 5)
    await go([0, 1, 2, 3, 4].map((i) => ({ where: 'volume', path: `f${i}` }))); const [sec] = srcBlocks(); const t = (sec.text as { text: string }).text
    expect(t).toContain('`comfy-shared/output/f0/`, `comfy-shared/output/f1/`, `comfy-shared/output/f2/` +2 more'); expect(t).not.toContain('f3/')
  })
  it('a render pulled from a pod (the sidecar says adapter: pod) knows its folder on the volume; a purely local file omits the block; the setting off omits it', async () => {
    const f = clipFile('archival-085', 'POD_CLIP'); write(`${f}.meta.json`, 0, JSON.stringify({ kind: 'review', adapter: 'pod' })); await go([f])
    expect(JSON.stringify(posts[0].blocks)).toContain('`comfy-shared/output/deliver/archival-085/v001/`')
    const g = clipFile('archival-086', 'LOCAL_CLIP'); write(`${g}.meta.json`, 0, JSON.stringify({ kind: 'review', adapter: 'local' })); posts.length = 0; await go([g]); expect(JSON.stringify(posts[0].blocks ?? [])).not.toMatch(/Source on the volume/)
    await publish.setSettings({ slack: { volume_source: false } }); expect((await publish.settings()).slack.volume_source).toBe(false); dest.clear(); posts.length = 0; await go([{ where: 'volume', path: 'delivery_v007' }]); expect(JSON.stringify(posts[0].blocks ?? [])).not.toMatch(/Source on the volume/)
    await expect(publish.setSettings({ slack: { volume_source: 1 as never } })).rejects.toMatchObject({ status: 400 })
  })
  it('the plan preview mentions the source location, and a preview and the source can be in one post', async () => {
    const f = clipFile('archival-085', 'A'); write(`${f}.meta.json`, 0, JSON.stringify({ adapter: 'pod' })); const p = await publish.plan({ items: [f, { where: 'volume', path: 'delivery_v007' }], targets: ['s3', 'slack'] }); expect(p.slack!.preview).toContain('With the source location on the volume'); expect(p.slack!.preview).toContain('With a preview of the first frame of A')
    await go([f, { where: 'volume', path: 'delivery_v007' }]); expect(posts[0].blocks!.map((b) => b.type)).toEqual(['section', 'section', 'image', 'section', 'context'])
  })
})
