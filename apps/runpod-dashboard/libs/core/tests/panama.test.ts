import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as panama from '../src/panama.js'

describe('panama (the exchange bucket as an import source)', () => {
  // the developer's own settings file (stored Panama keys) must not change which command is built
  beforeEach(() => { process.env.SETTINGS_ENV_FILE = join(tmpdir(), `no-settings-${process.pid}.env`); for (const k of ['PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY']) delete process.env[k] })
  afterEach(() => { delete process.env.SETTINGS_ENV_FILE })
  it('uses the keys the app holds, in the environment and not on the command line; the profile is only the fallback', () => {
    process.env.PANAMA_AWS_ACCESS_KEY_ID = 'AKIATEST'; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = 'secretvalue'
    const cmd = panama.listCmd()
    expect(cmd).not.toContain('--profile'); expect(cmd.join(' ')).not.toMatch(/AKIATEST|secretvalue/)
    expect(panama.awsEnv()).toMatchObject({ AWS_ACCESS_KEY_ID: 'AKIATEST', AWS_SECRET_ACCESS_KEY: 'secretvalue', AWS_REGION: 'us-west-2' })
    expect(panama.status()).toMatchObject({ configured: true, via: 'app keys' })
    delete process.env.PANAMA_AWS_ACCESS_KEY_ID; delete process.env.PANAMA_AWS_SECRET_ACCESS_KEY
  })
  it('lists, sizes and pulls with the named profile and region, read-only', () => {
    process.env.PANAMA_S3_PROFILE = 'panama'
    expect(panama.listCmd()).toEqual(['aws', 's3', 'ls', 's3://bh-panama-exchange-610140802195/rounds/', '--profile', 'panama', '--region', 'us-west-2'])
    const pull = panama.pullCmd('brynley-comfy-2026-10-23', '/tmp/x')
    expect(pull.slice(0, 3)).toEqual(['aws', 's3', 'sync'])
    expect(pull).toContain('s3://bh-panama-exchange-610140802195/rounds/brynley-comfy-2026-10-23/')
    expect(pull.some((a) => ['rm', 'mv', '--delete'].includes(a))).toBe(false)
  })
  it('refuses a round name that is a path, so a pull cannot leave the staging folder', () => {
    expect(() => panama.pull('../etc')).toThrow(/Not a round name/)
    expect(() => panama.pull('a/b')).toThrow(/Not a round name/)
    expect(() => panama.size('..')).toThrow(/Not a round name/)
  })
  it('with the app\'s keys the env has them and NO profile variable, not an empty one', () => {
    process.env.PANAMA_AWS_ACCESS_KEY_ID = 'AKIATEST'; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = 'secret'
    process.env.AWS_PROFILE = 'something'; process.env.AWS_DEFAULT_PROFILE = 'else'
    const env = panama.awsEnv()
    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIATEST')
    expect('AWS_PROFILE' in env).toBe(false)
    expect('AWS_DEFAULT_PROFILE' in env).toBe(false)
    expect(panama.listCmd()).not.toContain('--profile')
    delete process.env.AWS_PROFILE; delete process.env.AWS_DEFAULT_PROFILE
  })
  it('cancel stops nothing that is not running and refuses an unknown download', () => {
    expect(() => panama.cancel('nope')).toThrow(/No download/)
  })
  it('stages in temp/rounds inside the mapped ComfyUI-Shared, unless told otherwise', () => {
    delete process.env.PANAMA_ROUNDS_DIR
    const dir = mkdtempSync(join(tmpdir(), 'mounts-')); const f = join(dir, 'mounts.json')
    writeFileSync(f, JSON.stringify({ folders: { 'comfy-shared': '/x/ComfyUI-Shared' } })); process.env.MOUNTS_FILE = f
    expect(panama.stagingDir()).toBe('/x/ComfyUI-Shared/temp/rounds')
    process.env.PANAMA_ROUNDS_DIR = '/elsewhere'; expect(panama.stagingDir()).toBe('/elsewhere'); delete process.env.PANAMA_ROUNDS_DIR
    delete process.env.MOUNTS_FILE
  })
})


describe('panama.verify (verify_round.py: the manifest is the truth)', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex')
  const round = (files: Record<string, string>, tamper?: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'round-'))
    for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c) }
    writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify({ schema: 'bh-round-1', kind: 'delivery', files: Object.entries(files).map(([path, c]) => ({ path, bytes: c.length, sha256: sha(c) })) }))
    tamper?.(dir)
    return dir
  }
  it('passes a round that matches its manifest and counts files it does not list', async () => {
    const dir = round({ 'a.txt': 'hello', 'shot/b.txt': 'world' }, (d) => writeFileSync(join(d, 'extra.txt'), 'x'))
    expect(await panama.verify(dir)).toMatchObject({ ok: true, listed: 2, extra: 1, kind: 'delivery', bad: [] })
  })
  it('fails on a changed file, a short file and a missing one', async () => {
    const dir = round({ 'a.txt': 'hello', 'b.txt': 'world', 'c.txt': 'abc' }, (d) => { writeFileSync(join(d, 'a.txt'), 'HELLO'); writeFileSync(join(d, 'b.txt'), 'wor'); require('node:fs').unlinkSync(join(d, 'c.txt')) })
    const v = await panama.verify(dir)
    expect(v.ok).toBe(false)
    expect(v.bad.sort()).toEqual(['MISSING c.txt', 'SHA256 a.txt', 'SIZE b.txt'])
  })
  it('does not call a round without a manifest verified', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'round-')); writeFileSync(join(dir, 'a.txt'), 'x')
    expect(await panama.verify(dir)).toMatchObject({ ok: false, listed: 0 })
  })
})

import * as mounts from '../src/mounts.js'
describe('pod environment (S3_PULL gets the keys the app holds)', () => {
  it('adds the keys only when a pull is set and the app has keys', () => {
    process.env.PANAMA_AWS_ACCESS_KEY_ID = 'AKIATEST'; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = 'secretvalue'
    const base = mounts.load()
    const none = mounts.podOverrides({ ...base, env: {} })
    expect(none.env.AWS_ACCESS_KEY_ID).toBeUndefined()
    const pull = mounts.podOverrides({ ...base, env: { S3_PULL: 'b/p=/workspace/x' } })
    expect(pull.env).toMatchObject({ S3_PULL: 'b/p=/workspace/x', AWS_ACCESS_KEY_ID: 'AKIATEST', AWS_SECRET_ACCESS_KEY: 'secretvalue', AWS_REGION: 'us-west-2' })
    delete process.env.PANAMA_AWS_ACCESS_KEY_ID; delete process.env.PANAMA_AWS_SECRET_ACCESS_KEY
  })
})

describe('panama.stagedState (what is on this PC for a round)', () => {
  it('none, partial with counts, unverified, complete', () => {
    const base = mkdtempSync(join(tmpdir(), 'stage-')); process.env.PANAMA_ROUNDS_DIR = base
    const sha = (s: string) => createHash('sha256').update(s).digest('hex')
    expect(panama.stagedState('r').state).toBe('none')
    const dir = join(base, 'r'); mkdirSync(join(dir, 'shot'), { recursive: true })
    writeFileSync(join(dir, 'shot', 'a.txt'), 'hello')   // files on disk, no manifest yet
    expect(panama.stagedState('r')).toMatchObject({ state: 'partial', present: 1, expected: null })
    const files = [{ path: 'shot/a.txt', bytes: 5, sha256: sha('hello') }, { path: 'shot/b.txt', bytes: 5, sha256: sha('world') }]
    writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify({ files }))
    expect(panama.stagedState('r')).toMatchObject({ state: 'partial', present: 1, expected: 2, missing: 1 })
    writeFileSync(join(dir, 'shot', 'b.txt'), 'wor')   // short file: not present
    expect(panama.stagedState('r')).toMatchObject({ state: 'partial', present: 1, missing: 1 })
    writeFileSync(join(dir, 'shot', 'b.txt'), 'world')
    expect(panama.stagedState('r')).toMatchObject({ state: 'unverified', present: 2, missing: 0 })
    writeFileSync(join(dir, '.panama-pull.done'), 'x')
    expect(panama.stagedState('r')).toMatchObject({ state: 'complete', missing: 0 })
    writeFileSync(join(dir, 'MANIFEST.json'), '{"files": [')   // a manifest cut short
    expect(() => panama.stagedState('r')).not.toThrow()
    delete process.env.PANAMA_ROUNDS_DIR
  })
})

describe('panama.remove (Delete from this computer)', () => {
  it('deletes one staged round, reports what it freed, and touches nothing else', () => {
    const base = mkdtempSync(join(tmpdir(), 'rm-')); process.env.PANAMA_ROUNDS_DIR = base
    for (const r of ['keep-me', 'drop-me']) { mkdirSync(join(base, r, 'shot'), { recursive: true }); writeFileSync(join(base, r, 'shot', 'a.bin'), 'x'.repeat(1000)) }
    writeFileSync(join(base, 'loose.txt'), 'not a round')
    expect(panama.remove('drop-me')).toEqual({ round: 'drop-me', freed: 1000 })
    expect(existsSync(join(base, 'drop-me'))).toBe(false)
    expect(existsSync(join(base, 'keep-me', 'shot', 'a.bin'))).toBe(true)
    expect(existsSync(join(base, 'loose.txt'))).toBe(true)
    expect(panama.remove('drop-me')).toEqual({ round: 'drop-me', freed: 0 })   // already gone: nothing to do, not an error
    delete process.env.PANAMA_ROUNDS_DIR
  })
  it('refuses a path, and a folder that is a link pointing outside the staging folder', () => {
    const base = mkdtempSync(join(tmpdir(), 'rm-')); const outside = mkdtempSync(join(tmpdir(), 'outside-')); process.env.PANAMA_ROUNDS_DIR = base
    writeFileSync(join(outside, 'precious.txt'), 'keep')
    symlinkSync(outside, join(base, 'sneaky'))
    expect(() => panama.remove('../x')).toThrow(/Not a round name/)
    expect(() => panama.remove('a/b')).toThrow(/Not a round name/)
    expect(() => panama.remove('sneaky')).toThrow(/Refusing/)
    expect(existsSync(join(outside, 'precious.txt'))).toBe(true)
    delete process.env.PANAMA_ROUNDS_DIR
  })
})

describe('progress read from the tools\' own output', () => {
  it('reads aws s3\'s progress line, with and without the listing still running', () => {
    expect(panama.parseAwsProgress('Completed 1.2 GiB/9.5 GiB (45.2 MiB/s) with 12 file(s) remaining')).toEqual({ bytes_done: Math.round(1.2 * 1024 ** 3), bytes_total: Math.round(9.5 * 1024 ** 3), rate: Math.round(45.2 * 1024 ** 2), remaining: 12 })
    expect(panama.parseAwsProgress('Completed 256.0 KiB/~2.0 MiB (1.2 MiB/s) with ~3 file(s) remaining (calculating...)')).toMatchObject({ bytes_done: 262144, bytes_total: 2 * 1024 ** 2, remaining: 3 })
    expect(panama.parseAwsProgress('download: s3://b/rounds/r/a.txt to x/a.txt')).toBeNull()
  })
  it('reads rclone\'s one-line stats and the files it copied, and aws\'s downloaded files, as paths inside the round', () => {
    expect(panama.parseRcloneStats('2026/11/03 05:54:10 INFO  :   609.227 KiB / 609.227 KiB, 100%, 53.696 KiB/s, ETA 0s')).toMatchObject({ bytes_done: Math.round(609.227 * 1024), bytes_total: Math.round(609.227 * 1024), rate: Math.round(53.696 * 1024) })
    expect(panama.rcloneCopiedPath('2026/11/03 05:54:07 INFO  : 03_INBOX/nf-51/ASSETS.csv: Copied (new)')).toBe('03_INBOX/nf-51/ASSETS.csv')
    expect(panama.rcloneCopiedPath('INFO  : a b/c.txt: Copied (replaced)')).toBe('a b/c.txt')
    expect(panama.rcloneCopiedPath('s3 pull done (manifest verified): /workspace/x')).toBeNull()
    expect(panama.awsDownloadedPath('download: s3://bh-panama-exchange-610140802195/rounds/brynley-comfy-2026-10-20/cgi-042/final/x.mp4 to ../r/cgi-042/final/x.mp4')).toBe('cgi-042/final/x.mp4')
    expect(panama.awsDownloadedPath('Completed 1.0 MiB/2.0 MiB (1.0 MiB/s)')).toBeNull()
  })
})

