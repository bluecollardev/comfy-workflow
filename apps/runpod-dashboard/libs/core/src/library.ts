/**
 * The library: where rounds come from (docs/ADR-017, ADR-044). Import Round lists the rounds of one **source** at a time; every source
 * answers with the same `LibraryItem`, so the window does not care where a round lives. Step 1 of ADR-044: the BH bucket (the Panama
 * S3 source) is the first source and behaves exactly as before; the read-only volume source (ADR-044 step 2) lists Binc's rounds that
 * already sit on a network volume.
 *
 * A source only lists. Fetching, staging and importing stay where they are (panama.ts, queue.ts, imports.ts); nothing here writes.
 */
import { CoreError } from './errors.js'
import * as panama from './panama.js'
import * as settings from './settings.js'
import * as volumeround from './volumeround.js'

/** What the picker shows for a round, whatever its source. */
export interface LibraryItem {
  source: string
  /** unique within its source */
  id: string
  name: string
  kind?: string
  written_at?: string
  /** the round's shots; filled when the round is read (the plan), empty in a plain listing */
  shots: string[]
  files?: number
  bytes?: number
  /** a copy of the round is on this PC (BH) or already where the pods mount it (a volume) */
  staged: boolean
  verified: boolean
  /** an import can be started from this item (the app checks the round when it plans it) */
  importable: boolean
  /** BH only: how much of the round is on this PC: none, partial, unverified or complete, with the file counts */
  state?: panama.Staged['state']
  present?: number
  expected?: number | null
  missing?: number | null
  /** volume source: the volume the round sits on, its graph count, the shots that are locked (reference only), the variants, and why a folder is not importable */
  volume_id?: string
  graphs?: number
  locked?: string[]
  variants?: string[]
  note?: string
}

/** `needs: 'volume'`: the window offers a volume chooser for this source and passes the volume id to list(). */
export interface LibrarySourceInfo { id: string; name: string; hint: string; available: boolean; reason: string; needs?: 'volume' }
export interface ListOpts extends Partial<volumeround.VolumeOpts> { volume_id?: string }
interface LibrarySource { id: string; name: string; hint: string; needs?: 'volume'; availability: () => { ok: boolean; reason: string }; list: (o: ListOpts) => Promise<LibraryItem[]> }

/** A BH round as a library item: the same fields the picker always had, in the shared shape. */
export const itemOfRound = (r: panama.Round): LibraryItem => ({
  source: 'panama-s3', id: r.name, name: r.name, shots: [],
  staged: r.staged, verified: r.state === 'complete', importable: true,
  state: r.state, present: r.present, expected: r.expected, missing: r.missing, bytes: r.bytes,
})

const SOURCES: LibrarySource[] = [
  {
    id: 'panama-s3', name: 'BH (Panama bucket)', hint: 'The rounds BH delivers to the exchange bucket, downloaded to this PC and checked against their manifest.',
    availability: () => { const s = panama.status(); return { ok: s.configured, reason: s.reason } },
    list: async () => (await panama.roundsAsync()).map(itemOfRound),   // the async one: the sync one would hold the window while aws lists the bucket
  },
  {
    // ADR-044: Binc's rounds that already sit on a network volume. Read-only, over RunPod's S3 API from this PC: no pod, no spend, nothing written.
    id: 'volume', name: 'Volume (rounds already on a network volume)', needs: 'volume',
    hint: 'The rounds under comfy-shared/workflows/ on a network volume (the Shared volume by default), listed read-only over RunPod\'s S3 API: no pod, no cost. Importing runs them in place; nothing is copied, nothing on the volume is changed.',
    availability: () => (settings.lookup('RUNPOD_S3_ACCESS_KEY') && settings.lookup('RUNPOD_S3_SECRET_KEY') ? { ok: true, reason: '' } : { ok: false, reason: 'RUNPOD_S3_ACCESS_KEY and RUNPOD_S3_SECRET_KEY are not set (Default Configuration): without them only a pod could list a volume, so nothing was started.' }),
    list: (o) => volumeItems(o),
  },
]

/** The rounds of a volume as library items: one per folder of comfy-shared/workflows/, its shots and graph counts read from a prefix listing of that folder (cached a minute or two). A folder that is not a round (no <shot>/<graph> layout) is listed, not importable, with the reason. */
async function volumeItems(o: ListOpts): Promise<LibraryItem[]> {
  const id = (o.volume_id || volumeround.defaultVolumeId()).trim()
  const vo: volumeround.VolumeOpts = { aws: o.aws, now: o.now, fresh: o.fresh, client: o.client, s3StallMs: o.s3StallMs }
  const a = await volumeround.availability(id, vo)
  if (!a.ok) throw new CoreError(409, a.reason)
  const names = await volumeround.roundFolders(id, vo)
  const out: LibraryItem[] = []
  const queue = [...names]
  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      try {
        const d = await volumeround.describeRound(id, n, vo)
        out.push({ source: 'volume', id: n, name: n, kind: 'round', volume_id: id, shots: d.shots, files: d.graphs.length, graphs: d.graphs.length, bytes: d.graphs.reduce((x, g) => x + g.bytes, 0), locked: d.locked, variants: d.variants, staged: true, verified: false, importable: d.shots.some((s) => !d.locked.includes(s)), ...(d.shots.length ? {} : { note: 'no <shot>/<shot>__<variant>__<round>.json layout here: not a round' }) })
      } catch (e) { out.push({ source: 'volume', id: n, name: n, kind: 'round', volume_id: id, shots: [], staged: true, verified: false, importable: false, note: (e as Error).message }) }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return out.sort((x, y) => x.name.localeCompare(y.name))
}

export const DEFAULT_SOURCE = 'panama-s3'

/** The sources the picker offers, in order, with whether each can be used now and why not. */
export function sources(): LibrarySourceInfo[] {
  return SOURCES.map((s) => { const a = s.availability(); return { id: s.id, name: s.name, hint: s.hint, available: a.ok, reason: a.reason, ...(s.needs ? { needs: s.needs } : {}) } })
}

/** Whether a source can be used for this volume now (a volume source asks RunPod about the volume's datacenter), and why not. Spends nothing. */
export async function status(sourceId: string = DEFAULT_SOURCE, o: ListOpts = {}): Promise<{ available: boolean; reason: string; volume_id?: string }> {
  const s = SOURCES.find((x) => x.id === sourceId)
  if (!s) throw new CoreError(404, `No such source: ${sourceId} (have: ${SOURCES.map((x) => x.id).join(', ')})`)
  if (s.needs === 'volume') { const a = await volumeround.availability(o.volume_id, { aws: o.aws, client: o.client }); return { available: a.ok, reason: a.reason, volume_id: a.volume_id } }
  const a = s.availability(); return { available: a.ok, reason: a.reason }
}

/** The rounds of one source (the BH bucket by default). */
export async function list(sourceId: string = DEFAULT_SOURCE, o: ListOpts = {}): Promise<LibraryItem[]> {
  const s = SOURCES.find((x) => x.id === sourceId)
  if (!s) throw new CoreError(404, `No such source: ${sourceId} (have: ${SOURCES.map((x) => x.id).join(', ')})`)
  return s.list(o)
}

/** One round of a volume as the round adapter describes it (shots, graphs, locked), from a prefix listing: read-only. Default volume: the Shared one. */
export const round = (volumeId: string | undefined, name: string, o: Partial<volumeround.VolumeOpts> = {}) => volumeround.describeRound(volumeId || volumeround.defaultVolumeId(), name, o)
/** A round (or one shot) of comfy-shared/workflows/ as a read-only file tree, listed by prefix: Import Round's Browse Files for a volume round. */
export const roundFiles = (volumeId: string | undefined, name: string, shot?: string, o: Partial<volumeround.VolumeOpts> = {}) => volumeround.browseRound(volumeId || volumeround.defaultVolumeId(), name, shot || '', o)
/** The models a volume round's graphs name against the volume's model list (read-only, lazily, per round). */
export const preflight = (volumeId: string | undefined, name: string, o: { shots?: string[]; max_graphs?: number } & Partial<volumeround.VolumeOpts> = {}) => volumeround.preflightRound(volumeId || volumeround.defaultVolumeId(), name, { shots: o.shots, max_graphs: o.max_graphs }, o)
