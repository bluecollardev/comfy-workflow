import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as panama from '../src/panama.js'
import type { AwsRunner } from '../src/podpull.js'

// The BH bucket explorer's core call: one level, read-only, a fake AWS runner (no AWS is touched).
const ID = 'AKIATESTKEYID123456', SECRET = 'sekret-value-do-not-leak'
const LS = [
  '                           PRE shot-001/',
  '                           PRE shot-002/',
  '2026-11-18 10:30:00       2048 notes.txt',
  '2026-11-18 11:00:01 5368709120 take 1.mov',
  'junk line',
].join('\n')
const fake = (out: { code?: number; stdout?: string; stderr?: string }, seen: string[][] = []): AwsRunner => async (args) => { seen.push(args); return { code: out.code ?? 0, stdout: out.stdout ?? '', stderr: out.stderr ?? '' } }

describe('panama.browse (the exchange bucket, read-only)', () => {
  beforeEach(() => { process.env.SETTINGS_ENV_FILE = join(tmpdir(), `no-settings-${process.pid}.env`); process.env.PANAMA_AWS_ACCESS_KEY_ID = ID; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = SECRET })
  afterEach(() => { delete process.env.SETTINGS_ENV_FILE; delete process.env.PANAMA_AWS_ACCESS_KEY_ID; delete process.env.PANAMA_AWS_SECRET_ACCESS_KEY })

  it('parses folders and files of one level, with names, keys, bytes and modified', async () => {
    const seen: string[][] = []
    const r = await panama.browse('returns/BKK', { aws: fake({ stdout: LS }, seen) })
    expect(r).toMatchObject({ prefix: 'returns/BKK/', truncated: false })
    expect(r.folders).toEqual([{ name: 'shot-001', prefix: 'returns/BKK/shot-001/' }, { name: 'shot-002', prefix: 'returns/BKK/shot-002/' }])
    expect(r.files).toEqual([
      { name: 'notes.txt', key: 'returns/BKK/notes.txt', bytes: 2048, modified: '2026-11-18T10:30:00' },
      { name: 'take 1.mov', key: 'returns/BKK/take 1.mov', bytes: 5368709120, modified: '2026-11-18T11:00:01' },
    ])
    expect(seen[0].slice(0, 3)).toEqual(['s3', 'ls', `s3://${panama.bucket()}/returns/BKK/`])
    expect(seen[0]).not.toContain('--recursive'); expect(seen[0]).not.toContain('--profile')
  })
  it('lists the top of the bucket for an empty prefix', async () => {
    const seen: string[][] = []
    await panama.browse('', { aws: fake({ stdout: LS }, seen) })
    expect(seen[0][2]).toBe(`s3://${panama.bucket()}/`)
  })
  it('refuses a prefix that leaves the bucket or is not a folder name, before any call', async () => {
    const seen: string[][] = []
    for (const p of ['../x', 'a/../b', '/rounds', 'rounds//x', 'a;rm -rf', 'x\n y', '..']) await expect(panama.browse(p, { aws: fake({}, seen) })).rejects.toThrow(/Not a folder/)
    expect(seen).toEqual([])
  })
  it('cuts the list at the cap and says so', async () => {
    const many = Array.from({ length: 50 }, (_, i) => `2026-11-18 10:00:00 ${i} f${i}.txt`).join('\n')
    const r = await panama.browse('rounds/', { aws: fake({ stdout: many }), cap: 10 })
    expect(r.files).toHaveLength(10); expect(r.truncated).toBe(true)
  })
  it('an error carries one line and never the keys', async () => {
    const stderr = `An error occurred (InvalidAccessKeyId) with ${ID} and ${SECRET}\nsecond line ${SECRET}`
    const e = await panama.browse('rounds/', { aws: fake({ code: 1, stderr }) }).catch((x) => x as Error)
    expect(e.message).toMatch(/could not be read/)
    expect(e.message).not.toContain(ID); expect(e.message).not.toContain(SECRET); expect(e.message).not.toContain('second line')
    const t = await panama.browse('rounds/', { aws: async () => { throw new Error(`boom ${SECRET}`) } }).catch((x) => x as Error)
    expect(t.message).not.toContain(SECRET)
  })
  it('only ever issues `s3 ls`, with the keys in the environment and not on the command line', async () => {
    const calls: { args: string[]; env: Record<string, string> }[] = []
    const run: AwsRunner = async (args, env) => { calls.push({ args, env }); return { code: 0, stdout: LS, stderr: '' } }
    await panama.browse('rounds/', { aws: run }); await panama.browse('', { aws: run })
    for (const c of calls) {
      expect(c.args.slice(0, 2)).toEqual(['s3', 'ls'])
      expect(c.args.some((a) => ['cp', 'mv', 'rm', 'sync', 'rb', 'mb', 'put-object', '--delete'].includes(a))).toBe(false)
      expect(c.args.join(' ')).not.toMatch(new RegExp(`${ID}|${SECRET}`))
      expect(c.env).toMatchObject({ AWS_ACCESS_KEY_ID: ID, AWS_SECRET_ACCESS_KEY: SECRET })
    }
  })
})
