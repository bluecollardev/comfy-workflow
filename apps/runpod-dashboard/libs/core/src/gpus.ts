/**
 * The GPUs a pod may use, with RunPod's ids. One table for every adapter.
 *
 * The job runs on binc-PC's RTX A4000 (16 GB) today; nothing in the packs asks for more than 24 GB.
 * So the menu is every RunPod card of 16 to 48 GB that costs no more than a 4090 in the secure
 * cloud (what a volume pod pays): the small Ampere and Ada cards, the L4, and the 48 GB workstation
 * cards (A40, A6000, L40) because the datacenter that holds the volume has them in stock when the
 * small ones are gone. Left out on purpose: A100, H100, L40S (several times the rate for no gain
 * here; since 2026-11-04 they are in the table as explicit-only cards that `auto` never picks), the RTX 6000 Ada (dearer than a 4090), and the Blackwell cards (RTX PRO 4000/4500/6000,
 * RTX 5090), which need CUDA 12.8+ while the image is built on 12.6. Since 2026-11-04 all of them are in the table as explicit-only cards (ADR-026, ADR-030); the Blackwell ones run the `-cu13` image.
 * In the secure cloud the A5000 and the 3090 are rarely offered; they stay for the community cloud.
 */
export const GPUS: Record<string, { id: string; name: string; vram: number; explicit?: true; cuda?: 13 }> = {
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
  // The big cards (Lucas, 2026-11-04: "i need the most powerful card"). Ids checked against RunPod's gpuTypes. They need CUDA 12.x only (Hopper, Ampere, Ada), so the image's 12.6 runs them.
  // `explicit`: never picked by `auto`, because they cost several times a 4090 and `auto` would fall to them whenever the small cards are out. Ask for one by name.
  l40s: { id: 'NVIDIA L40S', name: 'L40S', vram: 48, explicit: true },
  rtx6000ada: { id: 'NVIDIA RTX 6000 Ada Generation', name: 'RTX 6000 Ada', vram: 48, explicit: true },
  a100pcie: { id: 'NVIDIA A100 80GB PCIe', name: 'A100 PCIe', vram: 80, explicit: true },
  a100: { id: 'NVIDIA A100-SXM4-80GB', name: 'A100 SXM', vram: 80, explicit: true },
  h100pcie: { id: 'NVIDIA H100 PCIe', name: 'H100 PCIe', vram: 80, explicit: true },
  h100: { id: 'NVIDIA H100 80GB HBM3', name: 'H100 SXM', vram: 80, explicit: true },
  h200: { id: 'NVIDIA H200', name: 'H200 SXM', vram: 141, explicit: true },
  // The Blackwell cards (docs/ADR-030). Compute capability 12.0 needs CUDA 12.8 or newer, so they run the CUDA 13 image (`-cu13` tag, built by `build.sh --cuda 13`) on a host whose driver
  // offers CUDA 13; plan() picks the image and the host filter from `cuda`. Ids and sizes read from RunPod's gpuTypes on 2026-11-04. Explicit-only like the other big cards.
  rtx5080: { id: 'NVIDIA GeForce RTX 5080', name: 'RTX 5080', vram: 16, explicit: true, cuda: 13 },
  rtx5090: { id: 'NVIDIA GeForce RTX 5090', name: 'RTX 5090', vram: 32, explicit: true, cuda: 13 },
  rtxpro4000: { id: 'NVIDIA RTX PRO 4000 Blackwell', name: 'RTX PRO 4000', vram: 24, explicit: true, cuda: 13 },
  rtxpro4500: { id: 'NVIDIA RTX PRO 4500 Blackwell', name: 'RTX PRO 4500', vram: 32, explicit: true, cuda: 13 },
  rtxpro4500se: { id: 'NVIDIA RTX PRO 4500 Blackwell Server Edition', name: 'RTX PRO 4500 SE', vram: 32, explicit: true, cuda: 13 },
  rtxpro5000: { id: 'NVIDIA RTX PRO 5000 Blackwell', name: 'RTX PRO 5000', vram: 48, explicit: true, cuda: 13 },
  rtxpro6000: { id: 'NVIDIA RTX PRO 6000 Blackwell Server Edition', name: 'RTX PRO 6000', vram: 96, explicit: true, cuda: 13 },
  rtxpro6000wk: { id: 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition', name: 'RTX PRO 6000 WK', vram: 96, explicit: true, cuda: 13 },
  rtxpro6000q: { id: 'NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition', name: 'RTX PRO 6000 MaxQ', vram: 96, explicit: true, cuda: 13 },
  b200: { id: 'NVIDIA B200', name: 'B200', vram: 180, explicit: true, cuda: 13 },
  b300: { id: 'NVIDIA B300 SXM6 AC', name: 'B300', vram: 288, explicit: true, cuda: 13 },
}

/** CUDA versions a host may offer for a pod on the CUDA 13 image: the container's CUDA 13 needs a host driver that provides it (older RunPod hosts do not, and fail to start it). */
export const CUDA13_HOSTS = ['13.0', '13.1', '13.2', '13.3', '13.4']
/** 13 for a card that needs the CUDA 13 image (a key, RunPod id or display name), else undefined. */
export function cudaOf(key: string): 13 | undefined {
  for (const [k, g] of Object.entries(GPUS)) if (key === k || key === g.id || key === g.name) return g.cuda
  return undefined
}
/** Our image on the right CUDA for the card: `ghcr.io/.../comfy-app:<tag>` becomes `...:<tag>-cu13` for a card that needs it. Another image (the stock one, a custom reference) is left alone: it is the caller's to match. */
export function imageFor(image: string, key: string): string {
  return cudaOf(key) === 13 && /\/comfy-app:[^:/]+$/.test(image) && !image.endsWith('-cu13') ? `${image}-cu13` : image
}
/** The cards `auto` may choose from: the table without the explicit-only big cards. */
export const autoCards = () => Object.values(GPUS).filter((g) => !g.explicit)
/** `auto`: the cheapest card of the table that RunPod has in stock at that moment (pods.ts asks), then the next on failure. */
export const AUTO = 'auto'
export const DEFAULT_GPU = AUTO

/** RunPod's gpu_type_id for a short key; a full RunPod id passes through unchanged. */
export function runpodId(key: string): string {
  if (key in GPUS) return GPUS[key].id
  if (Object.values(GPUS).some((g) => g.id === key)) return key
  throw new Error(`unknown GPU ${JSON.stringify(key)}; options: ${Object.keys(GPUS).join(', ')}`)
}

/** Cards outside the table that a datacenter list or a pod can still show (Blackwell and others, by RunPod's display name), so a pod on one reports its real memory and not a default. */
export const OTHER_VRAM: Record<string, number> = { 'PRO 6000 MIG 24GB': 24, 'PRO 6000 MIG 48GB': 48, 'H100 NVL': 94, 'H200 NVL': 143, 'A100 SXM 40GB': 40 }
export function vram(key: string): number {
  for (const [k, g] of Object.entries(GPUS)) if (key === k || key === g.id || key === g.name) return g.vram   // RunPod's gpuDisplayName is the short name
  return OTHER_VRAM[key] ?? 0
}

export const menu = () => [{ value: AUTO, text: 'Cheapest card in stock (16-48 GB)' }, ...Object.entries(GPUS).map(([value, g]) => ({ value, text: `${g.name} (${g.vram} GB)${g.explicit ? ' · pick by name' : ''}${g.cuda === 13 ? ' · CUDA 13 image' : ''}` }))]
