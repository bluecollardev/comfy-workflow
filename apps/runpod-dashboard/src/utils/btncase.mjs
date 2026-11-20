// Button labels are Title Case (Lucas, 2026-11-20). Shared by the guard test and the one-off sweep: which locale keys label a button, and what they should read.
import { readFileSync, readdirSync } from 'node:fs'
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'from', 'into', 'vs'])
const NOT_LABEL = /(Title|Hint|Tip|Help|badge|Facts|runLine|volumeFree|problemsOf|cached|plan[A-Z]|opt[A-Z]|unassigned|StockImage|Free$|^dashboard\.keyRequiredOpen)/
export const titleCase = (v) => v.split(/(\s+)/).map((w, i, a) => {
  const m = /^([("+]*)([a-z][^\s]*)$/.exec(w); if (!m || /^[a-z]\{/.test(m[2]) || /^(zip|csv)\)?$/.test(m[2])) return w   // not a word, a version like v{v}, or a format named in brackets
  const first = a.slice(0, i).every((x) => /^\s*$/.test(x)); return !first && SMALL.has(m[2]) ? w : m[1] + m[2][0].toUpperCase() + m[2].slice(1)
}).join('')
export function buttonKeys(root = '.') {
  const loc = JSON.parse(readFileSync(`${root}/src/locales/en.json`, 'utf8')), get = (k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), loc), dir = `${root}/src/components/`, out = new Map()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.vue'))) {
    const src = readFileSync(dir + f, 'utf8'), tpl = src.slice(0, src.indexOf('<script'))
    for (const m of tpl.matchAll(/<(BButton|BDropdownItem|button)\b[^>]*>([\s\S]*?)<\/\1>/g)) for (const k of m[2].matchAll(/\$t\('([\w.]+)'/g)) {
      const v = get(k[1]); if (typeof v !== 'string' || NOT_LABEL.test(k[1]) || v.length > 40 || !/\s/.test(v) || /[.:]\s|\.$|\|/.test(v)) continue
      const want = titleCase(v); if (want !== v) out.set(k[1], [v, want, f])
    }
  }
  return out
}
