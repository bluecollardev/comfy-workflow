// Turns an MCP tool definition (name, description, inputSchema) into what the Docs modal shows.
// Grouping: a leading `[group]` tag in the description wins (bridge tools: nodes, queue, files, ...);
// untagged pod manager tools are grouped by name.

const POOL = new Set(['list_agents', 'get_pool_status', 'submit_job', 'get_job_status'])
const VOLUMES = new Set(['list_volumes', 'create_volume', 'delete_volume', 'set_default_volume'])
const SYNC = new Set(['sync', 'sync_status'])
const OTHER = new Set(['cost_now', 'list_datacenters', 'get_logs', 'set_idle_stop', 'governance'])

export function groupFor(name, tag) {
  if (tag) return tag.toLowerCase()
  if (POOL.has(name) || name.endsWith('_agent')) return 'pool'
  if (VOLUMES.has(name)) return 'volumes'
  if (SYNC.has(name)) return 'sync'
  if (name === 'get_configuration') return 'configuration'
  if (OTHER.has(name)) return 'other'
  if (/(^|_)pods?($|_)/.test(name)) return 'pods'
  return 'tools'
}

/** "GET /queue, POST /prompt" -> [{ method, path }]; a part without a method keeps the path only. */
export function parseCalls(s) {
  return s.split(',').map((x) => x.trim()).filter(Boolean).map((part) => {
    const m = part.match(/^([A-Z]+)\s+(.+)$/)
    return m ? { method: m[1], path: m[2].trim() } : { method: '', path: part }
  })
}

export function typeOf(p) {
  if (!p) return ''
  if (p.type === 'array') return p.items ? `array of ${typeOf(p.items) || 'any'}` : 'array'
  if (Array.isArray(p.type)) return p.type.join(' | ')
  if (p.type) return p.type
  if (p.properties) return 'object'
  if (p.enum) return 'enum'
  if (p.anyOf) return p.anyOf.map(typeOf).join(' | ')
  return ''
}

export function paramsOf(schema) {
  const props = schema?.properties || {}
  const req = new Set(schema?.required || [])
  return Object.entries(props).map(([name, p]) => {
    const q = p || {}
    const sub = q.properties ? q : (q.items?.properties ? q.items : null)
    return {
      name, type: typeOf(q), required: req.has(name),
      default: q.default === undefined ? '' : (typeof q.default === 'string' ? q.default : JSON.stringify(q.default)),
      options: Array.isArray(q.enum) ? q.enum.map(String) : [],
      range: q.minimum != null || q.maximum != null ? `${q.minimum ?? ''}–${q.maximum ?? ''}` : '',
      description: q.description || '',
      children: sub ? paramsOf(sub) : [],
    }
  })
}

export function parseTool(def) {
  let text = (def.description || '').trim()
  let tag = ''
  const tm = text.match(/^\[([A-Za-z0-9_-]+)\]\s*/)
  if (tm) { tag = tm[1]; text = text.slice(tm[0].length) }
  let calls = []
  const lines = text.split('\n')
  const cm = lines[lines.length - 1]?.match(/^\s*ComfyUI:\s*(.+)$/)
  if (cm) { calls = parseCalls(cm[1]); lines.pop(); text = lines.join('\n').trim() }
  return {
    name: def.name, group: groupFor(def.name, tag), text, calls, params: paramsOf(def.inputSchema),
    needsConfirm: (def.inputSchema?.required || []).includes('confirm'),
  }
}

/** Definitions -> [{ group, tools }] in first-seen order, filtered by a search over name and description. */
export function groupTools(defs, query = '') {
  const q = query.trim().toLowerCase()
  const groups = new Map()
  for (const d of defs || []) {
    const tool = parseTool(d)
    if (q && !`${tool.name} ${tool.text}`.toLowerCase().includes(q)) continue
    if (!groups.has(tool.group)) groups.set(tool.group, [])
    groups.get(tool.group).push(tool)
  }
  return [...groups].map(([group, tools]) => ({ group, tools }))
}
