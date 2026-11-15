import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as agentguard from '../src/agentguard.js'
import * as settings from '../src/settings.js'
import { REPO_ROOT } from '../src/paths.js'
import { scratch } from './helpers.js'

// The agent shell guard (ADR-042 section 10): the hook script, its install into the user's Claude Code settings, and the setting that does it.
let dir = '', claude = ''
beforeEach(() => {
  dir = scratch(); process.env.SETTINGS_ENV_FILE = join(dir, '.env')
  const home = mkdtempSync(join(tmpdir(), 'claude-home-')); claude = join(home, 'settings.json')
  process.env.CLAUDE_USER_SETTINGS = claude; process.env.AGENT_GUARD_SCRIPT = join(dir, 'hooks', 'guard-bash.sh'); process.env.POD_MANAGER_BACKUPS_DIR = join(dir, 'backups')
  delete process.env.AGENT_SHELL_GUARD
})
const read = () => JSON.parse(readFileSync(claude, 'utf8'))
const entries = () => (read().hooks?.PreToolUse ?? []) as { matcher: string; hooks: { command: string }[] }[]

describe('the guard script', () => {
  it('is byte-identical to the repo hook (node scripts/gen-agentguard.mjs regenerates the constant)', () => {
    expect(agentguard.SCRIPT).toBe(readFileSync(join(REPO_ROOT, '.claude', 'hooks', 'guard-bash.sh'), 'utf8'))
  })
  const run = (command: string) => spawnSync('bash', [join(REPO_ROOT, '.claude', 'hooks', 'guard-bash.sh')], { input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' })
  it('blocks the shell routes around the pod manager, with the way back', () => {
    for (const c of ['runpodctl create pod', 'curl https://rest.runpod.io/v1/pods', 'curl https://api.runpod.io/graphql', './start.sh pod create --gpu auto', 'aws s3 rm s3://bh-panama-exchange-610140802195/x', 'rm -rf projects/desktop/CANALV2/x', 'echo hi > projects/desktop/x', 'cp /tmp/a projects/desktop/CANALV2/']) {
      const r = run(c); expect(r.status, c).toBe(2); expect(r.stderr, c).toMatch(/^blocked: /)
    }
    expect(run('runpodctl x').stderr).toMatch(/pod-manager MCP/)
  })
  it('lets reads and ordinary commands through', () => {
    for (const c of ['./start.sh pod list', 'aws s3 ls s3://bh-panama-exchange-610140802195/', 'cp projects/desktop/CANALV2/a.md /tmp/', 'ls projects/desktop', 'git status', 'npm run core:test']) expect(run(c).status, c).toBe(0)
  })
})

describe('install and uninstall in the user\'s Claude Code settings', () => {
  it('creates the file, installs an executable script, adds one Bash entry, and is idempotent', () => {
    expect(agentguard.status()).toMatchObject({ enabled: false, installed: false, settings_file: claude, script_file: agentguard.scriptFile() })
    const s = agentguard.install()
    expect(s.installed).toBe(true)
    expect(entries()).toEqual([{ matcher: 'Bash', hooks: [{ type: 'command', command: agentguard.scriptFile() }] }])
    expect(readFileSync(agentguard.scriptFile(), 'utf8')).toBe(agentguard.SCRIPT); expect(statSync(agentguard.scriptFile()).mode & 0o111).not.toBe(0)
    agentguard.install(); expect(entries()).toHaveLength(1)   // twice: still one entry
  })
  it('keeps unknown keys and other hooks, backs the file up first, and uninstall removes only ours', () => {
    const other = { matcher: 'Edit|Write', hooks: [{ type: 'command', command: '/x/other.sh' }] }, bashOther = { matcher: 'Bash', hooks: [{ type: 'command', command: '/x/mine.sh' }] }
    writeFileSync(claude, JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls)'] }, hooks: { PreToolUse: [other, bashOther], PostToolUse: [{ matcher: 'x', hooks: [] }] } }))
    agentguard.install()
    const d = read()
    expect(d.model).toBe('opus'); expect(d.permissions).toEqual({ allow: ['Bash(ls)'] }); expect(d.hooks.PostToolUse).toHaveLength(1)
    expect(d.hooks.PreToolUse).toHaveLength(3); expect(d.hooks.PreToolUse[0]).toEqual(other); expect(d.hooks.PreToolUse[1]).toEqual(bashOther)
    const backups = readdirSync(join(dir, 'backups')).filter((f) => f.startsWith('claude-settings-')); expect(backups).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(dir, 'backups', backups[0]), 'utf8')).hooks.PreToolUse).toHaveLength(2)   // the file as it was
    agentguard.uninstall()
    expect(read().hooks.PreToolUse).toEqual([other, bashOther]); expect(agentguard.status().installed).toBe(false)
  })
  it('uninstall on a file with only our entry leaves no empty hooks block; with nothing installed it changes nothing', () => {
    agentguard.install(); agentguard.uninstall()
    expect(read()).toEqual({})
    const before = readFileSync(claude, 'utf8'); agentguard.uninstall(); expect(readFileSync(claude, 'utf8')).toBe(before)
  })
  it('refuses a file that is not valid JSON and changes nothing', () => {
    writeFileSync(claude, '{ "hooks": ')
    expect(() => agentguard.install()).toThrow(/not valid JSON/)
    expect(readFileSync(claude, 'utf8')).toBe('{ "hooks": '); expect(existsSync(agentguard.scriptFile())).toBe(false)
    expect(agentguard.status().error).toMatch(/not valid JSON/)
  })
  it('is not installed when the script is missing or not executable, even with the entry present', () => {
    agentguard.install(); chmodSync(agentguard.scriptFile(), 0o644); expect(agentguard.status().installed).toBe(false)
  })
})

describe('the setting', () => {
  it('on installs the hook and is remembered; off removes it; a failure leaves it off', () => {
    expect(settings.agentRules().shell_guard).toBe(false)
    settings.set({ agent_shell_guard: true })
    expect(settings.get()).toMatchObject({ agent_shell_guard: true }); expect(agentguard.status()).toMatchObject({ enabled: true, installed: true })
    settings.set({ agent_shell_guard: false })
    expect(agentguard.status()).toMatchObject({ enabled: false, installed: false })
    writeFileSync(claude, 'not json')
    expect(() => settings.set({ agent_shell_guard: true })).toThrow(/not valid JSON/)
    expect(settings.agentRules().shell_guard).toBe(false)
  })
})
