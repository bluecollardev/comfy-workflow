/**
 * This PC as a destination of an event (docs/ADR-072): nothing can send into this Mac from outside, so "push on event" is the app reacting to its own event
 * (Generated, Approved, Published) and bringing that folder down. No timer. The download is sourcesync's (volume over RunPod's S3 API, no pod): same-size files
 * are skipped, a file of another size is left alone, nothing is deleted, weights never come, and it is a Queue job. Best effort: it never fails the event.
 */
import { join, posix } from 'node:path'
import * as history from './history.js'
import * as mounts from './mounts.js'
import * as publish from './publish.js'
import * as sourcesync from './sourcesync.js'
import * as syncrules from './syncrules.js'
import type { Event } from './syncrules.js'

const WAIT_MS = 200, MAX_WAIT_MS = 15 * 60_000
const note = (ev: Event, what: string, detail: string) => { try { history.record({ kind: 'change', area: 'configuration', action: `copy to this PC on ${ev}`, what, detail: publish.redact(detail) }) } catch { /* a courtesy */ } }

async function copy(ev: Event, source: sourcesync.Source, prefix: string, dest_dir: string, what: string): Promise<void> {
  try {
    const { plan_id } = await sourcesync.plan({ source, prefix, dest_dir })
    let s = await sourcesync.planStatus(plan_id)
    for (let waited = 0; s.state === 'listing' && waited < MAX_WAIT_MS; waited += WAIT_MS) { await new Promise((r) => setTimeout(r, WAIT_MS)); s = await sourcesync.planStatus(plan_id) }
    if (s.state !== 'done' || !s.plan) return note(ev, what, `not copied: ${s.error || 'the listing did not finish'}`)
    if (!s.plan.to_copy.files) return
    if (!s.plan.can_start) return note(ev, what, `not copied: ${s.plan.reason || 'the plan cannot start'}`)
    await sourcesync.start({ plan_id })
    note(ev, what, `${s.plan.to_copy.files} file(s) being copied to this PC`)
  } catch (e) { note(ev, what, `not copied: ${(e as Error).message}`) }
}

/** `folders` are folders under /workspace on the volume, below comfy-shared/ (e.g. `comfy-shared/output/deliver/shot/v001`); each lands at the same place in the mapped ComfyUI-Shared. */
export async function onEvent(ev: Event, volumeId: string | null | undefined, folders: string[]): Promise<void> {
  try {
    if (!volumeId || !syncrules.wantsLocal(ev, volumeId)) return
    const shared = (mounts.load().folders['comfy-shared'] || '').trim()
    if (!shared) return note(ev, volumeId, 'not copied: ComfyUI-Shared is not mapped in Default Configuration > Folders')
    for (const folder of [...new Set(folders.map((f) => f.replace(/\/+$/, '')))]) {
      if (!folder.startsWith('comfy-shared/') || folder.split('/').includes('..')) continue
      await copy(ev, { type: 'volume', volume_id: volumeId }, folder, join(shared, folder.slice('comfy-shared/'.length)), folder)
    }
  } catch (e) { note(ev, String(volumeId), `failed: ${(e as Error).message}`) }
}

/** This PC pulls from a storage: `keys` (below the storage's directory) are what the app just put there on this event; their folders come down to the same place under ComfyUI-Shared/output, as Pull Now lays them out. */
export async function fromStorage(ev: Event, storageId: string, keys: string[]): Promise<void> {
  try {
    if (!syncrules.storageWantsLocal(ev, storageId)) return
    const shared = (mounts.load().folders['comfy-shared'] || '').trim()
    if (!shared) return note(ev, storageId, 'not copied: ComfyUI-Shared is not mapped in Default Configuration > Folders')
    for (const folder of [...new Set(keys.map((k) => posix.dirname(k)))]) {
      if (folder === '.' || folder.startsWith('/') || folder.split('/').includes('..')) continue
      await copy(ev, { type: 'storage', storage_id: storageId }, folder, join(shared, 'output', folder), `${storageId}: ${folder}`)
    }
  } catch (e) { note(ev, storageId, `failed: ${(e as Error).message}`) }
}
