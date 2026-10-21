/**
 * The GPUs a pod may use, with RunPod's ids. One table for every adapter.
 *
 * The job runs on binc-PC's RTX A4000 (16 GB) today; nothing in the packs asks for more than 24 GB.
 * So the menu is the 16-24 GB cards, cheapest first, plus the two 48 GB workstation cards that
 * cost no more than a 4090 (A40, A6000) because the datacenter that holds the volume has them in
 * stock when the small ones are gone. Bigger cards (A100, H100, L40S) are left out on purpose:
 * they cost several times the rate for no gain here.
 */
export const GPUS: Record<string, { id: string; name: string; vram: number }> = {
  a4000: { id: 'NVIDIA RTX A4000', name: 'RTX A4000', vram: 16 },
  rtx4000ada: { id: 'NVIDIA RTX 4000 Ada Generation', name: 'RTX 4000 Ada', vram: 20 },
  a5000: { id: 'NVIDIA RTX A5000', name: 'RTX A5000', vram: 24 },
  rtx3090: { id: 'NVIDIA GeForce RTX 3090', name: 'RTX 3090', vram: 24 },
  rtx4090: { id: 'NVIDIA GeForce RTX 4090', name: 'RTX 4090', vram: 24 },
  a6000: { id: 'NVIDIA RTX A6000', name: 'RTX A6000', vram: 48 },
  a40: { id: 'NVIDIA A40', name: 'A40', vram: 48 },
}
/** `auto`: the cheapest card of the table that RunPod has in stock at that moment (pods.ts asks), then the next on failure. */
export const AUTO = 'auto'
export const DEFAULT_GPU = AUTO

/** RunPod's gpu_type_id for a short key; a full RunPod id passes through unchanged. */
export function runpodId(key: string): string {
  if (key in GPUS) return GPUS[key].id
  if (Object.values(GPUS).some((g) => g.id === key)) return key
  throw new Error(`unknown GPU ${JSON.stringify(key)}; options: ${Object.keys(GPUS).join(', ')}`)
}

export function vram(key: string): number {
  for (const [k, g] of Object.entries(GPUS)) if (key === k || key === g.id || key === g.name) return g.vram   // RunPod's gpuDisplayName is the short name
  return 0
}

export const menu = () => [{ value: AUTO, text: 'Cheapest card in stock (16-48 GB)' }, ...Object.entries(GPUS).map(([value, g]) => ({ value, text: `${g.name} (${g.vram} GB)` }))]
