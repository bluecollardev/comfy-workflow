#!/usr/bin/env node
// Build the public documentation site from the README's "## Documentation" section (ADR-014):
//   node scripts/docs-site.mjs <outDir>      writes <outDir>/index.html, docs.json and files/<doc paths>
// The nav is the README's own sections and tables; a doc is published unless it matches EXCLUDE.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] || join(ROOT, 'downloads/docs-site'))

// Not published: the client's job (CANALV2, Binc's ShotPipe and governance), planning, and agent-only notes.
// The downloads repo is public; these name a client project or are internal working notes.
const EXCLUDE = [
  /^CLAUDE\.md$/, /^NEXT-STEPS\.md$/, /^projects\//, /^queue\//, /^shared\//,
  /CANALV2/i, /DELIVERY-PACKAGES/, /MOUNT-POINTS/, /PROMPTS/, /TEST-RESULTS/, /IMPORT-SHOT-PACKS/,
  /ADR-004/, /ADR-008/, /NODE-PACKS/,
  /ADR-01[5-79]/, /ADR-02[12345]/, /POD-PULLS-FROM-S3/, /SCRIPTS/,   // the BH bucket, its keys and the Panama export (names a client project)
]

const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const part = readme.slice(readme.indexOf('\n## Documentation'))
const end = part.indexOf('\n## ', 5); const body = end > 0 ? part.slice(0, end) : part
const sections = []
let cur = null
for (const line of body.split('\n')) {
  const h = line.match(/^### (.+)/)
  if (h) { cur = { title: h[1].trim(), docs: [] }; sections.push(cur); continue }
  const m = line.match(/^\| \[`?([^\]`]+?)`?\]\(([^)]+)\) \|\s*(.*?)\s*\|?$/)
  if (!m || !cur) continue
  const path = m[2].split('#')[0]
  if (!path.endsWith('.md') || EXCLUDE.some(re => re.test(path)) || !existsSync(join(ROOT, path))) continue
  const text = readFileSync(join(ROOT, path), 'utf8')
  const title = (text.match(/^# (.+)/m) || [])[1] || path.replace(/^.*\//, '').replace(/\.md$/, '')
  cur.docs.push({ path, title: title.replace(/^ADR-(\d+):?\s*/, 'ADR-$1 · '), desc: m[3].replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`/g, '') })
}
const kept = sections.filter(s => s.docs.length)
const secretLike = /(rpa_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/
mkdirSync(join(out, 'files'), { recursive: true })
let n = 0
for (const s of kept) for (const d of s.docs) {
  const src = join(ROOT, d.path), text = readFileSync(src, 'utf8')
  if (secretLike.test(text)) { console.error(`refused: ${d.path} looks like it holds a secret`); process.exit(1) }
  mkdirSync(dirname(join(out, 'files', d.path)), { recursive: true }); copyFileSync(src, join(out, 'files', d.path)); n++
  for (const im of text.matchAll(/!\[[^\]]*\]\(([^)#\s]+)\)/g)) {   // screenshots: copied beside the doc that shows them
    if (/^https?:/.test(im[1])) continue
    const rel = join(dirname(d.path), im[1]), from = join(ROOT, rel)
    if (!existsSync(from)) { console.error(`missing image ${rel} in ${d.path}`); process.exit(1) }
    mkdirSync(dirname(join(out, 'files', rel)), { recursive: true }); copyFileSync(from, join(out, 'files', rel))
  }
}
const first = kept[0]?.docs[0]?.path || ''
writeFileSync(join(out, 'docs.json'), JSON.stringify({ start: first, sections: kept }, null, 1))
copyFileSync(join(ROOT, 'downloads/docs-viewer/index.html'), join(out, 'index.html'))
console.log(`docs site: ${n} documents in ${kept.length} sections -> ${out}`)
console.log(`left out: the client job, planning and agent notes (${EXCLUDE.length} rules)`)
