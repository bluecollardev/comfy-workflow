/**
 * The GPUs a pod may use, with RunPod's ids. One table for every adapter.
 *
 * The job runs on binc-PC's RTX A4000 (16 GB) today; nothing in the packs asks for more than 24 GB.
 * So the menu is every RunPod card of 16 to 48 GB that costs no more than a 4090 in the secure
 * cloud (what a volume pod pays): the small Ampere and Ada cards, the L4, and the 48 GB workstation
 * cards (A40, A6000, L40) because the datacenter that holds the volume has them in stock when the
 * small ones are gone. Left out on purpose: A100, H100, L40S (several times the rate for no gain
 * here), the RTX 6000 Ada (dearer than a 4090), and the Blackwell cards (RTX PRO 4000/4500/6000,
 * RTX 5090), which need CUDA 12.8+ while the image is built on 12.6 (build.sh --base for a newer one).
 * In the secure cloud the A5000 and the 3090 are rarely offered; they stay for the community cloud.
 */
export const GPUS: Record<string, { id: string; name: string; vram: number }> = {
  rtx2000ada: { id: 'NVIDIA RTX 2000 Ada Generation', name: 'RTX 2000 Ada', vram: 16 },
  a4000: { id: 'NVIDIA RTX A4000', name: 'RTX A4000', vram: 16 },
  rtx4000ada: { id: 'NVIDIA RTX 4000 Ada Generation', name: 'RTX 4000 Ada', vram: 20 },
  a5000: { id: 'NVIDIA RTX A5000', name: 'RTX A5000', vram: 24 },
  rtx3090: { id: 'NVIDIA GeForce RTX 3090', name: 'RTX 3090', vram: 24 },
  l4: { id: 'NVIDIA L4', name: 'L4', vram: 24 },
  rtx4090: { id: 'NVIDIA GeForce RTX 4090', name: 'RTX 4090', vram: 24 },
  a6000: { id: 'NVIDIA RTX A6000', name: 'RTX A6000', vram: 48 },
  a40: { id: 'NVIDIA A40', name: 'A40', vram: 48 },
  l40: { id: 'NVIDIA L40', name: 'L40', vram: 48 },
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
