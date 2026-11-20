/**
 * Unpack a finished master video into a 16-bit DPX sequence (Tunnel V11, docs/CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md section 12, step 2; ADR-055). For the 16 elements that exist only as a
 * ProRes 422 HQ .mov (or an .mp4) there are no frames, and the delivery needs a numbered DPX sequence. The unpack is STRAIGHT: no conversion of primaries or gamma; the only change is the
 * unavoidable YCbCr to RGB matrix (the master's tagged matrix; bt709 when it is untagged, and the result says so) and the expansion of the tagged range (tv by default) to full range.
 * The script runs on a pod that has the volume, over SSH (the way dpxfix and renders do). It writes into a temporary sibling folder and renames it into place only when the frame count is
 * right; it never writes into a dpx folder that already holds files.
 *   master (relative to comfy-shared/):  temp/rounds/<round>/<shot>/approved/05-outputs/Approved/master/<file>.mov
 *   output (under comfy-shared/output/):  <round>/<shot>/<shot>_<element>/dpx/<shot>_<element>_<round>_NOT_RELEASED.NNNN.dpx   (4 digits, from 0000)
 */
import { CoreError, bad } from './errors.js'
import * as history from './history.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as podpull from './podpull.js'
import * as rp from './runpod.js'
import * as sync from './sync.js'

export interface MakeItem { /** path of the master video relative to the volume's comfy-shared/ folder */ master: string; shot: string; element: string; /** the frame count the PDF gives; a different count fails the item and nothing is put in place */ frames_expected?: number; /** the frame rate it should be; only noted when the master differs */ fps?: number }
export interface MakeResult { shot: string; element: string; frames: number; expected: number | null; ok: boolean; out_dir: string; colour: { matrix: string; range: string; tagged: boolean }; notes?: string[]; error?: string }
export interface Deps {
  target(podId: string): Promise<{ host: string; port: number } | { reason: string }>
  ssh: podpull.SshRunner
  /** the volume's output/ folder on the pod; comfy-shared/ is its parent */
  outputDir(podId: string): string
}
const cfgOf = (podId: string) => podconfigs.get(podId) ?? mounts.load()
const defaults = (): Deps => ({
  target: async (podId) => {
    const raw = await rp.getPod(podId); if (!raw) return { reason: `No pod ${podId}` }
    if ((raw.runtime?.uptimeInSeconds ?? 0) <= 0) return { reason: 'Start the pod: the frames are written on the pod' }
    try { return sync.sshTarget(raw) } catch { return { reason: 'The pod has no SSH' } }
  },
  ssh: podpull.runSsh,
  outputDir: (podId) => `${(mounts.folderRows(cfgOf(podId)).find((r) => r.key === 'comfy-shared')?.container || '/workspace/comfy-shared/').replace(/\/+$/, '')}/output`,
})
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

export const DEFAULT_ROUND = 'mono_v019'
/** Same quoting as renders.ts: one word for the shell. */
const q = (s: string): string => `'${String(s).replace(/'/g, `'\\''`)}'`
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/
const SAFE = /^[A-Za-z0-9._\-/]+$/
const name = (v: unknown, what: string): string => { const s = String(v ?? ''); if (!NAME.test(s) || s.includes('..')) throw bad(`${what} is not a plain name (letters, digits, . _ -): ${s.slice(0, 100)}`); return s }
const masterPath = (v: unknown): string => {
  const s = String(v ?? '')
  if (!s || s.startsWith('/') || s.includes('//') || s.split('/').some((p) => p === '..' || p === '.') || !SAFE.test(s) || !/\.(mov|mp4|mxf)$/i.test(s)) throw bad(`master is not a plain path under comfy-shared/ ending .mov, .mp4 or .mxf: ${s.slice(0, 100)}`)
  return s
}

/** What the probe says about the master, as the filter wants it. Matrix names are ffmpeg's `scale` names; untagged is bt709 and says so. */
export function colourOf(p: { color_space?: string; color_range?: string }): { matrix: string; range: 'tv' | 'pc'; tagged: boolean } {
  const cs = String(p.color_space ?? '').toLowerCase(), cr = String(p.color_range ?? '').toLowerCase()
  const matrix = cs === 'smpte170m' || cs === 'bt470bg' ? 'bt601' : cs === 'bt2020nc' ? 'bt2020' : 'bt709'
  return { matrix, range: cr === 'pc' || cr === 'jpeg' ? 'pc' : 'tv', tagged: ['bt709', 'smpte170m', 'bt470bg', 'bt2020nc'].includes(cs) }
}
/** The filter: the tagged range expanded to full, the tagged matrix applied, 16-bit RGB out. Nothing else. */
export const scaleFilter = (matrix: string, range: string): string => `scale=in_range=${range}:out_range=pc:in_color_matrix=${matrix},format=rgb48le`
/** The ffmpeg arguments (also what the script runs, with shell variables for input, out and the probed matrix and range). */
export function ffmpegArgs(o: { input: string; out: string; matrix: string; range: string }): string[] {
  return ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y', '-i', o.input, '-vf', scaleFilter(o.matrix, o.range), '-c:v', 'dpx', '-pix_fmt', 'rgb48le', '-start_number', '0', o.out]
}
const sh = (a: string) => (a.includes('$') ? `"${a}"` : q(a))

export const outDirOf = (round: string, shot: string, element: string) => `${round}/${shot}/${shot}_${element}/dpx`
export const dpxName = (round: string, shot: string, element: string) => `${shot}_${element}_${round}_NOT_RELEASED`

/** The pod script for one item: probe, unpack into a temporary sibling, count, check the bit depth, rename into place. */
export function scriptFor(o: { shared: string; master: string; round: string; shot: string; element: string; expected?: number | null; fps?: number | null }): string {
  const out = `${o.shared}/output/${outDirOf(o.round, o.shot, o.element)}`, nm = dpxName(o.round, o.shot, o.element)
  const cmd = ['nice', 'ffmpeg', ...ffmpegArgs({ input: '$M', out: '$TMP/$NAME.%04d.dpx', matrix: '$MATRIX', range: '$RANGE' }).map(sh)].join(' ')
  return `set -euo pipefail
M=${q(`${o.shared}/${o.master}`)}
OUT=${q(out)}
NAME=${q(nm)}
EXPECTED=${q(o.expected == null ? '' : String(o.expected))}
WANT_FPS=${q(o.fps == null ? '' : String(o.fps))}
PARENT=$(dirname "$OUT")
if [ -d "$OUT" ] && [ -n "$(ls -A "$OUT")" ]; then echo "ERR $OUT already holds files; nothing written"; exit 2; fi
if [ -e "$OUT" ] && [ ! -d "$OUT" ]; then echo "ERR $OUT exists and is not a folder; nothing written"; exit 2; fi
[ -f "$M" ] || { echo "ERR master not found: $M"; exit 2; }
probe() { ffprobe -v error -select_streams v:0 "$@" -of default=nw=1 "$M"; }
P=$(probe -show_entries stream=nb_frames,r_frame_rate,color_space,color_range,pix_fmt,width,height)
get() { printf '%s\\n' "$P" | sed -n "s/^$1=//p" | head -1; }
NB=$(get nb_frames)
case "$NB" in ''|N/A|0) NB=$(probe -count_frames -show_entries stream=nb_read_frames | sed -n 's/^nb_read_frames=//p' | head -1);; esac
CS=$(get color_space); CR=$(get color_range)
TAGGED=false; MATRIX=bt709
case "$CS" in bt709) TAGGED=true;; smpte170m|bt470bg) TAGGED=true; MATRIX=bt601;; bt2020nc) TAGGED=true; MATRIX=bt2020;; esac
RANGE=tv; case "$CR" in pc|jpeg) RANGE=pc;; esac
echo "PROBE $NAME frames=$NB fps=$(get r_frame_rate) pix_fmt=$(get pix_fmt) size=$(get width)x$(get height) tag=\${CS:-none} range_tag=\${CR:-none} matrix=$MATRIX range=$RANGE tagged=$TAGGED"
if [ "$TAGGED" = false ]; then echo "NOTE $NAME the master carries no colour matrix tag: bt709 assumed"; fi
if [ -n "$WANT_FPS" ]; then echo "NOTE $NAME frame rate wanted $WANT_FPS, master says $(get r_frame_rate)"; fi
mkdir -p "$PARENT"
TMP="$PARENT/.dpx_tmp_$$"
mkdir "$TMP"
trap 'rm -rf "$TMP"' EXIT
${cmd} || { echo "ERR ffmpeg failed"; exit 3; }
N=$(find "$TMP" -maxdepth 1 -name '*.dpx' | wc -l | tr -d ' ')
echo "FRAMES $NAME $N"
if [ "$N" -eq 0 ]; then echo "ERR no frames written"; exit 3; fi
if [ -n "$EXPECTED" ] && [ "$N" != "$EXPECTED" ]; then echo "ERR frame count $N, expected $EXPECTED; not put in place"; exit 3; fi
BITS=$(od -An -tu1 -j803 -N1 "$TMP/$NAME.0000.dpx" | tr -d ' ')
MAGIC=$(head -c 4 "$TMP/$NAME.0000.dpx")
echo "CHECK $NAME bits=$BITS magic=$MAGIC"
if [ "$BITS" != 16 ]; then echo "ERR not 16-bit (byte 803 is $BITS); not put in place"; exit 3; fi
if [ -d "$OUT" ]; then rmdir "$OUT" || { echo "ERR $OUT is not empty; nothing written"; exit 2; }; fi
mv "$TMP" "$OUT"   # $OUT is absent here (an empty one was just removed), so a plain rename: works on Linux and macOS
trap - EXIT
echo "DONE $NAME $N"
`
}

interface Norm { master: string; shot: string; element: string; expected: number | null; fps: number | null }
function checkItems(items: unknown, round: unknown): { round: string; items: Norm[] } {
  const r = name(round ?? DEFAULT_ROUND, 'round')
  const list = Array.isArray(items) ? (items as MakeItem[]) : []; if (!list.length) throw bad('Give at least one item ({ master, shot, element })')
  const seen = new Set<string>()
  const out = list.map((it) => {
    const shot = name(it?.shot, 'shot'), element = name(it?.element, 'element'), master = masterPath(it?.master)
    let expected: number | null = null, fps: number | null = null
    if (it.frames_expected !== undefined) { if (!Number.isInteger(it.frames_expected) || it.frames_expected < 1 || it.frames_expected > 1e6) throw bad(`frames_expected ${String(it.frames_expected)} is not a frame count`); expected = it.frames_expected }
    if (it.fps !== undefined) { if (!(Number(it.fps) > 0 && Number(it.fps) <= 120)) throw bad(`fps ${String(it.fps)} is not a frame rate`); fps = Number(it.fps) }
    const key = outDirOf(r, shot, element); if (seen.has(key)) throw bad(`${shot} ${element} is listed twice`); seen.add(key)
    return { master, shot, element, expected, fps }
  })
  return { round: r, items: out }
}

/** Unpack the masters on the pod. One item at a time; a failure stops that item only. */
export async function run(o: { pod_id?: string; items?: MakeItem[]; round?: string; approved_by?: string; onLine?: (l: string) => void; signal?: AbortSignal }): Promise<{ results: MakeResult[]; out_root: string }> {
  const who = String(o.approved_by ?? '').trim(); if (!who) throw bad('Writing DPX frames on the volume needs the name of who says yes (approved_by)')
  const podId = String(o.pod_id ?? '').trim(); if (!podId) throw bad('Give the pod (pod_id): the frames are written on a pod that has the volume')
  const { round, items } = checkItems(o.items, o.round)
  const t = await deps.target(podId); if ('reason' in t) throw new CoreError(409, t.reason)
  const outRoot = deps.outputDir(podId), shared = outRoot.replace(/\/output\/*$/, ''), results: MakeResult[] = []
  for (const it of items) {
    const rel = outDirOf(round, it.shot, it.element), script = scriptFor({ shared, master: it.master, round, shot: it.shot, element: it.element, expected: it.expected, fps: it.fps })
    let frames = 0, ok = false, error = ''
    let colour = { matrix: 'bt709', range: 'tv', tagged: false }; const notes: string[] = []
    try {
      const r = await deps.ssh({ host: t.host, port: t.port, script, signal: o.signal ?? new AbortController().signal, onLine: (l) => {
        o.onLine?.(l)
        if (/^PROBE /.test(l)) { const m = /matrix=(\S+) range=(\S+) tagged=(true|false)/.exec(l); if (m) colour = { matrix: m[1], range: m[2], tagged: m[3] === 'true' } }
        const f = /^FRAMES \S+ (\d+)/.exec(l); if (f) frames = Number(f[1])
        const c = /^CHECK \S+ bits=(\d+)/.exec(l); if (c && c[1] === '16') ok = true
        if (/^NOTE /.test(l)) notes.push(l.replace(/^NOTE \S+ /, '').slice(0, 200))
        if (/^ERR /.test(l) && !error) error = l.slice(4, 240)
      } })
      if (r.code !== 0 && !error) error = `the script ended with code ${r.code}`
    } catch (e) { error = (e as Error).message.slice(0, 200) }
    if (!error && it.expected != null && frames !== it.expected) error = `frame count ${frames}, expected ${it.expected}`
    results.push({ shot: it.shot, element: it.element, frames, expected: it.expected, ok: ok && !error, out_dir: rel, colour, ...(notes.length ? { notes } : {}), ...(error ? { error } : {}) })
  }
  history.record({ kind: 'change', area: 'outputs', action: 'DPX unpacked from master videos', what: `${results.filter((r) => r.ok).length} of ${results.length} elements, round ${round}`, detail: `approved by ${who}; written under output/${round}/ on the volume; nothing existing is overwritten; straight unpack (no primaries or gamma conversion)` })
  return { results, out_root: outRoot }
}

export interface MakePlanRow { shot: string; element: string; master: string; out_dir: string; first_frame: string; last_frame: string | null; frames_expected: number | null }
/** What each item would write, nothing asked of a pod. */
export async function plan(o: { items?: Pick<MakeItem, 'master' | 'shot' | 'element' | 'frames_expected'>[]; round?: string } = {}): Promise<{ round: string; rows: MakePlanRow[] }> {
  const { round, items } = checkItems(o.items, o.round)
  return { round, rows: items.map((i) => {
    const dir = outDirOf(round, i.shot, i.element), n = dpxName(round, i.shot, i.element)
    return { shot: i.shot, element: i.element, master: i.master, out_dir: dir, first_frame: `${dir}/${n}.0000.dpx`, last_frame: i.expected ? `${dir}/${n}.${String(i.expected - 1).padStart(4, '0')}.dpx` : null, frames_expected: i.expected }
  }) }
}
