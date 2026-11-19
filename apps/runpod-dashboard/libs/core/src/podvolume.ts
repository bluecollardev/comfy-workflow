/**
 * Which network volume a pod follows, when RunPod will not say: the API returns no networkVolumeId for a STOPPED pod. The volume last seen while the
 * pod ran is remembered (pod id -> volume id, persisted in the config folder) and used after the pod's own saved configuration. A tiny file: read
 * once, written atomically and async.
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { configDir } from './paths.js'

const file = () => join(configDir(), 'pod-volumes.json')
let map: Map<string, string> | null = null, loadedFrom = ''
const ensure = (): Map<string, string> => {
  if (map && loadedFrom === file()) return map
  map = new Map(); loadedFrom = file()
  try { const j = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>; for (const [k, v] of Object.entries(j)) if (typeof v === 'string' && v) map.set(k, v) } catch { /* none yet */ }
  return map
}
let writing: Promise<void> = Promise.resolve()
/** Remember the volume of a pod that is (or was just seen) running. Nothing is written when it did not change. */
export function remember(podId: string, volumeId: string): void {
  const m = ensure(); if (!podId || !volumeId || m.get(podId) === volumeId) return
  m.set(podId, volumeId)
  const snap = JSON.stringify(Object.fromEntries(m))
  writing = writing.then(async () => { const f = file(), t = `${f}.${process.pid}.tmp`; await mkdir(dirname(f), { recursive: true }); await writeFile(t, snap, { mode: 0o600 }); await rename(t, f) }).catch(() => undefined)
}
export const recall = (podId: string): string => ensure().get(podId) ?? ''
export const settled = (): Promise<void> => writing
/** Forget the in-memory copy (tests simulate a restart: the file is read again). */
export const reset = (): void => { map = null; loadedFrom = '' }
