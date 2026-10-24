// Built-in adapter: a folder already in the ComfyUI-Shared structure (input/, models/, workflows/, output/).
// Copies input/, workflows/ and models/ as they are; output/ is what pods write, so it is left. With
// options.link, models are linked instead of duplicated.
export default {
  id: 'comfy-shared',
  name: 'A ComfyUI-Shared folder',
  version: 1,

  async detect(root, ctx) {
    const present = []
    for (const d of ['input', 'models', 'workflows', 'output']) if ((await ctx.stat(d))?.isDir) present.push(d + '/')
    const delivery = await ctx.exists('MANIFEST.json')
    return { match: present.length >= 2 && !delivery ? 1 : present.length && !delivery ? 0.4 : 0, evidence: present }
  },

  async plan(root, ctx) {
    const ops = [], findings = []
    const kinds = { input: 'input', workflows: 'workflow', models: 'model' }
    for (const [dir, kind] of Object.entries(kinds)) {
      if (!(await ctx.stat(dir))?.isDir) continue
      const files = await ctx.list(dir, { recursive: true })
      for (const f of files) {
        if (f.name === '.DS_Store') continue
        ops.push({ op: dir === 'models' && ctx.options.link ? 'link' : 'copy', kind, from: f.path, to: f.path, bytes: f.bytes })
      }
      findings.push({ level: 'info', text: `${dir}/: ${files.length} files` })
    }
    if ((await ctx.stat('output'))?.isDir) { ops.push({ op: 'note', kind: 'reference', from: 'output', note: 'output/ is written by pods; not imported' }) }
    if (!ops.some((o) => o.op !== 'note')) findings.push({ level: 'problem', text: 'nothing to import: no input/, workflows/ or models/ folder' })
    return { ops, findings }
  },
}
