/**
 * Which model files a pod's workflows use (ADR-042): a VAE and a diffusion model, chosen per pod. The choice is on our side
 * (~/.config/runpod-pod-manager/pod-models.json, dropped with the pod) and is applied when the pod runs workflows: the converted
 * graph's loader node gets the chosen file name. The choices are the files ComfyUI lists for that loader, so whatever is on the
 * pod's volume under models/vae and models/diffusion_models can be picked; nothing is downloaded here.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { podModelsFile } from './paths.js'
import { bad } from './errors.js'
import * as mounts from './mounts.js'

/** What can be chosen: a label, the ComfyUI loader class and the input that names the file. */
export const SLOTS = {
  vae: { class_type: 'VAELoader', input: 'vae_name' },
  diffusion_model: { class_type: 'UNETLoader', input: 'unet_name' },
} as const
export type Slot = keyof typeof SLOTS
export type Choice = Partial<Record<Slot, string>>
type Registry = Record<string, Choice>

function load(): Registry { const f = podModelsFile(); if (!existsSync(f)) return {}; try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} } }
function save(reg: Registry) { const f = podModelsFile(); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(reg, null, 2) + '\n') }

export const get = (podId: string): Choice => load()[podId] ?? {}
/** What a pod's workflows use: the Default Configuration's choice (`models`), over which the pod's own choice wins per slot. */
export function effective(podId: string): Choice {
  const def = mounts.load().models || { vae: '', diffusion_model: '' }
  return { ...(def.vae ? { vae: def.vae } : {}), ...(def.diffusion_model ? { diffusion_model: def.diffusion_model } : {}), ...get(podId) }
}
/** Set the pod's choice: a slot with a file name sets it, an empty string clears it (the graph keeps its own). */
export function set(podId: string, choice: Choice): Choice {
  const reg = load(), cur: Choice = { ...(reg[podId] ?? {}) }
  for (const [k, v] of Object.entries(choice)) {
    if (!(k in SLOTS)) throw bad(`Unknown model slot "${k}": ${Object.keys(SLOTS).join(', ')}.`)
    const name = String(v ?? '').trim()
    if (/[\\\0]|\.\./.test(name)) throw bad(`Not a model file name: ${name}`)
    if (name) cur[k as Slot] = name; else delete cur[k as Slot]
  }
  if (Object.keys(cur).length) reg[podId] = cur; else delete reg[podId]
  save(reg); return cur
}
export function forget(podId: string): void { const reg = load(); if (podId in reg) { delete reg[podId]; save(reg) } }

export interface Applied { slot: Slot; node: string; from: string; to: string }
/** Put the pod's choice into a converted (API) graph. A slot is applied only where the graph has exactly one loader of that class: with several (a VAE for the image and another for the upscaler) there is no telling which is meant, so they are left alone and named in `skipped`. */
export function apply(api: Record<string, unknown>, choice: Choice): { applied: Applied[]; skipped: string[] } {
  const applied: Applied[] = [], skipped: string[] = []
  for (const [slot, to] of Object.entries(choice) as [Slot, string][]) {
    const { class_type, input } = SLOTS[slot]
    const nodes = Object.entries(api).filter(([, n]) => (n as { class_type?: string })?.class_type === class_type)
    if (nodes.length === 0) continue
    if (nodes.length > 1) { skipped.push(`${slot}: ${nodes.length} ${class_type} nodes, left as they are`); continue }
    const [id, node] = nodes[0] as [string, { inputs?: Record<string, unknown> }]
    const inputs = (node.inputs ??= {})
    const from = String(inputs[input] ?? '')
    if (from !== to) { inputs[input] = to; applied.push({ slot, node: id, from, to }) }
  }
  return { applied, skipped }
}

/** The files ComfyUI offers for each slot on a running pod (GET /object_info/<loader>). */
export async function choices(base: string, fetchFn: typeof fetch = fetch): Promise<Record<Slot, string[]>> {
  const out = { vae: [], diffusion_model: [] } as Record<Slot, string[]>
  for (const [slot, { class_type, input }] of Object.entries(SLOTS) as [Slot, typeof SLOTS[Slot]][]) {
    try {
      const r = await fetchFn(`${base}/object_info/${class_type}`, { signal: AbortSignal.timeout(15_000) })
      if (r.status !== 200) continue
      const j = (await r.json()) as Record<string, { input?: { required?: Record<string, unknown[]> } }>
      const list = j?.[class_type]?.input?.required?.[input]?.[0]
      if (Array.isArray(list)) out[slot] = list.map(String)
    } catch { /* that slot stays empty */ }
  }
  return out
}
