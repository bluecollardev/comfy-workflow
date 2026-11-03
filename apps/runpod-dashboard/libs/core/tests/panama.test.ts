import { describe, expect, it } from 'vitest'
import * as panama from '../src/panama.js'

describe('panama (the exchange bucket as an import source)', () => {
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
    expect(pull.slice(0, 4)).toEqual(['aws', 's3', 'cp', '--recursive'])
    expect(pull).toContain('s3://bh-panama-exchange-610140802195/rounds/brynley-comfy-2026-10-23/')
    expect(pull.some((a) => ['rm', 'sync', 'mv'].includes(a))).toBe(false)
  })
  it('refuses a round name that is a path, so a pull cannot leave the staging folder', () => {
    expect(() => panama.pull('../etc')).toThrow(/Not a round name/)
    expect(() => panama.pull('a/b')).toThrow(/Not a round name/)
    expect(() => panama.size('..')).toThrow(/Not a round name/)
  })
  it('stages under ~/panama-rounds unless told otherwise', () => {
    delete process.env.PANAMA_ROUNDS_DIR
    expect(panama.stagingDir()).toMatch(/panama-rounds$/)
  })
})

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
