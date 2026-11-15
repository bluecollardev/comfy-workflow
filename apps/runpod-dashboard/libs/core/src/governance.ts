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
import * as settings from './settings.js'

export const SCHEME = 'governance://'
export const LEAD_PAGES = ['policy/agent-permissions.md', 'operator-brief.md']
/** System-wide agent rules (settings.ts, not a configuration: no pod has its own): is the named yes required, and the spend ceiling advertised to agents (0 = none). */
export const gateOn = (): boolean => settings.agentRules().require_named_yes
export const spendCap = (): number => settings.agentRules().spend_cap_usd

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
    gateOn()
      ? `Enforced by this server: tools that spend need \`approved_by\`, the name behind the yes${spendCap() ? `, and the spend ceiling is USD ${spendCap()} total for agents and cloud GPU` : ''}. Everything else below is a rule you follow.`
      : `This server does not ask for a named yes: RunPod Manager is Lucas's own tool, and the approval rule below is Binc's, for their CANALV2 job${spendCap() ? `; Lucas's spend ceiling for agents is USD ${spendCap()}` : ''}. Follow the rest for anything that touches Binc's tree, shots, plates or client.`,
  ]
  for (const name of LEAD_PAGES) {
    const text = read(name)
    if (text) parts.push('', `---\n## ${name}`, '', text.trim())
  }
  return parts.join('\n')
}

export const listing = () => Object.entries(pages()).map(([n, p]) => ({ uri: SCHEME + n, name: n, size: statSync(p).size }))
export const uriToName = (uri: string) => (uri.startsWith(SCHEME) ? uri.slice(SCHEME.length) : uri)

export const summary = () => ({ folder: folder(), synced_on: syncedOn(), spend_cap_usd: spendCap() || null, named_yes_required: gateOn(), lead_pages: LEAD_PAGES, pages: listing(), instructions: instructions() })

/** The refusal for a spending tool called without the named yes; null when it may proceed. */
export function namedYes(args: Record<string, unknown>, what: string): string | null {
  if (!gateOn()) return null   // Binc's rule, switched off in this tool's configuration (require_named_yes)
  const who = String(args.approved_by ?? '').trim()
  if (!who) {
    return `Refused: ${what} spends money, and policy/agent-permissions.md needs a named yes for any spend (approval is switched on in this tool's settings). Call again with approved_by=<the person who said yes> once you have it. Do not guess a name.`
  }
  return null
}
