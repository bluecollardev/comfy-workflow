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
import * as edl from './edl.js'
import * as history from './history.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as podpull from './podpull.js'
import * as rp from './runpod.js'
import * as sync from './sync.js'

export interface MakeItem { /** path of the master video relative to the volume's comfy-shared/ folder */ master: string; shot: string; element: string; /** the frame count the PDF gives; a different count fails the item and nothing is put in place */ frames_expected?: number; /** the frame rate it should be; its rounded value is the timecode base (default 23.976, base 24) */ fps?: number
  /** the cut: only these ranges of the master, in order, become one contiguous sequence. HH:MM:SS:FF, `in` inclusive, `out` EXCLUSIVE (as in the CMX3600 EDL: its source-out is the frame after the last one used). Absent = the whole master */
  source_ranges?: { in: string; out: string }[]
  /** the timecode of the master's first frame (default: the master's own `timecode` tag when it has one, else 00:00:00:00) */ start_timecode_of_master?: string
  /** fill frames_expected, source_ranges and fps from the loaded EDL (needs shot and element) */ from_edl?: boolean }
export interface MakeResult { shot: string; element: string; frames: number; expected: number | null; ok: boolean; out_dir: string; colour: { matrix: string; range: string; tagged: boolean }; /** the master frames each range was unpacked from (as the pod worked them out) */ ranges?: RangeRow[]; notes?: string[]; error?: string }
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

export const TC = /^(\d\d):([0-5]\d):([0-5]\d):(\d\d)$/
export const MAX_RANGES = 20
export const baseOf = (fps: number) => Math.max(1, Math.round(fps))   // non-drop: 23.976 and 24 both count 24 to the second
export function tcToFrames(tc: string, base: number): number {
  const m = TC.exec(String(tc)); if (!m) throw bad(`${String(tc).slice(0, 40)} is not a timecode HH:MM:SS:FF`)
  if (Number(m[4]) >= base) throw bad(`${tc}: the frame field must be below ${base}`)
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * base + Number(m[4])
}
export interface RangeRow { in: string; out: string; /** master frame number of the first frame (0 = the master's first) */ first_frame: number; /** the frame AFTER the last one used */ end_frame: number; frames: number }
/** The ffmpeg select expression for the rows: frame n is kept when n is in [first, end). */
export const selectExpr = (rows: { first_frame: number; end_frame: number }[]): string => rows.map((r) => `between(n\\,${r.first_frame}\\,${r.end_frame - 1})`).join('+')
/** Master frame numbers for a cut. Pure arithmetic: the same the pod's script does with the master's own frame rate. Strict: ascending, no overlap, out after in, at most 20 ranges. */
export function rangeFrames(ranges: { in: string; out: string }[], o: { fps?: number; start?: string } = {}): { base: number; rows: RangeRow[]; total: number; select: string } {
  if (!Array.isArray(ranges) || !ranges.length) throw bad('source_ranges is empty')
  if (ranges.length > MAX_RANGES) throw bad(`At most ${MAX_RANGES} source ranges, got ${ranges.length}`)
  const base = baseOf(o.fps ?? 23.976), zero = tcToFrames(o.start ?? '00:00:00:00', base)
  let prev = -1, total = 0
  const rows = ranges.map((r, i) => {
    const a = tcToFrames(r?.in, base), b = tcToFrames(r?.out, base)
    if (b <= a) throw bad(`Range ${i + 1}: out ${r.out} is not after in ${r.in}`)
    if (a < prev) throw bad(`Range ${i + 1}: ${r.in} overlaps or comes before the range before it (ranges ascend and do not overlap)`)
    if (a < zero) throw bad(`Range ${i + 1}: ${r.in} is before the master's start ${o.start ?? '00:00:00:00'}`)
    prev = b; total += b - a
    return { in: r.in, out: r.out, first_frame: a - zero, end_frame: b - zero, frames: b - a }
  })
  return { base, rows, total, select: selectExpr(rows) }
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
export function ffmpegArgs(o: { input: string; out: string; matrix: string; range: string; /** a select expression: only those frames, written without duplication */ select?: string; /** an old ffmpeg without -fps_mode */ oldVsync?: boolean }): string[] {
  const vf = `${o.select ? `select='${o.select}',` : ''}${scaleFilter(o.matrix, o.range)}`
  return ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y', '-i', o.input, '-vf', vf, ...(o.select ? (o.oldVsync ? ['-vsync', '0'] : ['-fps_mode', 'passthrough']) : []), '-c:v', 'dpx', '-pix_fmt', 'rgb48le', '-start_number', '0', o.out]
}
const sh = (a: string) => (a.includes('$') ? `"${a}"` : q(a))

export const outDirOf = (round: string, shot: string, element: string) => `${round}/${shot}/${shot}_${element}/dpx`
export const dpxName = (round: string, shot: string, element: string) => `${shot}_${element}_${round}_NOT_RELEASED`

/** The pod script for one item: probe, unpack into a temporary sibling, count, check the bit depth, rename into place. */
export function scriptFor(o: { shared: string; master: string; round: string; shot: string; element: string; expected?: number | null; fps?: number | null; ranges?: { in: string; out: string }[] | null; start?: string | null }): string {
  const out = `${o.shared}/output/${outDirOf(o.round, o.shot, o.element)}`, nm = dpxName(o.round, o.shot, o.element)
  const cut = !!o.ranges?.length
  const cmd = ['nice', 'ffmpeg', ...ffmpegArgs({ input: '$M', out: '$TMP/$NAME.%04d.dpx', matrix: '$MATRIX', range: '$RANGE', ...(cut ? { select: '$SEL' } : {}) }).map(sh)].join(' ').replace(`'-fps_mode' 'passthrough'`, '$VSYNC')
  const cutBash = cut ? `RANGES=(${o.ranges!.map((r) => q(`${r.in}-${r.out}`)).join(' ')})
START=${q(o.start ?? '')}
TCTAG=$(ffprobe -v error -show_entries stream_tags=timecode:format_tags=timecode -of default=nw=1 "$M" | sed -n 's/^TAG:timecode=//p' | head -1 | tr ';' ':')
if [ -n "$START" ]; then ZERO_TC="$START"; echo "NOTE $NAME master timecode base $START (given)"
elif [ -n "$TCTAG" ]; then ZERO_TC="$TCTAG"; echo "NOTE $NAME master timecode base $TCTAG (the master's own timecode tag)"
else ZERO_TC=00:00:00:00; echo "NOTE $NAME master timecode base 00:00:00:00 (the master has no timecode tag)"; fi
tcf() { local h m s f; IFS=: read -r h m s f <<< "$1"; if [ "$((10#$f))" -ge "$BASE" ]; then echo "ERR timecode $1: frame field not below $BASE" >&2; return 1; fi; echo $(( ((10#$h*60+10#$m)*60+10#$s)*BASE + 10#$f )); }
ZERO=$(tcf "$ZERO_TC") || { echo "ERR bad master timecode $ZERO_TC"; exit 2; }
SEL=''; TOTAL=0
for R in "\${RANGES[@]}"; do
  RIN=\${R%-*}; ROUT=\${R#*-}
  A=$(( $(tcf "$RIN") - ZERO )); B=$(( $(tcf "$ROUT") - ZERO ))
  if [ "$A" -lt 0 ] || [ "$B" -le "$A" ] || { [ -n "$NB" ] && [ "$B" -gt "$NB" ]; }; then echo "ERR range $RIN-$ROUT is master frames $A..$((B-1)); the master has \${NB:-?} frames"; exit 2; fi
  SEL="\${SEL:+$SEL+}between(n\\\\,$A\\\\,$((B-1)))"; TOTAL=$((TOTAL + B - A))
  echo "RANGE $NAME $RIN $ROUT $A $((B - A))"
done
echo "SELECT $NAME $SEL"
VSYNC="-fps_mode passthrough"; if [ "$(ffmpeg -hide_banner -h full 2>/dev/null | grep -c fps_mode || true)" -eq 0 ]; then VSYNC="-vsync 0"; fi
` : 'TOTAL=0\n'
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
BASE=$(awk -v f="$(get r_frame_rate)" 'BEGIN { split(f, a, "/"); v = (a[2] + 0 > 0) ? a[1] / a[2] : a[1]; printf "%d", v + 0.5 }')
if [ -n "$WANT_FPS" ] && [ "$BASE" != "$(awk -v w="$WANT_FPS" 'BEGIN { printf "%d", w + 0.5 }')" ]; then echo "NOTE $NAME frame rate wanted $WANT_FPS, master says $(get r_frame_rate)"; fi
${cutBash}mkdir -p "$PARENT"
TMP="$PARENT/.dpx_tmp_$$"
mkdir "$TMP"
trap 'rm -rf "$TMP"' EXIT
${cmd} || { echo "ERR ffmpeg failed"; exit 3; }
N=$(find "$TMP" -maxdepth 1 -name '*.dpx' | wc -l | tr -d ' ')
echo "FRAMES $NAME $N"
if [ "$N" -eq 0 ]; then echo "ERR no frames written"; exit 3; fi
if [ "$TOTAL" -gt 0 ] && [ "$N" != "$TOTAL" ]; then echo "ERR frame count $N, the ranges are $TOTAL frames; not put in place"; exit 3; fi
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

interface Norm { master: string; shot: string; element: string; expected: number | null; fps: number | null; ranges: { in: string; out: string }[] | null; start: string | null; rows: RangeRow[] | null }
/** An element is a CUT of its master: the loaded EDL gives its frames and its source ranges (in inclusive, out exclusive). A retimed element cannot be unpacked straight. */
function fromEdl(it: MakeItem, shot: string, element: string): MakeItem {
  if (!edl.isLoaded()) throw new CoreError(409, 'The EDL is not loaded: load it first (edl load), then ask again with from_edl')
  const m = edl.lookup({ shot, element })
  if (m.match === 'not-in-edl') throw bad(`${shot} ${element} is not in the loaded EDL`)
  if (m.match === 'ambiguous') throw bad(`${shot} ${element} matches more than one EDL element: ${m.candidates.map((c) => c.clip).join(', ')}`)
  const e = m.element
  if (e.speeds.some((v) => v !== 100)) throw bad(`${e.clip} has a retime in the EDL (speeds ${e.speeds.join(', ')}%): it cannot be unpacked straight`)
  const norm = (t: string) => t.replace(/;/g, ':')
  // the EDL has empty ranges (ARCHIVAL-123_F: in and out both 00:00:04:20): they hold no frame and are dropped
  return { ...it, frames_expected: it.frames_expected ?? e.frames_in_cut, source_ranges: it.source_ranges ?? e.source_ranges.map((x) => ({ in: norm(x.in), out: norm(x.out) })).filter((x) => x.in !== x.out), fps: it.fps ?? edl.FPS }
}
function checkItems(items: unknown, round: unknown): { round: string; items: Norm[] } {
  const r = name(round ?? DEFAULT_ROUND, 'round')
  const list = Array.isArray(items) ? (items as MakeItem[]) : []; if (!list.length) throw bad('Give at least one item ({ master, shot, element })')
  const seen = new Set<string>()
  const out = list.map((it0) => {
    let it = it0
    const shot = name(it?.shot, 'shot'), element = name(it?.element, 'element')
    if (it.from_edl) it = fromEdl(it, shot, element)
    const master = masterPath(it?.master)
    let expected: number | null = null, fps: number | null = null
    if (it.frames_expected !== undefined) { if (!Number.isInteger(it.frames_expected) || it.frames_expected < 1 || it.frames_expected > 1e6) throw bad(`frames_expected ${String(it.frames_expected)} is not a frame count`); expected = it.frames_expected }
    if (it.fps !== undefined) { if (!(Number(it.fps) > 0 && Number(it.fps) <= 120)) throw bad(`fps ${String(it.fps)} is not a frame rate`); fps = Number(it.fps) }
    let ranges: { in: string; out: string }[] | null = null, rows: RangeRow[] | null = null, start: string | null = null
    if (it.start_timecode_of_master !== undefined) { if (!TC.test(String(it.start_timecode_of_master))) throw bad(`start_timecode_of_master must be HH:MM:SS:FF: ${String(it.start_timecode_of_master).slice(0, 40)}`); start = it.start_timecode_of_master }
    if (it.source_ranges !== undefined) {
      const g = rangeFrames(it.source_ranges, { fps: fps ?? undefined, start: start ?? undefined })
      if (expected !== null && expected !== g.total) throw bad(`frames_expected ${expected} is not the ${g.total} frames of the ranges`)
      expected = g.total; rows = g.rows; ranges = it.source_ranges.map((x) => ({ in: x.in, out: x.out }))
    }
    const key = outDirOf(r, shot, element); if (seen.has(key)) throw bad(`${shot} ${element} is listed twice`); seen.add(key)
    return { master, shot, element, expected, fps, ranges, start, rows }
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
    const rel = outDirOf(round, it.shot, it.element), script = scriptFor({ shared, master: it.master, round, shot: it.shot, element: it.element, expected: it.expected, fps: it.fps, ranges: it.ranges, start: it.start })
    let frames = 0, ok = false, error = ''
    let colour = { matrix: 'bt709', range: 'tv', tagged: false }; const notes: string[] = [], ranges: RangeRow[] = []
    try {
      const r = await deps.ssh({ host: t.host, port: t.port, script, signal: o.signal ?? new AbortController().signal, onLine: (l) => {
        o.onLine?.(l)
        if (/^PROBE /.test(l)) { const m = /matrix=(\S+) range=(\S+) tagged=(true|false)/.exec(l); if (m) colour = { matrix: m[1], range: m[2], tagged: m[3] === 'true' } }
        const rg = /^RANGE \S+ (\S+) (\S+) (\d+) (\d+)$/.exec(l); if (rg) ranges.push({ in: rg[1], out: rg[2], first_frame: Number(rg[3]), end_frame: Number(rg[3]) + Number(rg[4]), frames: Number(rg[4]) })
        const f = /^FRAMES \S+ (\d+)/.exec(l); if (f) frames = Number(f[1])
        const c = /^CHECK \S+ bits=(\d+)/.exec(l); if (c && c[1] === '16') ok = true
        if (/^NOTE /.test(l)) notes.push(l.replace(/^NOTE \S+ /, '').slice(0, 200))
        if (/^ERR /.test(l) && !error) error = l.slice(4, 240)
      } })
      if (r.code !== 0 && !error) error = `the script ended with code ${r.code}`
    } catch (e) { error = (e as Error).message.slice(0, 200) }
    if (!error && it.expected != null && frames !== it.expected) error = `frame count ${frames}, expected ${it.expected}`
    results.push({ shot: it.shot, element: it.element, frames, expected: it.expected, ok: ok && !error, out_dir: rel, colour, ...(ranges.length ? { ranges } : {}), ...(notes.length ? { notes } : {}), ...(error ? { error } : {}) })
  }
  history.record({ kind: 'change', area: 'outputs', action: 'DPX unpacked from master videos', what: `${results.filter((r) => r.ok).length} of ${results.length} elements, round ${round}`, detail: `approved by ${who}; written under output/${round}/ on the volume; nothing existing is overwritten; straight unpack (no primaries or gamma conversion)` })
  return { results, out_root: outRoot }
}

export interface MakePlanRow { shot: string; element: string; master: string; out_dir: string; first_frame: string; last_frame: string | null; frames_expected: number | null; /** the master frames each range maps to (at the item's fps, default 23.976 = base 24; the pod uses the master's own rate) */ ranges?: RangeRow[]; select?: string; master_timecode_base?: string }
/** What each item would write, nothing asked of a pod. */
export async function plan(o: { items?: Partial<MakeItem>[]; round?: string } = {}): Promise<{ round: string; rows: MakePlanRow[] }> {
  const { round, items } = checkItems(o.items, o.round)
  return { round, rows: items.map((i) => {
    const dir = outDirOf(round, i.shot, i.element), n = dpxName(round, i.shot, i.element)
    return { shot: i.shot, element: i.element, master: i.master, out_dir: dir, first_frame: `${dir}/${n}.0000.dpx`, last_frame: i.expected ? `${dir}/${n}.${String(i.expected - 1).padStart(4, '0')}.dpx` : null, frames_expected: i.expected, ...(i.rows ? { ranges: i.rows, select: selectExpr(i.rows), master_timecode_base: i.start ?? "the master's timecode tag, else 00:00:00:00" } : {}) }
  }) }
}
