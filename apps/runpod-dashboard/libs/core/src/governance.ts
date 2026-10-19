/**
 * Governance for connecting agents: shared/governance, applied on every launch.
 *
 * The MCP server hands this to every client at initialize (the server's instructions), serves each
 * page as a resource (governance://...) and through the `governance` tool, and refuses the tools that
 * spend without the named yes Binc's agent-permissions page requires. Read from the folder at start,
 * so a re-sync of Binc's policies is applied on the next launch.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { governanceDir } from './paths.js'

export const SCHEME = 'governance://'
export const LEAD_PAGES = ['policy/agent-permissions.md', 'operator-brief.md']
export const SPEND_CAP_USD = 100   // policy/agent-permissions.md, 2026-10-09, until Brynley sets another figure

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out); else out.push(p)
  }
  return out
}

export const folder = (): string | null => governanceDir()

/** Relative page name -> file, for every markdown page in the governance folder. */
export function pages(): Record<string, string> {
  const root = folder()
  if (!root) return {}
  const out: Record<string, string> = {}
  for (const f of walk(root).filter((p) => p.endsWith('.md')).sort()) {
    const rel = relative(root, f).split('\\').join('/')
    if (rel !== 'MANIFEST.md') out[rel] = f
  }
  return out
}

export function read(name: string): string | null {
  const f = pages()[name]
  return f ? readFileSync(f, 'utf8') : null
}

/** When the copies were last synced from Binc's tree, from the manifest. */
export function syncedOn(): string {
  const root = folder()
  if (!root || !existsSync(join(root, 'MANIFEST.md'))) return 'unknown'
  const m = /on (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)/.exec(readFileSync(join(root, 'MANIFEST.md'), 'utf8'))
  return m ? m[1] : 'unknown'
}

/** What every MCP client is told at initialize: precedence, the agent permissions, the operator brief. */
export function instructions(): string {
  if (!folder()) {
    return 'No governance folder was found (GOVERNANCE_DIR, shared/governance). Treat the CANALV2 job as read-only: no spend, no install, no push, no client contact, and stop and report on ambiguity.'
  }
  const parts = [
    '# Governance (applied to this session)',
    `These rules are Binc's, copied from the CANALV2 tree on ${syncedOn()}, and govern anything that touches that job: its tree, shots, plates and client. This repo's own rules govern its code. Where they meet, Binc's win for their material. Every page is a resource under governance:// and readable with the \`governance\` tool; \`README.md\` is the precedence page.`,
    '',
    `Enforced by this server: tools that spend need \`approved_by\`, the name behind the yes, and the spend cap is USD ${SPEND_CAP_USD} total for agents and cloud GPU. Everything else below is a rule you follow.`,
  ]
  for (const name of LEAD_PAGES) {
    const text = read(name)
    if (text) parts.push('', `---\n## ${name}`, '', text.trim())
  }
  return parts.join('\n')
}

export const listing = () => Object.entries(pages()).map(([n, p]) => ({ uri: SCHEME + n, name: n, size: statSync(p).size }))
export const uriToName = (uri: string) => (uri.startsWith(SCHEME) ? uri.slice(SCHEME.length) : uri)

export const summary = () => ({ folder: folder(), synced_on: syncedOn(), spend_cap_usd: SPEND_CAP_USD, lead_pages: LEAD_PAGES, pages: listing(), instructions: instructions() })

/** The refusal for a spending tool called without the named yes; null when it may proceed. */
export function namedYes(args: Record<string, unknown>, what: string): string | null {
  const who = String(args.approved_by ?? '').trim()
  if (!who) {
    return `Refused: ${what} spends money, and policy/agent-permissions.md needs a named yes for any spend (cap USD ${SPEND_CAP_USD}). Call again with approved_by=<the person who said yes> once you have it. Do not guess a name.`
  }
  return null
}
