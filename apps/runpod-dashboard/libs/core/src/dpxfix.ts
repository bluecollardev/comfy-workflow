/**
 * DPX copies for delivery with the header corrected (Tunnel V11, docs/CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md section 9). The frames the pipeline writes tag the picture as linear
 * (transfer and colorimetric 2) while the pixels are P3-D65 Gamma 2.6, and carry no timecode. A corrected COPY is written on the volume, under `output/_delivery_v11/<clip>/`; the
 * original frames are never touched. Per frame, in the 2048-byte header only (the picture data is copied byte for byte):
 *   transfer and colorimetric of image element 1 (bytes 801, 802): 0, user-defined (the PDF: "colour code user-defined instead of linear; pixels unchanged")
 *   TV information header: time code (1920, BCD HHMMSSFF) = the clip's start timecode + the frame index; temporal sampling rate (1940) = fps; gamma (1948) = 2.6
 *   film information header: frame position (1712) = index + 1, sequence length (1716) = frames, frame rate (1724) = fps
 *   image file name (36) = the frame's new name.
 * What is written is the `delivery_prepare` block of the Default Configuration (ADR-055 section 12): the numbers above are its defaults; an argument of a call wins over it.
 * The script runs on a pod that has the volume, over SSH (the way renders do), prints a line per frame batch and re-reads each header at the end to check it.
 */
import { CoreError, bad } from './errors.js'
import * as history from './history.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as podpull from './podpull.js'
import * as publish from './publish.js'
import * as rp from './runpod.js'
import * as sync from './sync.js'

export const OUT_DIR = mounts.DELIVERY_PREPARE_DEFAULT.out_dir
/** The Prepare For Delivery settings now in force: the Default Configuration's `delivery_prepare` (the defaults when the block is absent). */
export const settings = (): mounts.DeliveryPrepareConfig => ({ ...mounts.DELIVERY_PREPARE_DEFAULT, ...(mounts.load().delivery_prepare ?? {}) })
/** A clip's settings: the Default Configuration's, with the clip's own arguments on top; validated like a saved block, so a bad argument is a 400. */
export function effective(it: Partial<FixItem> = {}): mounts.DeliveryPrepareConfig {
  const base = settings(), eff = { ...base } as Record<string, unknown>
  for (const k of ['out_dir', 'colour_code', 'gamma', 'frame_position', 'skip_existing'] as const) if (it[k] !== undefined) eff[k] = it[k]
  if (it.fps !== undefined) eff.fps = it.fps
  const c = eff as unknown as mounts.DeliveryPrepareConfig; mounts.validateDeliveryPrepare(c); return c
}
export interface FixItem { /** the folder of the original frames, under the volume's output/ */ src_dir: string; /** the clip name the frames are delivered as (the EDL's) */ clip: string; /** HH:MM:SS:FF of the first frame (the EDL source-in) */ start_timecode?: string; fps?: number; /** overrides of the Default Configuration's delivery_prepare for this clip */ out_dir?: string; colour_code?: 'user-defined' | 'linear'; gamma?: number; frame_position?: 'set' | 'keep'; skip_existing?: boolean }
export interface FixResult { clip: string; frames: number; out_dir: string; ok: boolean; error?: string }
export interface Deps {
  target(podId: string): Promise<{ host: string; port: number } | { reason: string }>
  ssh: podpull.SshRunner
  outputDir(podId: string): string
}
const cfgOf = (podId: string) => podconfigs.get(podId) ?? mounts.load()
const defaults = (): Deps => ({
  target: async (podId) => {
    const raw = await rp.getPod(podId); if (!raw) return { reason: `No pod ${podId}` }
    if ((raw.runtime?.uptimeInSeconds ?? 0) <= 0) return { reason: 'Start the pod: the copies are written on the pod' }
    try { return sync.sshTarget(raw) } catch { return { reason: 'The pod has no SSH' } }
  },
  ssh: podpull.runSsh,
  outputDir: (podId) => `${(mounts.folderRows(cfgOf(podId)).find((r) => r.key === 'comfy-shared')?.container || '/workspace/comfy-shared/').replace(/\/+$/, '')}/output`,
})
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

const TC = /^(\d\d):([0-5]\d):([0-5]\d):(\d\d)$/
/** The start timecode of a clip: its own argument; when it gives none, 00:00:00:00 if the settings say zero (otherwise it is missing, and the check refuses it). */
const tcOf = (it: Partial<FixItem>): string => (it.start_timecode !== undefined ? String(it.start_timecode) : settings().timecode_source === 'zero' ? '00:00:00:00' : '')
/** A path under output/: no .., no leading slash, nothing the shell could read as more than a name. */
const SAFE = /^[A-Za-z0-9._\-/]+$/
const rel = (v: unknown, what: string): string => { const s = String(v ?? '').replace(/\/+$/, ''); if (!s || s.startsWith('/') || s.split('/').includes('..') || !SAFE.test(s)) throw bad(`${what} is not a plain folder under output/: ${String(v).slice(0, 100)}`); return s }

/** The python that does one clip: written once, run with the clip's arguments. Pure standard library. */
export const PYTHON = String.raw`
import os, struct, sys, glob, shutil
src, out, clip, tc, fps = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], float(sys.argv[5])
cc = int(sys.argv[6]) if len(sys.argv) > 6 else 0        # DPX transfer and colorimetric code: 0 user-defined, 2 linear
gamma = float(sys.argv[7]) if len(sys.argv) > 7 else 2.6  # the TV header's gamma
setpos = int(sys.argv[8]) if len(sys.argv) > 8 else 1     # 1: set the film header's frame position, sequence length and frame rate
skip = int(sys.argv[9]) if len(sys.argv) > 9 else 0       # 1: a copy that is already there with the right size is kept
H, M, S, F = [int(x) for x in tc.split(':')]
base = max(1, round(fps))
start = ((H * 60 + M) * 60 + S) * base + F
files = sorted(glob.glob(os.path.join(src, '*.dpx')))
n = len(files)
if not n: print('ERR no frames in ' + src); sys.exit(2)
os.makedirs(out, exist_ok=True)
def bcd(v): return ((v // 10) << 4) | (v % 10)
def patch(h, i, name):
    h = bytearray(h)
    if h[0:4] not in (b'SDPX', b'XPDS'): raise SystemExit('ERR not a DPX: ' + name)
    e = '>' if h[0:4] == b'SDPX' else '<'
    h[801] = cc; h[802] = cc
    t = start + i; ff = t % base; t //= base; ss = t % 60; t //= 60; mm = t % 60; hh = (t // 60) % 24
    struct.pack_into(e + 'I', h, 1920, (bcd(hh) << 24) | (bcd(mm) << 16) | (bcd(ss) << 8) | bcd(ff))
    struct.pack_into(e + 'f', h, 1940, fps)
    struct.pack_into(e + 'f', h, 1948, gamma)
    if setpos:
        struct.pack_into(e + 'I', h, 1712, i + 1)
        struct.pack_into(e + 'I', h, 1716, n)
        struct.pack_into(e + 'f', h, 1724, fps)
    h[36:136] = name.encode()[:99].ljust(100, b'\0')
    return bytes(h)
for i, f in enumerate(files):
    name = '%s.%04d.dpx' % (clip, i)
    dst = os.path.join(out, name)
    if skip and os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(f):
        if i % 20 == 19 or i == n - 1: print('FRAMES %s %d/%d' % (clip, i + 1, n), flush=True)
        continue
    with open(f, 'rb') as a:
        head = a.read(2048)
        if len(head) < 2048: print('ERR short file ' + f); sys.exit(2)
        tmp = dst + '.part'
        with open(tmp, 'wb') as b:
            b.write(patch(head, i, name))
            shutil.copyfileobj(a, b, 8 * 1024 * 1024)
    if os.path.getsize(tmp) != os.path.getsize(f): print('ERR size differs ' + f); sys.exit(2)
    os.replace(tmp, dst)
    if i % 20 == 19 or i == n - 1: print('FRAMES %s %d/%d' % (clip, i + 1, n), flush=True)
# read back: every header carries what it should
bad = 0
for i in range(n):
    with open(os.path.join(out, '%s.%04d.dpx' % (clip, i)), 'rb') as g: h = g.read(2048)
    e = '>' if h[0:4] == b'SDPX' else '<'
    t = start + i; ff = t % base; t //= base; ss = t % 60; t //= 60; mm = t % 60; hh = (t // 60) % 24
    want = (bcd(hh) << 24) | (bcd(mm) << 16) | (bcd(ss) << 8) | bcd(ff)
    if h[801] != cc or h[802] != cc or struct.unpack_from(e + 'I', h, 1920)[0] != want or abs(struct.unpack_from(e + 'f', h, 1948)[0] - gamma) > 1e-6: bad += 1
print('CHECK %s %d/%d headers right' % (clip, n - bad, n), flush=True)
sys.exit(0 if bad == 0 else 3)
`

/** Write the corrected copies of the given clips on the pod. One clip at a time; a failure stops that clip and the others go on. */
export async function run(o: { pod_id?: string; items?: FixItem[]; approved_by?: string; onLine?: (l: string) => void; signal?: AbortSignal }): Promise<{ results: FixResult[]; out_root: string; settings: mounts.DeliveryPrepareConfig }> {
  const who = String(o.approved_by ?? '').trim(); if (!who) throw bad('Writing DPX copies on the volume needs the name of who says yes (approved_by)')
  const podId = String(o.pod_id ?? '').trim(); if (!podId) throw bad('Give the pod (pod_id): the copies are written on a pod that has the volume')
  const items = Array.isArray(o.items) ? o.items : []; if (!items.length) throw bad('Give at least one clip in items')
  for (const it of items) { rel(it.src_dir, 'src_dir'); if (!/^[A-Za-z0-9._\-]+$/.test(String(it.clip ?? ''))) throw bad(`The clip name is not usable as a folder and file name: ${String(it.clip).slice(0, 100)}`); effective(it); if (!TC.test(String(tcOf(it)))) throw bad(`start_timecode must be HH:MM:SS:FF: ${String(it.start_timecode)}`); if (it.fps !== undefined && !(Number(it.fps) > 0 && Number(it.fps) <= 120)) throw bad(`fps ${String(it.fps)} is not a frame rate`) }
  const t = await deps.target(podId); if ('reason' in t) throw new CoreError(409, t.reason)
  const root = deps.outputDir(podId), results: FixResult[] = []
  for (const it of items) {
    const eff = effective(it), fps = it.fps ?? eff.fps, outRel = `${eff.out_dir}/${it.clip}`
    const script = `set -e\npython3 - '${root}/${rel(it.src_dir, 'src_dir')}' '${root}/${outRel}' '${it.clip}' '${tcOf(it)}' '${fps}' '${eff.colour_code === 'linear' ? 2 : 0}' '${eff.gamma}' '${eff.frame_position === 'set' ? 1 : 0}' '${eff.skip_existing ? 1 : 0}' <<'PY'\n${PYTHON}\nPY\n`
    let frames = 0, ok = false, error = ''
    try {
      const r = await deps.ssh({ host: t.host, port: t.port, script, signal: o.signal ?? new AbortController().signal, onLine: (l) => { o.onLine?.(l); const m = /^FRAMES \S+ (\d+)\/(\d+)/.exec(l); if (m) frames = Number(m[2]); const c = /^CHECK \S+ (\d+)\/(\d+) headers right/.exec(l); if (c && c[1] === c[2]) ok = true; if (/^ERR /.test(l)) error = l.slice(4, 200) } })
      if (r.code !== 0 && !error) error = `the script ended with code ${r.code}`
    } catch (e) { error = (e as Error).message.slice(0, 200) }
    results.push({ clip: it.clip, frames, out_dir: outRel, ok: ok && !error, ...(error ? { error } : {}) })
  }
  history.record({ kind: 'change', area: 'outputs', action: 'DPX copies with corrected headers', what: `${results.filter((r) => r.ok).length} of ${results.length} clips`, detail: `approved by ${who}; written under output/${settings().out_dir}/ on the volume; the original frames are not touched` })
  return { results, out_root: `${root}/${settings().out_dir}`, settings: settings() }
}

export interface PlanRow { src_dir: string; stem: string; /** the clip name the EDL gives it, '' when it is not in the EDL */ clip: string; frames: number; expected_frames: number | null; start_timecode: string; timecode_source: string | null; fps: number; ok: boolean; why: string }
/** What each sequence would be delivered as: the clip name and the start timecode from the EDL, the frame rate from the name, and whether the EDL holds it back. Read-only: nothing is written. */
export async function plan(o: { items?: { src_dir?: string; stem?: string }[] } = {}): Promise<{ rows: PlanRow[]; settings: mounts.DeliveryPrepareConfig }> {
  const items = Array.isArray(o.items) ? o.items : []; if (!items.length) throw bad('Give at least one sequence in items ({ src_dir, stem? }: the frames folder under output/ on the volume)')
  const cfg = settings()
  const norm = items.map((i) => { const d = rel(i.src_dir, 'src_dir'); return { src_dir: d, stem: String(i.stem ?? '').trim() } })
  const p = await publish.plan({ items: norm.map((i) => ({ where: 'volume', path: i.src_dir, ...(i.stem ? { stem: i.stem } : {}) })), targets: ['s3'], round: '_TEST_plan' } as never)
  const by = new Map((p.sequences ?? []).map((s) => [s.stem, s]))
  const rows: PlanRow[] = norm.map((i) => {
    const s = (i.stem ? by.get(i.stem) : undefined) ?? [...by.values()].find((x) => i.src_dir.includes(x.stem.split('_mono')[0].toLowerCase()) || x.stem === i.src_dir.split('/').slice(-2)[0])
    const clip = s?.edl_element?.clip ?? ''
    return { src_dir: i.src_dir, stem: s?.stem ?? i.stem, clip, frames: s?.frames ?? 0, expected_frames: s?.expected_frames ?? null, start_timecode: cfg.timecode_source === 'zero' ? '00:00:00:00' : (s?.start_timecode ?? '00:00:00:00'), timecode_source: cfg.timecode_source === 'zero' ? 'settings (zero)' : (s?.timecode_source ?? null), fps: cfg.fps_source === 'fixed' ? cfg.fps : /_24_/.test(clip) ? 24 : cfg.fps, ok: !!clip && !s?.blocked, why: !clip ? 'not in the EDL' : s?.blocked ? (s.reason ?? 'held back by the EDL check') : '' }
  })
  return { rows, settings: cfg }
}
