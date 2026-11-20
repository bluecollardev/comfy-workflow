import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import * as applogs from '../src/applogs.js'
import { scratch } from './helpers.js'

describe('applogs: listed and read, deleted only on a yes', () => {
  let dir = ''
  beforeEach(() => { dir = scratch('applogs'); process.env.APP_LOGS_DIR = dir; mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '2026-11-20.log'), ['2026-11-20T10:00:00.000Z INFO started', '2026-11-20T10:00:01.000Z WARN slow', '2026-11-20T10:00:02.000Z ERROR boom', '  at stack line', '2026-11-20T10:00:03.000Z INFO done'].join('\n') + '\n')
    writeFileSync(join(dir, '2026-11-19.log'), '2026-11-19T10:00:00.000Z INFO old\n'); writeFileSync(join(dir, 'notes.txt'), 'not a log') })
  afterEach(() => { delete process.env.APP_LOGS_DIR })
  it('list gives the days newest first and ignores other files', async () => { const l = await applogs.list(); expect(l.logs.map((x) => x.name)).toEqual(['2026-11-20.log', '2026-11-19.log']) })
  it('read gives the lines, narrowed by level and text, the last N; a bad name is refused', async () => {
    expect((await applogs.read('2026-11-20.log')).lines).toHaveLength(5)
    expect((await applogs.read('2026-11-20.log', { level: 'error' })).lines.join('|')).toMatch(/ERROR boom\|  at stack line/)
    expect((await applogs.read('2026-11-20.log', { level: 'warn' })).lines.filter((l) => /^\d/.test(l))).toHaveLength(2)
    expect((await applogs.read('2026-11-20.log', { match: 'done' })).lines).toEqual(['2026-11-20T10:00:03.000Z INFO done']); expect((await applogs.read('2026-11-20.log', { tail: 2 })).lines).toHaveLength(2)
    await expect(applogs.read('../x.log')).rejects.toMatchObject({ status: 400 }); await expect(applogs.read('2026-01-01.log')).rejects.toMatchObject({ status: 404 }); await expect(applogs.read('2026-11-20.log', { level: 'x' })).rejects.toMatchObject({ status: 400 })
  })
  it('purge needs a yes: one day or all; other files stay', async () => {
    await expect(applogs.purge({})).rejects.toMatchObject({ status: 400 }); expect(existsSync(join(dir, '2026-11-20.log'))).toBe(true)
    expect(await applogs.purge({ name: '2026-11-19.log', confirmed: true })).toMatchObject({ deleted: 1 }); expect((await applogs.list()).logs).toHaveLength(1)
    expect(await applogs.purge({ confirmed: true })).toMatchObject({ deleted: 1 }); expect(existsSync(join(dir, 'notes.txt'))).toBe(true)
  })
})
