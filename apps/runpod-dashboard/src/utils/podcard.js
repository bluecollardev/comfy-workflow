// What the pod card says about the pod's hardware. Pure, so it is tested without the app.
/** The RAM guard's limit (chunking.DEFAULT_RAM_GUARD_PCT): at or above it the card turns to a warning. */
export const RAM_WARN_PCT = 85

/** 'RTX PRO 4500 x2 · 64 GB VRAM' for more than one card, 'RTX PRO 4500 · 32 GB' for one. */
export function gpuLine(pod) {
  const n = Number(pod?.gpu_count) > 1 ? Number(pod.gpu_count) : 1
  const per = Number(pod?.vram) || 0
  const total = Number(pod?.vram_total) || per * n
  if (n > 1) return { name: `${pod.gpu} x${n}`, vram: total ? `${total} GB VRAM` : '' }
  return { name: pod?.gpu || '', vram: per ? `${per} GB` : '' }
}

/** The container's memory, or null when it is not known (never a guess). `used` and `pct` only when read together with the limit. */
export function ramLine(pod) {
  const gb = Number(pod?.ram_gb)
  if (!(gb > 0)) return null
  const pct = pod.ram_pct != null ? Number(pod.ram_pct) : null
  return { limit: Math.round(gb), used: pod.ram_used_gb != null ? Math.round(Number(pod.ram_used_gb)) : null, pct, warn: pct != null && pct >= RAM_WARN_PCT }
}
