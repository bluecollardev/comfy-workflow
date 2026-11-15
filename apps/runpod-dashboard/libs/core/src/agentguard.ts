/**
 * The agent shell guard (ADR-042 section 10): a Claude Code PreToolUse hook for Bash that refuses the shell routes that go around the pod manager
 * (runpodctl, RunPod's REST/GraphQL/S3 endpoints, the pod CLI's create/resume/recreate/delete, writes to BH's bucket, writes into projects/desktop).
 * A heuristic on purpose, not a sandbox: it catches the common bypasses, not every one. It is a setting (AGENT_SHELL_GUARD, system-wide):
 * switching it on writes the script under the config folder and adds ONE PreToolUse entry to the current OS user's ~/.claude/settings.json
 * (every project of that user, in that user's sessions); switching it off removes only that entry.
 *
 * SCRIPT is byte-identical to .claude/hooks/guard-bash.sh in the repo (a test asserts it). To change the script, edit the repo file and run
 * node scripts/gen-agentguard.mjs.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { bad } from './errors.js'
import { backupsDir, configDir } from './paths.js'
import { SCRIPT } from './agentguard.script.js'
import * as settings from './settings.js'

export { SCRIPT }
/** The current OS user's Claude Code settings (env CLAUDE_USER_SETTINGS overrides, for tests). */
export const settingsFile = () => process.env.CLAUDE_USER_SETTINGS || join(homedir(), '.claude', 'settings.json')
/** Where the script is installed (env AGENT_GUARD_SCRIPT overrides). */
export const scriptFile = () => process.env.AGENT_GUARD_SCRIPT || join(configDir(), 'hooks', 'guard-bash.sh')

type Hook = { type?: string; command?: string; [k: string]: unknown }
type Group = { matcher?: string; hooks?: Hook[]; [k: string]: unknown }
type Doc = { hooks?: { PreToolUse?: Group[]; [k: string]: unknown }; [k: string]: unknown }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The user's settings as JSON; {} if the file is absent; an error (and nothing changed) if it is not valid JSON. */
function readDoc(): Doc {
  const f = settingsFile()
  if (!existsSync(f)) return {}
  const raw = readFileSync(f, 'utf8')
  if (!raw.trim()) return {}
  let j: unknown
  try { j = JSON.parse(raw) } catch { throw bad(`${f} is not valid JSON: nothing was changed. Fix or move it, then switch the guard on again.`) }
  if (!isObj(j)) throw bad(`${f} is not a JSON object: nothing was changed.`)
  return j as Doc
}
const ours = (h: Hook) => h && h.type === 'command' && h.command === scriptFile()
const hasOurs = (d: Doc) => Array.isArray(d.hooks?.PreToolUse) && d.hooks!.PreToolUse!.some((g) => Array.isArray(g?.hooks) && g.hooks!.some(ours))

export interface GuardStatus { enabled: boolean; installed: boolean; settings_file: string; script_file: string; error?: string }
export function status(): GuardStatus {
  const s = settingsFile(), f = scriptFile()
  let entry = false, error: string | undefined
  try { entry = hasOurs(readDoc()) } catch (e) { error = (e as Error).message }
  let exec = false
  try { exec = existsSync(f) && (statSync(f).mode & 0o111) !== 0 } catch { /* absent */ }
  return { enabled: settings.agentRules().shell_guard, installed: entry && exec, settings_file: s, script_file: f, ...(error ? { error } : {}) }
}

function backup(): string | null {
  const f = settingsFile()
  if (!existsSync(f)) return null
  const dir = backupsDir(); mkdirSync(dir, { recursive: true })
  const to = join(dir, `claude-settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  copyFileSync(f, to); return to
}
function writeDoc(d: Doc) { const f = settingsFile(); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(d, null, 2) + '\n') }

/** Write the script and add our one PreToolUse entry. Idempotent; touches no other key and no other hook; the file is backed up first. */
export function install(): GuardStatus {
  const doc = readDoc()   // refuses an invalid file before anything is written
  const f = scriptFile()
  mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, SCRIPT); chmodSync(f, 0o755)
  if (!hasOurs(doc)) {
    backup()
    doc.hooks = isObj(doc.hooks) ? doc.hooks : {}
    const list = Array.isArray(doc.hooks.PreToolUse) ? doc.hooks.PreToolUse : (doc.hooks.PreToolUse = [])
    list.push({ matcher: 'Bash', hooks: [{ type: 'command', command: f }] })
    writeDoc(doc)
  }
  return status()
}

/** Remove only our entry (and its Bash group if ours was the only hook in it). The script file is left in the config folder. */
export function uninstall(): GuardStatus {
  const doc = readDoc()
  if (hasOurs(doc)) {
    backup()
    const list = doc.hooks!.PreToolUse!
    const next: Group[] = []
    for (const g of list) {
      if (!Array.isArray(g?.hooks)) { next.push(g); continue }
      const kept = g.hooks.filter((h) => !ours(h))
      if (kept.length === g.hooks.length) next.push(g)
      else if (kept.length) next.push({ ...g, hooks: kept })
    }
    if (next.length) doc.hooks!.PreToolUse = next; else delete doc.hooks!.PreToolUse
    if (isObj(doc.hooks) && !Object.keys(doc.hooks).length) delete doc.hooks
    writeDoc(doc)
  }
  return status()
}
