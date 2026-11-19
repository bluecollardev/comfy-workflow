// The nav Queue button counts EVERYTHING pending or working (v1.7.0): imports and syncs, render jobs (including auto-publish ones and jobs another process started), a preview batch, publish jobs (a parent once), Auto-publish entries in ANY non-final state
// (waiting, uploading, would upload in a dry run, capped), what it is generating or letting settle. The number is the total and is never hidden above 0; a volume scan alone is a dot. The button is yellow while something is pending or a dry run has entries, green while
// Auto-publish is LIVE and something is working; the tooltip lists the breakdown.
import { isActive } from './renders.js'
import { publishActive } from './publish.js'

/**
 * @param {{ queueCount?: number, renderJobs?: any[], previewsRunning?: boolean, publishJobs?: any[], entries?: any[], generate?: any, scanning?: boolean, autoLive?: boolean }} i
 * @returns {{ total: number, active: number, waiting: number, scanning: boolean, show: boolean, dot: boolean, pulse: boolean, tone: 'none'|'warning'|'success', text: string, parts: { key: string, n: number }[] }}
 */
export function queueBadge({ queueCount = 0, renderJobs = [], previewsRunning = false, publishJobs = [], entries = [], generate = null, scanning = false, autoLive = false } = {}) {
  const gens = (Array.isArray(renderJobs) ? renderJobs : []).filter(isActive)
  const autoGens = gens.filter((j) => j.trigger === 'auto-publish').length
  const pubs = (Array.isArray(publishJobs) ? publishJobs : []).filter((j) => j && !j.parent_id && j.kind !== 'scan' && publishActive(j))
  const autoPubs = pubs.filter((j) => j.trigger === 'auto-publish').length
  const ents = Array.isArray(entries) ? entries : []
  const uploadingEntries = ents.filter((e) => e.state === 'uploading').length
  const generating = Array.isArray(generate?.generating) ? generate.generating.length : Number(generate?.generating) || 0
  const settling = Array.isArray(generate?.waiting_to_settle) ? generate.waiting_to_settle.length : 0
  const parts = [
    { key: 'imports', n: Number(queueCount) || 0 },
    { key: 'generations', n: gens.length },
    { key: 'previews', n: previewsRunning ? 1 : 0 },
    { key: 'uploads', n: pubs.length + Math.max(0, uploadingEntries - autoPubs) },   // an upload entry is its publish job: counted once
    { key: 'autogen', n: Math.max(0, generating - autoGens) },   // the render itself is a Generations job: counted once
    { key: 'wouldUpload', n: ents.filter((e) => e.state === 'would_upload').length },
    { key: 'waiting', n: ents.filter((e) => ['waiting', 'capped'].includes(e.state)).length + settling },
  ].filter((p) => p.n > 0)
  const total = parts.reduce((n, p) => n + p.n, 0)
  const working = parts.some((p) => ['imports', 'generations', 'previews', 'uploads', 'autogen'].includes(p.key)) || !!scanning || (autoLive && parts.some((p) => p.key === 'waiting'))
  const dot = total === 0 && !!scanning
  const tone = total === 0 && !scanning ? 'none' : autoLive && working ? 'success' : 'warning'
  return { total, active: total, waiting: parts.find((p) => p.key === 'waiting')?.n || 0, scanning: !!scanning, show: total > 0 || dot, dot, pulse: working, tone, text: total > 99 ? '99+' : String(total), parts }
}
