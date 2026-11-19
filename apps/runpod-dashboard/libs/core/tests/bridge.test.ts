import { describe, expect, it } from 'vitest'
import * as bridge from '../src/bridge.js'

// ADR-054: the status bridge's pure part. No S3, no network.
const NOW = Date.parse('2026-11-19T12:00:00Z')
const KEY = 'AKIAEXAMPLEKEY1234', TOKEN = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY', SIGNED = 'https://bucket.s3.amazonaws.com/a.mov?X-Amz-Signature=abcdef'
const base = { name: 'binc', appVersion: '1.6.2', now: NOW, home: '/Users/binc' }

describe('buildSnapshot', () => {
  it('carries only whitelisted fields, whatever the input holds', () => {
    const s = bridge.buildSnapshot({ ...base, pods: [{ id: 'p1', name: 'CanalV2', gpu: 'RTX 6000', status: 'RUNNING', cost_per_hr: 0.7, api_key: KEY, env: { SECRET: TOKEN } }] })
    expect(JSON.stringify(s)).not.toContain(KEY)
    expect(JSON.stringify(s)).not.toContain(TOKEN)
    expect(Object.keys(s.pods[0]).sort()).toEqual(['cost_per_hr', 'gpu', 'id', 'idle_stop_min', 'name', 'round', 'status'])
    expect(s.schema).toBe('rpm-bridge-1')
  })
  it('redacts every secret shape in free text', () => {
    const s = bridge.buildSnapshot({ ...base, events: [{ time: 't', kind: 'publish', text: `uploaded ${SIGNED} with ${KEY} and ${TOKEN} from /Users/binc/Work/x.mov` }] })
    const t = s.events[0].text
    for (const bad of [SIGNED, 'X-Amz', KEY, TOKEN, '/Users/binc']) expect(t).not.toContain(bad)
    expect(t).toContain('<url>')
  })
  it('counts the queue by state and caps the lists', () => {
    const tasks = Array.from({ length: 120 }, (_, n) => ({ id: `t${n}`, state: n % 2 ? 'running' : 'queued' }))
    const s = bridge.buildSnapshot({ ...base, tasks })
    expect(s.queue.counts).toEqual({ queued: 60, running: 60 })
    expect(s.queue.tasks).toHaveLength(100)
  })
  it('keeps the last 200 events and defaults Auto-publish to dry run', () => {
    const events = Array.from({ length: 250 }, (_, n) => ({ time: String(n), kind: 'k', text: `e${n}` }))
    const s = bridge.buildSnapshot({ ...base, events })
    expect(s.events).toHaveLength(200); expect(s.events[0].text).toBe('e50')
    expect(s.autopublish.dry_run).toBe(true)
  })
  it('refuses a bad instance name', () => {
    for (const n of ['', 'Binc', 'a b', '../x', 'x'.repeat(41)]) expect(() => bridge.buildSnapshot({ ...base, name: n })).toThrow(/instance name/)
  })
})

describe('freshness', () => {
  const at = (s: number) => new Date(NOW - s * 1000).toISOString()
  it('is live under two intervals, late under ten, then offline', () => {
    expect(bridge.freshness(at(10), NOW)).toEqual({ state: 'live', age_s: 10 })
    expect(bridge.freshness(at(59), NOW).state).toBe('live')
    expect(bridge.freshness(at(60), NOW).state).toBe('late')
    expect(bridge.freshness(at(299), NOW).state).toBe('late')
    expect(bridge.freshness(at(300), NOW).state).toBe('offline')
  })
  it('is offline with no age when there is no usable time', () => {
    expect(bridge.freshness(undefined, NOW)).toEqual({ state: 'offline', age_s: null })
    expect(bridge.freshness('nonsense', NOW).age_s).toBeNull()
  })
})

describe('parseSnapshot and keyFor', () => {
  it('round-trips our schema and refuses anything else', () => {
    const s = bridge.buildSnapshot(base)
    expect(bridge.parseSnapshot(JSON.stringify(s))?.from.name).toBe('binc')
    expect(bridge.parseSnapshot('{"schema":"other"}')).toBeNull()
    expect(bridge.parseSnapshot('not json')).toBeNull()
  })
  it('builds the keys under the prefix', () => {
    expect(bridge.keyFor('bridge/', 'binc', 'status.json')).toBe('bridge/binc/status.json')
    expect(bridge.keyFor('bridge', 'binc', 'events.jsonl')).toBe('bridge/binc/events.jsonl')
  })
})
