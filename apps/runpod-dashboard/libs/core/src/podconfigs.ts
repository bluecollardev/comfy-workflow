/**
 * Per-pod configurations: a pod created with its own configuration (the Default Configuration's
 * shape, edited for that pod) keeps it here, keyed by pod id, so Recreate makes the new pod the
 * same way and the card can show and change it. Pods without an entry use the Default
 * Configuration. Stored in ~/.config/runpod-pod-manager/pod-configs.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { podConfigsFile } from './paths.js'
import type { MountsConfig } from './mounts.js'

type Registry = Record<string, MountsConfig>

export function load(): Registry {
  const f = podConfigsFile()
  if (!existsSync(f)) return {}
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} }
}
function save(reg: Registry) {
  const f = podConfigsFile()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(reg, null, 2) + '\n')
}

export const get = (podId: string): MountsConfig | null => load()[podId] ?? null
export const has = (podId: string): boolean => podId in load()
export function set(podId: string, cfg: MountsConfig): void { const reg = load(); reg[podId] = cfg; save(reg) }
export function forget(podId: string): void { const reg = load(); if (podId in reg) { delete reg[podId]; save(reg) } }
