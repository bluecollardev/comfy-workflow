import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as failures from '../src/failures.js'
import * as history from '../src/history.js'
import { scratch } from './helpers.js'

// The Queue's Dismiss, Dismiss All, Show Dismissed and Restore (Lucas: "Failures (50) in queue have ability to dismiss"): by id, persisted next to the log, the log itself never touched.
let dir: string
beforeEach(() => { dir = scratch(); failures.setClock(() => Date.parse('2026-11-21T12:00:00Z')) })
const make = async (n: number) => { const ids: string[] = []; for (let i = 0; i < n; i++) ids.push(failures.record({ stage: 'execute', message: `boom ${i}`, graph: `g${i}.json`, shot: `shot-${i}`, quiet: true }).id); await failures.settled(); return ids }

describe('Dismissing failures', () => {
  it('dismiss hides by id, the count and the filters follow, restore shows them again, a plan writes nothing and a missing id list is refused', async () => {
    const ids = await make(4), log = () => readFileSync(join(dir, 'failures.jsonl'), 'utf8')
    expect((await failures.list({})).failures).toHaveLength(4); expect((await failures.list({})).dismissed_count).toBe(0)
    expect(await failures.plan({ ids: [ids[0], ids[1]] })).toMatchObject({ count: 2, all: false }); expect(await failures.plan({ all: true })).toMatchObject({ count: 4, all: true })
    expect(existsSync(join(dir, 'failures-dismissed.json'))).toBe(false)   // a plan changes nothing
    await expect(failures.dismiss({})).rejects.toMatchObject({ status: 400 }); await expect(failures.dismiss({ ids: [] })).rejects.toMatchObject({ status: 400 })
    expect(await failures.dismiss({ ids: [ids[0], ids[1], ids[1]] })).toEqual({ dismissed: 2, total_dismissed: 2 }); expect(await failures.dismiss({ ids: [ids[0]] })).toEqual({ dismissed: 0, total_dismissed: 2 })
    const shown = await failures.list({}); expect(shown.failures.map((f) => f.id).sort()).toEqual([ids[2], ids[3]].sort()); expect(shown.dismissed_count).toBe(2); expect(shown.failures.every((f) => f.dismissed === false)).toBe(true)
    const only = await failures.list({ dismissed: 'only' }); expect(only.failures.map((f) => f.id).sort()).toEqual([ids[0], ids[1]].sort()); expect(only.failures.every((f) => f.dismissed === true)).toBe(true)
    const all = await failures.list({ dismissed: 'all' }); expect(all.failures).toHaveLength(4); expect(all.failures.filter((f) => f.dismissed)).toHaveLength(2)
    expect(await failures.restore({ ids: [ids[0]] })).toEqual({ restored: 1, total_dismissed: 1 }); expect((await failures.list({})).failures).toHaveLength(3)
    expect(await failures.restore({ all: true })).toEqual({ restored: 1, total_dismissed: 0 }); expect((await failures.list({})).failures).toHaveLength(4)
    expect(log().trim().split('\n')).toHaveLength(4)   // the log itself has all four lines throughout
  })
  it('Dismiss All hides what is shown, a NEW failure still shows after it, and Restore All brings every one back', async () => {
    const ids = await make(3)
    expect((await failures.dismiss({ all: true })).dismissed).toBe(3); expect((await failures.list({})).failures).toHaveLength(0)
    const fresh = failures.record({ stage: 'queue', message: 'a new one', graph: 'new.json', quiet: true }); await failures.settled()
    expect((await failures.list({})).failures.map((f) => f.id)).toEqual([fresh.id])
    expect(await failures.plan({ all: true })).toMatchObject({ count: 1 }); expect(await failures.plan({ all: true, restore: true })).toMatchObject({ count: 3 })
    expect((await failures.restore({ all: true })).restored).toBe(3); expect((await failures.list({})).failures).toHaveLength(4); expect(ids).toHaveLength(3)
  })
  it('the dismissed set is a file next to the log, survives a reload of the module, and failures.jsonl is unchanged byte for byte by dismiss, dismiss all and restore; History says what happened', async () => {
    const ids = await make(5), before = readFileSync(join(dir, 'failures.jsonl'))
    await failures.dismiss({ ids: [ids[0], ids[3]] }); await failures.dismiss({ all: true }); await failures.restore({ ids: [ids[1]] })
    expect(readFileSync(join(dir, 'failures.jsonl')).equals(before)).toBe(true)
    const j = JSON.parse(readFileSync(join(dir, 'failures-dismissed.json'), 'utf8')); expect([...j.ids].sort()).toEqual([ids[0], ids[2], ids[3], ids[4]].sort())
    vi.resetModules(); const again = await import('../src/failures.js')   // a restart: nothing is held in memory
    expect((await again.list({})).failures.map((f) => f.id)).toEqual([ids[1]]); expect((await again.list({})).dismissed_count).toBe(4)
    const acts = history.list({ limit: 30 }).filter((e) => e.kind === 'change').map((e) => String((e as { action?: string }).action))
    expect(acts.some((a) => /failures dismissed/.test(a))).toBe(true); expect(acts.some((a) => /failures restored/.test(a))).toBe(true)
  })
  it('a damaged dismissed file hides nothing instead of failing the list, and the next write repairs it', async () => {
    const ids = await make(2); writeFileSync(join(dir, 'failures-dismissed.json'), '{not json')
    expect((await failures.list({})).failures.map((f) => f.id).sort()).toEqual([...ids].sort())
    expect(await failures.dismiss({ ids: [ids[0]] })).toEqual({ dismissed: 1, total_dismissed: 1 }); expect(JSON.parse(readFileSync(join(dir, 'failures-dismissed.json'), 'utf8')).ids).toEqual([ids[0]])
  })
})
