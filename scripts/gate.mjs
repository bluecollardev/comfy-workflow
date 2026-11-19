#!/usr/bin/env node
// The release gate (docs/ADR-005, amended 2026-11-19): `./start.sh test` writes a pass record when EVERY suite passes; `./start.sh release` refuses
// unless the record matches the code about to be released. A deliberate skip is allowed only with a reason, and is recorded.
//   node scripts/gate.mjs write [--suites "core,mcp,ipc,unit,browser,electron"]
//   node scripts/gate.mjs check [--max-age-hours 24]       exit 0 = a current pass exists, exit 1 = not
//   node scripts/gate.mjs skip --reason "Lucas: no tests for this patch"
// The fingerprint covers what the tests exercise (apps/runpod-dashboard, start.sh, scripts) and NOT what a release itself changes (package.json,
// package-lock.json, build/build-info.json), so a pass stays valid through the version bump and the build-info commit.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const GATE_PATHS = ['apps/runpod-dashboard', 'start.sh', 'scripts']
export const RELEASE_OWNED = new Set(['apps/runpod-dashboard/package.json', 'apps/runpod-dashboard/package-lock.json', 'apps/runpod-dashboard/build/build-info.json'])
const git = (root, args, input) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...(input !== undefined ? { input } : {}) })
const toplevel = (cwd = process.cwd()) => execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim()

/** A hash of the content of every tracked or new (not ignored) file the tests exercise, minus what a release changes. */
export function fingerprint(root) {
  const names = git(root, ['ls-files', '-co', '--exclude-standard', '-z', '--', ...GATE_PATHS]).split('\0').filter(Boolean)
    .filter((n) => !RELEASE_OWNED.has(n) && existsSync(join(root, n))).sort()
  const hashes = names.length ? git(root, ['hash-object', '--stdin-paths'], names.join('\n') + '\n').split('\n').filter(Boolean) : []
  const h = createHash('sha1')
  names.forEach((n, i) => h.update(`${n}\0${hashes[i]}\n`))
  return { sha: h.digest('hex'), files: names.length }
}
const gateDir = (root) => join(root, '.gate')
const passFile = (root) => join(gateDir(root), 'last-pass.json')

export function write(root, suites = []) {
  const fp = fingerprint(root)
  mkdirSync(gateDir(root), { recursive: true })
  const rec = { at: new Date().toISOString(), head: git(root, ['rev-parse', 'HEAD']).trim(), fingerprint: fp.sha, files: fp.files, suites }
  writeFileSync(passFile(root), JSON.stringify(rec, null, 2) + '\n')
  return rec
}
/** { ok, message } : ok only when a pass exists, is not older than maxAgeHours and was recorded for exactly this code. */
export function check(root, { maxAgeHours = 24, now = Date.now() } = {}) {
  if (!existsSync(passFile(root))) return { ok: false, message: 'No passing gate on record. Run ./start.sh test (core, MCP, IPC, unit, browser and the real app) first.' }
  let rec; try { rec = JSON.parse(readFileSync(passFile(root), 'utf8')) } catch { return { ok: false, message: 'The gate record is unreadable. Run ./start.sh test again.' } }
  const ageH = (now - new Date(rec.at).getTime()) / 3_600_000
  if (!(ageH >= 0) || ageH > maxAgeHours) return { ok: false, message: `The last passing gate is ${Number.isFinite(ageH) ? Math.round(ageH) + ' hours' : 'of unknown age'} old (limit ${maxAgeHours}). Run ./start.sh test again.` }
  const fp = fingerprint(root)
  if (fp.sha !== rec.fingerprint) return { ok: false, message: 'The code changed since the last passing gate (' + rec.at + '). Run ./start.sh test again on this code.' }
  return { ok: true, message: `Gate passed at ${rec.at} on this exact code (${(rec.suites || []).join(', ') || 'all suites'}).` }
}
export function skip(root, reason) {
  if (!String(reason || '').trim()) throw new Error('A skipped gate needs a reason in words.')
  mkdirSync(gateDir(root), { recursive: true })
  const rec = { at: new Date().toISOString(), head: git(root, ['rev-parse', 'HEAD']).trim(), user: process.env.USER || '', reason: String(reason).trim() }
  appendFileSync(join(gateDir(root), 'skips.log'), JSON.stringify(rec) + '\n')
  return rec
}

if (import.meta.url === `file://${resolve(process.argv[1] || '')}`) {
  const [cmd, ...rest] = process.argv.slice(2)
  const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }
  const root = toplevel()
  try {
    if (cmd === 'write') { const r = write(root, (opt('--suites') || 'core,mcp,ipc,unit,browser,electron').split(',')); console.log(`gate pass recorded (${r.files} files, ${r.suites.join(', ')})`) }
    else if (cmd === 'check') { const r = check(root, { maxAgeHours: Number(opt('--max-age-hours')) || 24 }); console.log(r.message); process.exit(r.ok ? 0 : 1) }
    else if (cmd === 'skip') { skip(root, opt('--reason')); console.log('gate skip recorded in .gate/skips.log') }
    else { console.error('usage: gate.mjs write | check | skip --reason "..."'); process.exit(2) }
  } catch (e) { console.error(e.message); process.exit(2) }
}
