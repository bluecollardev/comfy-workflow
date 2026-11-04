/**
 * Pod names on our side: a map from a pod's id to the name this app shows for it. RunPod's own name is untouched (it cannot be changed after creation
 * from here, and the console keeps showing it); the card, the lists and the MCP tools show ours when there is one. Stored in
 * ~/.config/runpod-pod-manager/pod-names.json, keyed by pod id, so a rename survives restarts and is gone when the pod is deleted.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { podNamesFile } from './paths.js'

type Registry = Record<string, string>

export function load(): Registry {
  const f = podNamesFile()
  if (!existsSync(f)) return {}
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} }
}
function save(reg: Registry) {
  const f = podNamesFile()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(reg, null, 2) + '\n')
}
export const get = (podId: string): string | null => load()[podId] ?? null
/** Set the name shown for a pod; an empty name removes it (the pod shows RunPod's name again). */
export function set(podId: string, name: string): void { const reg = load(); if (name) reg[podId] = name; else delete reg[podId]; save(reg) }
export function forget(podId: string): void { const reg = load(); if (podId in reg) { delete reg[podId]; save(reg) } }
