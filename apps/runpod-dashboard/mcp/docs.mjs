// The README and our documentation, served to a connecting MCP client (docs/ADR-028): a `docs` tool (list, read, search) and `docs://` resources.
// Found from the checkout (or COMFY_REPO_ROOT). The packaged app has no checkout: then the tool says so. What the public documentation site leaves out
// (the client's job, Binc's material, planning notes: EXCLUDE in scripts/docs-site.mjs) is left out here too, because the MCP can be served remotely (ADR-019).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The repo root: COMFY_REPO_ROOT, else the nearest folder above this file with a README.md, a docs/ folder and start.sh. */
export function root() {
  const starts = [process.env.COMFY_REPO_ROOT, HERE].filter(Boolean)
  for (const s of starts) {
    let d = resolve(s)
    for (let i = 0; i < 7; i++, d = dirname(d)) if (existsSync(join(d, 'README.md')) && existsSync(join(d, 'docs')) && existsSync(join(d, 'start.sh'))) return d
  }
  return null
}

/** The exclusion rules of the public docs site, read from its own source so there is one list: the regex literals between `const EXCLUDE = [` and `]`. */
export function excludeRules(base = root()) {
  const file = base && join(base, 'scripts', 'docs-site.mjs')
  if (!file || !existsSync(file)) return [/^CLAUDE\.md$/, /^NEXT-STEPS\.md$/, /^projects\//, /^queue\//, /^shared\//, /CANALV2/i]   // the floor when the list cannot be read
  const text = readFileSync(file, 'utf8')
  const block = /const EXCLUDE = \[([\s\S]*?)\n\]/.exec(text)?.[1] || ''
  const rules = []
  for (const m of block.replace(/\/\/.*$/gm, '').matchAll(/\/((?:\\\/|[^/\n])+)\/([a-z]*)/g)) { try { rules.push(new RegExp(m[1], m[2])) } catch { /* a rule that is not a regex is skipped */ } }
  return rules.length ? rules : [/CANALV2/i]
}

const TOP = ['README.md', 'CHANGELOG.md', 'AGENTS.md']

/** Every page we serve: name (relative path), title and size. */
export function listing(base = root()) {
  if (!base) return []
  const rules = excludeRules(base)
  const names = [...TOP.filter((n) => existsSync(join(base, n))), ...readdirSync(join(base, 'docs')).filter((n) => n.endsWith('.md')).sort().map((n) => `docs/${n}`)]
  return names.filter((n) => !rules.some((re) => re.test(n))).map((name) => {
    const text = readFileSync(join(base, name), 'utf8')
    return { name, uri: `docs://${name}`, title: (/^# (.+)/m.exec(text) || [])[1] || name, bytes: statSync(join(base, name)).size }
  })
}

/** One page's text, or null when it is not served (missing, excluded, or outside the docs). */
export function read(name, base = root()) {
  if (!base) return null
  const clean = String(name || '').replace(/^docs:\/\//, '')
  if (!listing(base).some((p) => p.name === clean)) return null
  return readFileSync(join(base, clean), 'utf8')
}

/** Lines matching a query (case-insensitive) across the served pages: page, line number and the line, at most `limit`. */
export function search(q, limit = 40, base = root()) {
  const needle = String(q || '').trim().toLowerCase()
  if (!needle || !base) return []
  const out = []
  for (const p of listing(base)) {
    const lines = readFileSync(join(base, p.name), 'utf8').split('\n')
    for (let i = 0; i < lines.length && out.length < limit; i++) if (lines[i].toLowerCase().includes(needle)) out.push({ page: p.name, line: i + 1, text: lines[i].trim().slice(0, 240) })
    if (out.length >= limit) break
  }
  return out
}

export const uriToName = (uri) => String(uri).replace(/^docs:\/\//, '')
