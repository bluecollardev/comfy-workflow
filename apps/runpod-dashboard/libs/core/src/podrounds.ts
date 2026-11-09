/**
 * Pods in rounds (ADR-039): a round holds a series of pods. A map on our side from a pod's id to the delivery round it belongs to (the S3 round's name,
 * e.g. brynley-comfy-2026-11-06). RunPod is not told. A pod is in at most one round; a pod with no entry is unassigned. Stored in
 * ~/.config/runpod-pod-manager/pod-rounds.json, so it survives restarts and is gone when the pod is deleted.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { podRoundsFile, roundNamesFile } from './paths.js'

type Registry = Record<string, string>

export function load(): Registry {
  const f = podRoundsFile()
  if (!existsSync(f)) return {}
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} }
}
function save(reg: Registry) {
  const f = podRoundsFile()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(reg, null, 2) + '\n')
}
export const get = (podId: string): string | null => load()[podId] ?? null
/** Put a pod in a round; an empty name takes it out (unassigned). */
export function set(podId: string, round: string): void { const reg = load(); if (round) reg[podId] = round; else delete reg[podId]; save(reg) }
export function forget(podId: string): void { const reg = load(); if (podId in reg) { delete reg[podId]; save(reg) } }
/** The rounds that have pods, each with its pod ids, in round-name order. */
export function byRound(): { round: string; pod_ids: string[] }[] {
  const m = new Map<string, string[]>()
  for (const [id, r] of Object.entries(load())) { if (!m.has(r)) m.set(r, []); m.get(r)!.push(id) }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([round, pod_ids]) => ({ round, pod_ids }))
}

/** Round names on our side (a round is renamable): the round's key stays the delivery round's name, so the link to the bucket's round is kept; the label is what this app shows. */
function loadNames(): Registry {
  const f = roundNamesFile()
  if (!existsSync(f)) return {}
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} }
}
export const label = (round: string): string => loadNames()[round] || round
/** Name a round; an empty label goes back to the round's own name. */
export function setLabel(round: string, name: string): void {
  const reg = loadNames(); if (name) reg[round] = name; else delete reg[round]
  const f = roundNamesFile(); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(reg, null, 2) + '\n')
}
