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

/** Auto-publish (ADR-050) and the Outputs window's preferences are app-wide: a pod's own configuration never carries them. */
const strip = (cfg: MountsConfig): MountsConfig => { const { auto_publish: _a, outputs: _o, edl: _e, delivery_prepare: _d, ...rest } = cfg; return rest as MountsConfig }
export function load(): Registry {
  const f = podConfigsFile()
  if (!existsSync(f)) return {}
  try { const reg = JSON.parse(readFileSync(f, 'utf8')) as Registry; for (const k of Object.keys(reg)) reg[k] = strip(reg[k]); return reg } catch { return {} }
}
function save(reg: Registry) {
  const f = podConfigsFile()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(reg, null, 2) + '\n')
}

export const get = (podId: string): MountsConfig | null => load()[podId] ?? null
export const has = (podId: string): boolean => podId in load()
export function set(podId: string, cfg: MountsConfig): void { const reg = load(); reg[podId] = strip(cfg); save(reg) }
export function forget(podId: string): void { const reg = load(); if (podId in reg) { delete reg[podId]; save(reg) } }
