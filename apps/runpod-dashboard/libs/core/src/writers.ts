/**
 * Files written by write nodes that do not report them the usual way. ComfyUI's history lists a node's results as `{ filename, subfolder, type }`
 * entries, which is all the Outputs button and the gallery understand. A writer such as OCIOWrite (a DPX or EXR sequence plus a sidecar)
 * saves its frames to disk and reports only `saved: [<first file>]` and `count: [<n>]`, so a successful run looked like one with no outputs.
 * This rebuilds the file list from that report and the node's own settings in the run's API graph (`output_folder`, `filename`, `write_sidecar`).
 * Read-only: it names files, it never touches them.
 */
export interface WrittenFile { node: string; filename: string; subfolder: string }

/** A long sequence is listed up to this many frames (the gallery and a zip are for looking, not for a feature film). */
export const WRITER_FILE_CAP = 500

export function writtenFiles(outputs: Record<string, unknown> | undefined, api: unknown): WrittenFile[] {
  const out: WrittenFile[] = []
  const graph = (api && typeof api === 'object' ? api : {}) as Record<string, { inputs?: Record<string, unknown> } | undefined>
  for (const [node, v] of Object.entries(outputs || {})) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const first = Array.isArray(o.saved) && typeof o.saved[0] === 'string' ? (o.saved[0] as string) : ''
    if (!first || first.includes('/') || first.includes('\\')) continue
    const settings = graph[node]
    if (!settings) continue   // without the writer's own settings in the run's graph its folder is unknown: nothing is invented
    const inputs = settings.inputs || {}
    const folder = typeof inputs.output_folder === 'string' ? inputs.output_folder.replace(/^\/+|\/+$/g, '') : ''
    if (folder.split('/').includes('..')) continue   // a path out of ComfyUI's output folder is never listed
    const n = Math.max(1, Math.min(WRITER_FILE_CAP, parseInt(String(Array.isArray(o.count) ? o.count[0] : 1), 10) || 1))
    const m = /^(.*?)(\d+)(\.[A-Za-z0-9]+)$/.exec(first)   // name.0000.dpx: the first frame's number is the start
    if (n > 1 && m) {
      const width = m[2].length, start = parseInt(m[2], 10)
      for (let i = 0; i < n; i++) out.push({ node, filename: `${m[1]}${String(start + i).padStart(width, '0')}${m[3]}`, subfolder: folder })
    } else out.push({ node, filename: first, subfolder: folder })
    const base = inputs.filename
    if (inputs.write_sidecar === true && typeof base === 'string' && base && !base.includes('/')) out.push({ node, filename: `${base}.json`, subfolder: folder })
  }
  return out
}
