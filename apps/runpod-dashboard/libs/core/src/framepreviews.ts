/**
 * Frame previews of DPX sequences, made WHERE THE FILES ARE (Lucas, 2026-11-21: "that's why these are jobs"). A DPX frame is 8 to 50 MB, so this PC never pulls them to make a thumbnail:
 * a job runs a small python script on a running pod that has the volume, over SSH (the way dpxfix.ts and dpxmake.ts run), which reads each frame there and writes one small JPEG
 * (320 px wide, quality 80, about 30 KB) under `output/.previews/<the sequence's folder under output/>/<frame name>.jpg`: a mirror tree beside the deliveries, never inside a delivery
 * folder, so a publish of a sequence can never pick one up. The Outputs rows read those JPEGs through the same /view address as any file, and count them from one listing.
 *   - Idempotent: a frame that already has a non-empty JPEG is skipped; nothing is overwritten or deleted; a JPEG is written as `.part` and renamed.
 *   - The thumbnail is a PREVIEW ONLY, never colour truth: the frame's code values get a plain display tone (tone `gamma26`: Gamma 2.6 display to a Gamma 2.2 screen; `linear`: the sRGB curve;
 *     `none`: as is), the header's colour tags are not trusted (this project's headers say linear over Gamma 2.6 pixels).
 *   - Decoder: python3 with numpy and Pillow (both are ComfyUI's own requirements, so every pod image has them); 16-bit, 8-bit and 10-bit filled (methods A and B) RGB DPX; anything else is
 *     reported as a failed frame with the reason, and the batch goes on.
 *   - A CPU job: two worker threads on the pod. A job is one process-wide entry in the shared running-jobs file (kind 'volume', label 'frame previews ...'), visible to the app and to MCP, and
 *     cancellable from either; cancelling ends the ssh session, and the script stops at its next progress line (a closed pipe).
 */
import { CoreError, bad } from './errors.js'
import * as history from './history.js'
import * as jobsregistry from './jobsregistry.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as podpull from './podpull.js'
import * as rp from './runpod.js'
import * as sync from './sync.js'

export const PREVIEW_DIR = '.previews'
export interface Item { /** the sequence's folder under the volume's output/ (the frames' `subfolder`) */ src_dir: string; /** how many frames it has, when the caller knows (progress totals) */ frames?: number; /** 'posters': src_dir is a folder of VIDEOS and the job makes each one's first-frame poster instead of frame previews */ kind?: 'posters' }
export interface Failure { src_dir: string; frame: string; reason: string }
export interface Job {
  id: string; pod_id: string; items: Item[]; tone: string; skip_existing: boolean; state: 'running' | 'done' | 'failed' | 'cancelled'; started_at: string; finished_at?: string
  /** frames written, skipped (already had a JPEG) and failed so far; `total` is the known frame count */
  done: number; skipped: number; failed: Failure[]; total: number; current: string; error?: string
  /** the sequence folders the script finished without an error (a folder that ended early is NOT here: a relaunch runs it again, skipping the frames that have a JPEG) */
  done_dirs: string[]
  /** the job this one is the relaunch of */
  relaunch_of?: string
}
export interface PodInfo { id: string; name: string; running: boolean; volume: string | null }
export interface Deps {
  target(podId: string): Promise<{ host: string; port: number } | { reason: string }>
  ssh: podpull.SshRunner
  outputDir(podId: string): string
  /** every pod of the account with whether it runs and which network volume it has (relaunch picks among them; it never starts one) */
  pods(): Promise<PodInfo[]>
}
const cfgOf = (podId: string) => podconfigs.get(podId) ?? mounts.load()
const defaults = (): Deps => ({
  target: async (podId) => {
    const raw = await rp.getPod(podId); if (!raw) return { reason: `No pod ${podId}` }
    if ((raw.runtime?.uptimeInSeconds ?? 0) <= 0) return { reason: 'Start the pod: the previews are made on the pod' }
    try { return sync.sshTarget(raw) } catch { return { reason: 'The pod has no SSH' } }
  },
  ssh: podpull.runSsh,
  pods: async () => (await rp.listPods()).map((p) => ({ id: p.id, name: p.name || p.id, running: (p.runtime?.uptimeInSeconds ?? 0) > 0 && (!p.desiredStatus || p.desiredStatus === 'RUNNING'), volume: p.networkVolumeId ?? null })),
  outputDir: (podId) => `${(mounts.folderRows(cfgOf(podId)).find((r) => r.key === 'comfy-shared')?.container || '/workspace/comfy-shared/').replace(/\/+$/, '')}/output`,
})
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

/** A path under output/: no .., no leading slash, nothing the shell could read as more than a name. */
const SAFE = /^[A-Za-z0-9._\-/]+$/
export const rel = (v: unknown, what = 'src_dir'): string => { const s = String(v ?? '').replace(/\/+$/, ''); if (!s || s.startsWith('/') || s.split('/').includes('..') || !SAFE.test(s)) throw bad(`${what} is not a plain folder under output/: ${String(v).slice(0, 100)}`); return s }
const TONES = ['gamma26', 'linear', 'none']
/** The preview's address under output/ for a sequence folder: the Outputs rows ask /view for `<this>/<frame>.jpg`. */
export const previewSubfolder = (srcDir: string) => `${PREVIEW_DIR}/${rel(srcDir)}`
/** The JPEG's file name for a DPX frame's file name. */
export const jpgName = (dpxName: string) => dpxName.replace(/\.dpx$/i, '') + '.jpg'

/** The python that does one folder: pure numpy and Pillow, two threads. Arguments: the frames folder, the previews folder, the tone, and 0 to make every JPEG again (default: frames that have one are skipped). */
export const PYTHON = String.raw`
import os, sys, glob, struct
from concurrent.futures import ThreadPoolExecutor
try:
    import numpy as np
    from PIL import Image
except Exception as e:
    print('ERR numpy and Pillow are needed on the pod: %s' % e); sys.exit(4)
src, out, tone = sys.argv[1], sys.argv[2], sys.argv[3]
skip = len(sys.argv) < 5 or sys.argv[4] != '0'   # 0: make every JPEG again (the new one replaces the old, atomically)
files = sorted(glob.glob(os.path.join(src, '*.dpx')))
n = len(files)
if not n: print('ERR no frames in ' + src); sys.exit(2)
os.makedirs(out, exist_ok=True)
tdir = os.path.join(out, 'thumbs')   # the thumbnail tier (160 px wide, about 5 KB): the Outputs strips and grids load these; a failure here never fails a frame
try: os.makedirs(tdir, exist_ok=True)
except Exception: tdir = None
print('TOTAL %d' % n, flush=True)
def thumb(jpg, name):
    if not tdir: return
    dst = os.path.join(tdir, name)
    try:
        if os.path.exists(dst) and os.path.getsize(dst) > 0: return
        im = Image.open(jpg).convert('RGB')
        im = im.resize((160, max(1, round(im.height * 160 / im.width))), Image.BILINEAR)
        tmp = dst + '.part'
        im.save(tmp, format='JPEG', quality=72)
        os.replace(tmp, dst)
    except Exception:
        pass
def decode(path):
    with open(path, 'rb') as f: h = f.read(2048)
    if h[0:4] not in (b'SDPX', b'XPDS'): raise ValueError('not a DPX')
    e = '>' if h[0:4] == b'SDPX' else '<'
    off = struct.unpack_from(e + 'I', h, 4)[0]
    w = struct.unpack_from(e + 'I', h, 772)[0]; hh = struct.unpack_from(e + 'I', h, 776)[0]
    desc = h[800]; bits = h[803]; pack = struct.unpack_from(e + 'H', h, 804)[0]
    ch = {50: 3, 51: 4}.get(desc)
    if not ch: raise ValueError('descriptor %d is not RGB' % desc)
    if bits == 16:
        a = np.fromfile(path, dtype=np.dtype(e + 'u2'), count=w * hh * ch, offset=off).reshape(hh, w, ch)[:, :, :3] / 65535.0
    elif bits == 8:
        a = np.fromfile(path, dtype=np.uint8, count=w * hh * ch, offset=off).reshape(hh, w, ch)[:, :, :3] / 255.0
    elif bits == 10 and ch == 3 and pack in (1, 2):
        v = np.fromfile(path, dtype=np.dtype(e + 'u4'), count=w * hh, offset=off).reshape(hh, w)
        s = (22, 12, 2) if pack == 1 else (20, 10, 0)
        a = np.stack([(v >> k) & 1023 for k in s], axis=-1) / 1023.0
    else:
        raise ValueError('%d-bit, packing %d is not supported' % (bits, pack))
    step = max(1, w // 640)
    a = a[::step, ::step, :].astype(np.float32)
    if tone == 'gamma26': a = np.power(np.clip(a, 0, 1), 2.6 / 2.2)
    elif tone == 'linear': a = np.where(a <= 0.0031308, 12.92 * a, 1.055 * np.power(np.clip(a, 0, 1), 1 / 2.4) - 0.055)
    img = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')
    tw = 320; th = max(1, round(img.height * tw / img.width))
    return img.resize((tw, th), Image.BILINEAR)
def one(f):
    name = os.path.basename(f)[:-4] + '.jpg'
    dst = os.path.join(out, name)
    try:
        if skip and os.path.exists(dst) and os.path.getsize(dst) > 0:
            thumb(dst, name)   # a frame that already has its JPEG only gets the missing thumbnail (no DPX read)
            return ('SKIP', name, '')
        img = decode(f)
        tmp = dst + '.part'
        img.save(tmp, format='JPEG', quality=80)
        os.replace(tmp, dst)
        thumb(dst, name)
        return ('OK', name, '')
    except Exception as ex:
        return ('FAIL', name, str(ex).replace('\n', ' ')[:150])
ok = sk = fl = 0
with ThreadPoolExecutor(max_workers=2) as pool:
    for i, (st, name, why) in enumerate(pool.map(one, files)):
        if st == 'OK': ok += 1
        elif st == 'SKIP': sk += 1
        else: fl += 1; print('FAIL %s %s' % (name, why), flush=True)
        if i % 5 == 4 or i == n - 1: print('PREV %d/%d ok=%d skipped=%d failed=%d' % (i + 1, n, ok, sk, fl), flush=True)
print('DONE ok=%d skipped=%d failed=%d' % (ok, sk, fl), flush=True)
sys.exit(0)
`

/** The python for a folder of VIDEOS: the first frame of each (ffmpeg, which every pod image has) as a 320 px JPEG under <previews>/posters/<video name>.jpg; same arguments and progress lines as PYTHON. */
export const POSTER_PY = String.raw`
import os, sys, glob, shutil, subprocess
src, out = sys.argv[1], sys.argv[2]
skip = len(sys.argv) < 5 or sys.argv[4] != '0'
ff = shutil.which('ffmpeg')
if not ff: print('ERR ffmpeg is needed on the pod'); sys.exit(4)
vids = sorted(f for f in glob.glob(os.path.join(src, '*')) if f.lower().endswith(('.mp4', '.mov', '.webm', '.m4v', '.mkv')))
n = len(vids)
if not n: print('ERR no videos in ' + src); sys.exit(2)
os.makedirs(out, exist_ok=True)
print('TOTAL %d' % n, flush=True)
ok = sk = fl = 0
for i, f in enumerate(vids):
    name = os.path.basename(f) + '.jpg'
    dst = os.path.join(out, name)
    if skip and os.path.exists(dst) and os.path.getsize(dst) > 0: sk += 1
    else:
        tmp = dst + '.part.jpg'
        try:
            r = subprocess.run([ff, '-v', 'error', '-y', '-i', f, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', tmp], capture_output=True, text=True, timeout=60)
            if r.returncode == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 0: os.replace(tmp, dst); ok += 1
            else: fl += 1; print('FAIL %s %s' % (name, (r.stderr or 'ffmpeg failed').replace('\n', ' ')[:150]), flush=True)
        except Exception as e:
            fl += 1; print('FAIL %s %s' % (name, str(e).replace('\n', ' ')[:150]), flush=True)
    if i % 5 == 4 or i == n - 1: print('PREV %d/%d ok=%d skipped=%d failed=%d' % (i + 1, n, ok, sk, fl), flush=True)
print('DONE ok=%d skipped=%d failed=%d' % (ok, sk, fl), flush=True)
sys.exit(0)
`

const jobs = new Map<string, Job>(), ctrls = new Map<string, AbortController>(), stops = new Map<string, () => void>()
let seq = 0
const copy = (j: Job): Job => ({ ...j, items: j.items.map((i) => ({ ...i })), failed: [...j.failed], done_dirs: [...j.done_dirs] })
const TERMINAL = ['done', 'failed', 'cancelled']

/** Start a job: one or more sequence folders on a running pod. Returns at once with the job; progress through `status`. */
export async function start(o: { pod_id?: string; items?: Partial<Item>[]; tone?: string; /** false: make every JPEG again (Skip Existing unticked) */ skip_existing?: boolean; /** the job this one runs again (relaunch) */ relaunch_of?: string; onLine?: (l: string) => void }): Promise<Job> {
  const podId = String(o.pod_id ?? '').trim(); if (!podId) throw bad('Give the pod (pod_id): the previews are made on a pod that has the volume')
  const items = (Array.isArray(o.items) ? o.items : []).map((i) => ({ src_dir: rel(i.src_dir), ...(Number.isFinite(i.frames) ? { frames: Number(i.frames) } : {}), ...(i.kind === 'posters' ? { kind: 'posters' as const } : {}) }))
  if (!items.length) throw bad('Give at least one sequence in items ({ src_dir, frames? })')
  const tone = String(o.tone ?? 'gamma26'); if (!TONES.includes(tone)) throw bad(`tone is one of ${TONES.join(', ')}`)
  const t = await deps.target(podId); if ('reason' in t) throw new CoreError(409, t.reason)
  const root = deps.outputDir(podId)
  const id = `framepreviews-${Date.now()}-${++seq}`
  const job: Job = { id, pod_id: podId, items, tone, skip_existing: o.skip_existing !== false, state: 'running', started_at: new Date().toISOString(), done: 0, skipped: 0, failed: [], total: items.reduce((s, i) => s + (i.frames ?? 0), 0), current: '', done_dirs: [], ...(o.relaunch_of ? { relaunch_of: o.relaunch_of } : {}) }
  jobs.set(id, job)
  const ac = new AbortController(); ctrls.set(id, ac)
  const who = history.currentOrigin(), origin: jobsregistry.Origin = who?.source === 'mcp' ? 'mcp' : 'window'
  stops.set(id, jobsregistry.track({ id, kind: 'volume', trigger: 'manual', origin, ...(origin === 'mcp' && who?.client ? { client: who.client } : {}), label: `frame previews ${items.length === 1 ? items[0].src_dir : `${items.length} sequences`}`, started_at: job.started_at, view: () => ({ state: job.state, terminal: TERMINAL.includes(job.state), progress: { done: job.done + job.skipped + job.failed.length, total: job.total, unit: 'frames' } }), cancel: () => ac.abort() }))
  void (async () => {
    try {
      for (const it of items) {
        if (ac.signal.aborted) break
        job.current = it.src_dir
        const errBefore = job.error
        const known = it.frames ?? 0
        let okSeen = 0, skSeen = 0
        const script = `set -e\npython3 - '${root}/${it.src_dir}' '${root}/${previewSubfolder(it.src_dir)}${it.kind === 'posters' ? '/posters' : ''}' '${tone}' '${o.skip_existing === false ? 0 : 1}' <<'PY'\n${it.kind === 'posters' ? POSTER_PY : PYTHON}\nPY\n`
        const r = await deps.ssh({ host: t.host, port: t.port, script, signal: ac.signal, onLine: (l) => {
          o.onLine?.(l)
          let m: RegExpExecArray | null
          if ((m = /^TOTAL (\d+)/.exec(l))) { job.total += Number(m[1]) - known }   // the script's count replaces the caller's guess (0 when the caller gave none)
          else if ((m = /^PREV (\d+)\/(\d+) ok=(\d+) skipped=(\d+) failed=(\d+)/.exec(l))) { const ok = Number(m[3]), sk = Number(m[4]); job.done += ok - okSeen; job.skipped += sk - skSeen; okSeen = ok; skSeen = sk }
          else if ((m = /^FAIL (\S+) (.*)$/.exec(l))) job.failed.push({ src_dir: it.src_dir, frame: m[1], reason: m[2] })
          else if (/^ERR /.test(l)) job.error = l.slice(4, 200)
        } })
        if (r.code !== 0 && !ac.signal.aborted && !job.error) job.error = `the script ended with code ${r.code} on ${it.src_dir}`
        if (r.code === 0 && !ac.signal.aborted && job.error === errBefore) job.done_dirs.push(it.src_dir)   // finished cleanly: a relaunch leaves it out
      }
      job.state = ac.signal.aborted ? 'cancelled' : job.error && !job.done && !job.skipped ? 'failed' : 'done'
    } catch (e) { job.state = ac.signal.aborted ? 'cancelled' : 'failed'; job.error = (e as Error).message.slice(0, 200) }
    job.finished_at = new Date().toISOString()
    ctrls.delete(id)
    history.record({ kind: 'change', area: 'outputs', action: 'Frame previews', what: `${job.done} written, ${job.skipped} already there, ${job.failed.length} failed`, detail: `${job.state}; ${items.length} sequence(s) on pod ${podId}; JPEGs under output/${PREVIEW_DIR}/` })
  })()
  return copy(job)
}

/** One job (job_id) or all of them, newest first. */
export function status(o: { job_id?: string } = {}): Job | Job[] | null {
  if (o.job_id) { const j = jobs.get(o.job_id); return j ? copy(j) : null }
  return [...jobs.values()].reverse().map(copy)
}
/** Stop a job: the ssh session ends and the script stops at its next progress line. Frames already written stay (and are skipped next time). */
export function cancel(o: { job_id?: string }): { ok: boolean; state?: string } {
  const id = String(o.job_id ?? ''), ac = ctrls.get(id), j = jobs.get(id)
  if (!j) return { ok: false }
  if (ac) ac.abort()
  return { ok: true, state: j.state }
}

export interface RelaunchAnswer {
  ok: boolean
  /** the new job */ job?: Job
  /** every folder of the old job had finished: nothing to run */ nothing_to_do?: boolean
  /** no pod of ours is running on the volume: the pods that are stopped (a person resumes one; relaunch never does) */ needs_pod?: { stopped: { id: string; name: string }[]; hint: string }
}
/**
 * Run a job again (Lucas, 2026-11-21: "have a way to relaunch this"): the SAME folders minus the ones that finished, skip_existing always true (a frame that has a JPEG is never made again), tone as before.
 * The pod: the explicit `pod_id` (must be running), else the old job's pod when it runs, else the first running pod that has the same network volume, never one in `exclude_pod_ids`.
 * It NEVER resumes or creates a pod (that spends and stays a person's act): with none running it answers `needs_pod` and names the stopped ones. A job still running cannot be relaunched.
 */
export async function relaunch(o: { job_id?: string; pod_id?: string; exclude_pod_ids?: string[] }): Promise<RelaunchAnswer> {
  const old = jobs.get(String(o.job_id ?? '')); if (!old) throw new CoreError(404, `No frame-previews job ${String(o.job_id ?? '')}: it is only known until the app restarts`)
  if (old.state === 'running') throw new CoreError(409, 'That job is still running: cancel it first, or wait')
  const done = new Set(old.done_dirs), items = old.items.filter((i) => !done.has(i.src_dir))
  if (!items.length) return { ok: true, nothing_to_do: true }
  const excl = new Set((o.exclude_pod_ids ?? []).map(String)), pods = await deps.pods(), volume = pods.find((p) => p.id === old.pod_id)?.volume ?? null
  const fits = (p: PodInfo) => !excl.has(p.id) && (!volume || p.volume === volume)
  let pick: PodInfo | undefined
  const asked = String(o.pod_id ?? '').trim()
  if (asked) {
    const p = pods.find((x) => x.id === asked)
    if (!p || excl.has(asked)) throw new CoreError(409, `Pod ${asked} is not available for this relaunch`)
    if (!p.running) return { ok: false, needs_pod: { stopped: [{ id: p.id, name: p.name }], hint: `Pod ${p.name} is stopped: resume it (a person's act, it bills), then relaunch` } }
    pick = p
  } else pick = pods.find((p) => p.id === old.pod_id && p.running && fits(p)) ?? pods.find((p) => p.running && fits(p))
  if (!pick) {
    const stopped = pods.filter((p) => !p.running && fits(p)).map((p) => ({ id: p.id, name: p.name }))
    return { ok: false, needs_pod: { stopped, hint: `No pod is running on this volume: resume one${stopped.length ? ` (${stopped.map((p) => p.name).join(', ')})` : ''}, it bills while it runs, then relaunch. Relaunch never resumes a pod itself` } }
  }
  const job = await start({ pod_id: pick.id, items, tone: old.tone, skip_existing: true, relaunch_of: old.id })
  return { ok: true, job }
}

export interface Listing { [src_dir: string]: { count: number; names?: string[]; /** the JPEG names that also have a thumbnail under thumbs/ (with `names`) */ thumbs?: string[]; /** the video file names (with their extension, `.jpg` added) that have a poster under posters/ (with `names`) */ posters?: string[] } }
/** What previews exist, from ONE ssh listing for all the folders: the count per folder (and the JPEG names when `names`). A pod that is not running answers 409 and the caller shows nothing. */
export async function list(o: { pod_id?: string; items?: Partial<Item>[]; names?: boolean }): Promise<{ previews: Listing; subfolders: Record<string, string> }> {
  const podId = String(o.pod_id ?? '').trim(); if (!podId) throw bad('Give the pod (pod_id)')
  const items = (Array.isArray(o.items) ? o.items : []).map((i) => rel(i.src_dir)); if (!items.length) throw bad('Give at least one sequence in items')
  const t = await deps.target(podId); if ('reason' in t) throw new CoreError(409, t.reason)
  const root = deps.outputDir(podId)
  const body = items.map((d) => `echo "DIR ${d}"; ls -1 '${root}/${previewSubfolder(d)}' 2>/dev/null | grep -E '\\.jpg$' | ${o.names ? 'sed "s/^/NAME /"' : 'wc -l | sed "s/^/COUNT /"'} || true${o.names ? `; ls -1 '${root}/${previewSubfolder(d)}/thumbs' 2>/dev/null | grep -E '\\.jpg$' | sed "s/^/THUMB /" || true; ls -1 '${root}/${previewSubfolder(d)}/posters' 2>/dev/null | grep -E '\\.jpg$' | sed "s/^/POSTER /" || true` : ''}`).join('\n')
  const out: Listing = {}; let cur = ''
  await deps.ssh({ host: t.host, port: t.port, script: `${body}\n`, signal: new AbortController().signal, onLine: (l) => {
    let m: RegExpExecArray | null
    if ((m = /^DIR (.+)$/.exec(l))) { cur = m[1]; out[cur] = { count: 0, ...(o.names ? { names: [], thumbs: [] } : {}) } }
    else if (cur && (m = /^COUNT\s+(\d+)/.exec(l))) out[cur].count = Number(m[1])
    else if (cur && (m = /^NAME (.+)$/.exec(l))) { out[cur].names!.push(m[1]); out[cur].count++ }
    else if (cur && o.names && (m = /^THUMB (.+)$/.exec(l))) (out[cur].thumbs ||= []).push(m[1])
    else if (cur && o.names && (m = /^POSTER (.+)$/.exec(l))) (out[cur].posters ||= []).push(m[1])
  } })
  return { previews: out, subfolders: Object.fromEntries(items.map((d) => [d, previewSubfolder(d)])) }
}
