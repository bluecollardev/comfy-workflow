// Who started a job (the core's `trigger`, `mcp_client`, `external`): shown as a small badge in every Queue table and card. An older core has none of the fields: 'manual'.
/** @returns {{ label: string, key: string, title: string, external: boolean }} */
export function triggerInfo(job) {
  const raw = String(job?.trigger || 'window').toLowerCase()
  const key = raw === 'mcp' ? 'mcp' : raw === 'auto-publish' || raw === 'auto' ? 'auto' : raw === 'backfill' ? 'backfill' : 'manual'
  const label = { mcp: 'MCP', auto: 'auto', backfill: 'backfill', manual: 'manual' }[key]
  const title = key === 'mcp' && job?.mcp_client ? `MCP: ${job.mcp_client}` : key === 'auto' ? 'auto-publish' : ''
  return { label, key, title, external: !!job?.external }
}
export const EXTERNAL_TIP = 'Started by another process (MCP or a script); you can still cancel it'
