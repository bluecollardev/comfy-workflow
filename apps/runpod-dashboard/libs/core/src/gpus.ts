/**
 * The GPUs a pod may use, with RunPod's ids. One table for every adapter.
 *
 * The job runs on binc-PC's RTX A4000 (16 GB) today; nothing in the packs asks for more than 24 GB.
 * So the menu is the 16-24 GB cards, cheapest first, and the 4090 is the default. Bigger cards
 * (A100, H100, L40S) are left out on purpose: they cost several times the rate for no gain here.
 */
export const GPUS: Record<string, { id: string; name: string; vram: number }> = {
  a4000: { id: 'NVIDIA RTX A4000', name: 'RTX A4000', vram: 16 },
  a5000: { id: 'NVIDIA RTX A5000', name: 'RTX A5000', vram: 24 },
  rtx3090: { id: 'NVIDIA GeForce RTX 3090', name: 'RTX 3090', vram: 24 },
  rtx4090: { id: 'NVIDIA GeForce RTX 4090', name: 'RTX 4090', vram: 24 },
}
export const DEFAULT_GPU = 'rtx4090'

/** RunPod's gpu_type_id for a short key; a full RunPod id passes through unchanged. */
export function runpodId(key: string): string {
  if (key in GPUS) return GPUS[key].id
  if (Object.values(GPUS).some((g) => g.id === key)) return key
  throw new Error(`unknown GPU ${JSON.stringify(key)}; options: ${Object.keys(GPUS).join(', ')}`)
}

export function vram(key: string): number {
  for (const [k, g] of Object.entries(GPUS)) if (key === k || key === g.id) return g.vram
  return 0
}

export const menu = () => Object.entries(GPUS).map(([value, g]) => ({ value, text: `${g.name} (${g.vram} GB)` }))
