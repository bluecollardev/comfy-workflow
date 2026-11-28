import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as storage from '../src/storage.js'
import * as syncrules from '../src/syncrules.js'

// Sync rules (docs/ADR-069): fakes only, no network.
let dir = ''
const KEY = { access_key_id: 'WASABIKEY12345678', secret_access_key: 'wasabisecretwasabisecret1234' }
const W = { type: 'storage', id: 'wasabi' } as const, M = { type: 'storage', id: 'mine' } as const
const ready = async () => {
  await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'us-east-1', ...KEY, enabled: true })
  await storage.save({ id: 'mine', name: 'mine', bucket: 'm-bucket', region: 'us-east-1', ...KEY, enabled: true })
}
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rules-')); process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage-adapters.json'); process.env.SYNC_RULES_FILE = join(dir, 'sync-rules.json'); process.env.POD_MANAGER_CONFIG_DIR = dir })
afterEach(() => { delete process.env.STORAGE_ADAPTERS_FILE; delete process.env.SYNC_RULES_FILE; rmSync(dir, { recursive: true, force: true }) })

describe('sync rules', () => {
  it('migrates old events with no volumes to the * volume, once, in a 0600 file', async () => {
    await ready(); await storage.save({ id: 'wasabi', events: ['generated', 'published'] })
    expect(syncrules.get('*').rules).toEqual({ generated: [W], approved: [], published: [W] }); expect(syncrules.migrated()).toBe(true)
    expect(statSync(process.env.SYNC_RULES_FILE!).mode & 0o777).toBe(0o600)
    syncrules.get('*'); expect(syncrules.migrated()).toBe(false)
  })
  it('migrates specific volumes one entry each, skipping storages with no sending event', async () => {
    await ready(); await storage.save({ id: 'wasabi', events: ['approved'], volumes: ['volA', 'volB'] }); await storage.save({ id: 'mine', events: [] })
    const r = syncrules.all().rules
    expect(r.volA.approved).toEqual([W]); expect(r.volB.approved).toEqual([W]); expect(r['*']).toBeUndefined()
    expect(JSON.stringify(r)).not.toContain('mine')
  })
  it('later edits to the old storage fields do not change sending', async () => {
    await ready(); await storage.save({ id: 'wasabi', events: ['generated'] })
    expect(storage.forEvent('generated', 'volA').map((a) => a.id)).toEqual(['wasabi'])
    await storage.save({ id: 'wasabi', events: [], volumes: ['volZ'] })
    expect(storage.forEvent('generated', 'volA').map((a) => a.id)).toEqual(['wasabi'])
    await storage.save({ id: 'mine', events: ['generated'] })
    expect(storage.forEvent('generated', 'volA').map((a) => a.id)).toEqual(['wasabi'])
  })
  it('forEvent: own rule wins, * is the fallback, an empty own list sends nowhere, no volume uses *', async () => {
    await ready()
    syncrules.set('*', 'generated', [W])
    expect(storage.forEvent('generated', 'volA').map((a) => a.id)).toEqual(['wasabi'])
    expect(syncrules.get('volA').inherited).toEqual({ generated: true, approved: false, published: false })
    syncrules.set('volA', 'generated', [M])
    expect(storage.forEvent('generated', 'volA').map((a) => a.id)).toEqual(['mine']); expect(syncrules.get('volA').inherited!.generated).toBe(false)
    expect(storage.forEvent('generated', 'volB').map((a) => a.id)).toEqual(['wasabi']); expect(storage.forEvent('generated').map((a) => a.id)).toEqual(['wasabi'])
    syncrules.set('volA', 'generated', []); expect(storage.forEvent('generated', 'volA')).toEqual([])
    expect(storage.forEvent('approved', 'volA')).toEqual([])
  })
  it('a switched-off storage is skipped but stays in the rule; delete cleans every rule', async () => {
    await ready(); syncrules.set('volA', 'published', [W, M]); syncrules.set('*', 'approved', [M])
    await storage.setEnabled('wasabi', false)
    expect(storage.forEvent('published', 'volA').map((a) => a.id)).toEqual(['mine']); expect(syncrules.get('volA').rules.published).toEqual([W, M])
    await storage.remove('mine')
    expect(syncrules.get('volA').rules.published).toEqual([W]); expect(syncrules.get('*').rules.approved).toEqual([])
  })
  it('set validates and records History', async () => {
    await ready()
    expect(() => syncrules.set('volA', 'nope', [])).toThrow(/event is one of/)
    expect(() => syncrules.set('volA', 'generated', [{ type: 'storage', id: 'ghost' }])).toThrow(/no storage ghost/)
    expect(() => syncrules.set('volA', 'generated', [{ type: 'storage', id: 'panama-s3' }])).toThrow(/not a destination/)
    expect(() => syncrules.set('volA', 'generated', [{ type: 'storage', id: 'publish-s3' }])).toThrow(/not a destination/)
    expect(() => syncrules.set('volA', 'generated', [{ type: 'volume', id: 'volB' }])).toThrow(/Not built yet/)
    expect(() => syncrules.set('bad id!', 'generated', [])).toThrow(/volume_id/)
    expect(syncrules.set('volA', 'generated', [W, W, M]).rules.generated).toEqual([W, M])
    expect(existsSync(process.env.SYNC_RULES_FILE!)).toBe(true); expect(readFileSync(process.env.SYNC_RULES_FILE!, 'utf8')).not.toContain('wasabisecret')
  })
})
