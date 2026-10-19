/**
 * No-spend mode: pods are simulated, nothing reaches RunPod, nothing bills.
 *
 * On when the configuration's `dry_run` is true or RUNPOD_DRY_RUN=1. Simulated pods live in
 * ~/.config/runpod-pod-manager/dry-pods.json with the same shape the dashboard shows for real
 * ones (id, status, uptime, URL), so every screen, action and test runs the same way; the only
 * difference is the badge the dashboard shows and the ids, which start with `dry-`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CoreError } from './errors.js'
import * as gpus from './gpus.js'
import { configDir } from './paths.js'
import type { PodStatus } from './pods.js'

interface DryPod { id: string; name: string; gpu: string; gpu_count: number; image: string; status: 'running' | 'stopped'; started_at: string | null; idle_stop_minutes: number }

export const file = () => process.env.DRY_PODS_FILE || join(configDir(), 'dry-pods.json')
export const BOOT_SECONDS = 20   // a simulated pod reports "starting" for this long, like a real one

function load(): DryPod[] {
  const f = file()
  if (!existsSync(f)) return []
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return [] }
}
function save(pods: DryPod[]) {
  const f = file()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(pods, null, 2) + '\n')
}

export function toStatus(p: DryPod, now = Date.now()): PodStatus {
  const uptime = p.status === 'running' && p.started_at ? Math.floor((now - new Date(p.started_at).getTime()) / 1000) : null
  const starting = uptime != null && uptime < BOOT_SECONDS
  return {
    id: p.id, name: p.name, status: p.status === 'running' ? (starting ? 'starting' : 'running') : 'stopped',
    gpu: `${gpus.GPUS[p.gpu]?.name || p.gpu} x${p.gpu_count}`, vram: gpus.vram(p.gpu) * p.gpu_count,
    uptime_seconds: uptime, web_ui_url: p.status === 'running' && !starting ? `https://${p.id}-8188.proxy.runpod.net` : null,
    ssh_command: `ssh root@${p.id}.proxy.runpod.io`, idle_stop_minutes: p.idle_stop_minutes,
    console_url: `https://www.runpod.io/console/pods/${p.id}`, status_text: p.status === 'running' ? (starting ? 'Starting (simulated)' : 'Running (simulated)') : 'Stopped (simulated)',
  }
}

export function create(req: { name: string; gpu?: string; gpu_count?: number; image: string; idle_stop_minutes: number }): PodStatus {
  const pods = load()
  const id = `dry-${String(pods.length + 1).padStart(4, '0')}${Math.random().toString(36).slice(2, 6)}`
  const p: DryPod = { id, name: req.name, gpu: req.gpu || gpus.DEFAULT_GPU, gpu_count: req.gpu_count ?? 1, image: req.image, status: 'running', started_at: new Date().toISOString(), idle_stop_minutes: req.idle_stop_minutes }
  pods.push(p); save(pods)
  return toStatus(p)
}

export const list = (): PodStatus[] => load().map((p) => toStatus(p))

function change(id: string, fn: (p: DryPod) => void) {
  const pods = load()
  const p = pods.find((x) => x.id === id)
  if (!p) throw new CoreError(404, `Pod ${id} not found (no-spend mode)`)
  fn(p); save(pods)
  return p
}
export const stop = (id: string) => { change(id, (p) => { p.status = 'stopped'; p.started_at = null }); return { message: `Pod ${id} stopped (simulated)`, pod_id: id } }
export const resume = (id: string) => { change(id, (p) => { p.status = 'running'; p.started_at = new Date().toISOString() }); return { message: `Pod ${id} resumed (simulated)`, pod_id: id } }
export const remove = (id: string) => { const pods = load(); if (!pods.some((p) => p.id === id)) throw new CoreError(404, `Pod ${id} not found (no-spend mode)`); save(pods.filter((p) => p.id !== id)); return { message: `Pod ${id} deleted (simulated)`, pod_id: id } }
export const runningIds = () => new Set(load().filter((p) => p.status === 'running').map((p) => p.id))
export const clear = () => save([])
