// The child process an adapter runs in (docs/ADR-008, docs/IMPORT-ADAPTERS.md).
//
//   node [--permission --allow-fs-read=<source> --allow-fs-read=<this file> --allow-fs-read=<adapter>] \
//        adapter-runner.mjs <adapter file> <info|detect|plan> <source folder> <options json>
//
// Imports one adapter, hands it a read-only `ctx` confined to the source folder, and prints ONE JSON
// line: {ok:true, result} or {ok:false, error}. It writes nothing; the app applies the plan.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The ComfyUI-Shared structure an adapter lands things in, as data (docs/IMPORT-ADAPTERS.md). */
export const TARGET = {
  input: 'input', workflows: 'workflows', models: 'models', output: 'output', nodePacks: 'node-packs',
  note: 'input/, workflows/ and models/ take files; output/ is written by pods; node-packs/ stages custom nodes (the -vN dropped)',
}

const [adapterFile, action, sourceArg, optionsJson] = process.argv.slice(2)

async function main() {
  if (!adapterFile || !['info', 'detect', 'plan'].includes(action) || (action !== 'info' && !sourceArg)) throw new Error('usage: adapter-runner.mjs <adapter file> <info|detect|plan> [source folder] [options json]')
  const root = sourceArg ? await realpath(resolve(sourceArg)) : process.cwd()
  const options = optionsJson ? JSON.parse(optionsJson) : {}

  /** A path inside the source, or an error: no absolute paths, no `..` out, no symlink out. */
  const inside = async (p) => {
    if (typeof p !== 'string' || isAbsolute(p)) throw new Error(`path must be relative to the source folder: ${p}`)
    const full = resolve(root, p)
    if (full !== root && !full.startsWith(root + sep)) throw new Error(`path leaves the source folder: ${p}`)
    try { const real = await realpath(full); if (real !== root && !real.startsWith(root + sep)) throw new Error(`path leaves the source folder (link): ${p}`) } catch (e) { if (e.code !== 'ENOENT') throw e }
    return full
  }
  const rel = (full) => relative(root, full).split(sep).join('/')

  const ctx = {
    roundName: basename(root),
    target: TARGET,
    options,
    exists: async (p) => { try { await stat(await inside(p)); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } },
    stat: async (p) => { try { const s = await stat(await inside(p)); return { bytes: s.size, isDir: s.isDirectory() } } catch (e) { if (e.code === 'ENOENT') return null; throw e } },
    list: async (dir = '.', opts = {}) => {
      const out = []
      const walk = async (d) => {
        let entries
        try { entries = await readdir(d, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT') return; throw e }
        for (const e of entries) {
          const full = join(d, e.name)
          if (e.isDirectory()) { if (opts.recursive) await walk(full); else out.push({ path: rel(full), name: e.name, bytes: 0, isDir: true }) }
          else if (e.isFile()) out.push({ path: rel(full), name: e.name, bytes: (await stat(full)).size, isDir: false })
        }
      }
      await walk(await inside(dir))
      return out.sort((a, b) => (a.path < b.path ? -1 : 1))
    },
    text: async (p) => readFile(await inside(p), 'utf8'),
    json: async (p) => JSON.parse(await readFile(await inside(p), 'utf8')),
    sha256: async (p) => new Promise(async (ok, no) => {
      const h = createHash('sha256'); const s = createReadStream(await inside(p))
      s.on('data', (c) => h.update(c)); s.on('end', () => ok(h.digest('hex'))); s.on('error', no)
    }),
  }

  const adapter = (await import(pathToFileURL(resolve(adapterFile)).href)).default
  if (!adapter || typeof adapter !== 'object') throw new Error('the adapter module has no default export object')
  for (const k of ['id', 'name']) if (typeof adapter[k] !== 'string' || !adapter[k]) throw new Error(`the adapter needs a string ${k}`)
  for (const k of ['detect', 'plan']) if (typeof adapter[k] !== 'function') throw new Error(`the adapter needs a ${k}(root, ctx) function`)
  if (action === 'info') return { id: adapter.id, name: adapter.name, version: adapter.version ?? 1, result: null }
  const result = action === 'detect' ? await adapter.detect(root, ctx) : await adapter.plan(root, ctx)
  return { id: adapter.id, name: adapter.name, version: adapter.version ?? 1, result }
}

main().then(
  (r) => { process.stdout.write(JSON.stringify({ ok: true, ...r }) + '\n') },
  (e) => { process.stdout.write(JSON.stringify({ ok: false, error: String(e?.message || e) }) + '\n'); process.exitCode = 1 },
)
