import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as shots from '../src/shots.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch() })

/** A tree with the tracker the structure master names, one locked shot and one open. */
function tree(): string {
  const t = join(dir, 'CANALV2')
  mkdirSync(join(t, '04_TRACKER'), { recursive: true })
  writeFileSync(join(t, '04_TRACKER', 'shots.csv'), [
    'shot,type,assigned_by,received,due,state,hero_eye,locked,next_action,folder',
    'cgi-042,cgi,Kyle,2026-10-01,2026-10-20,approved,left,yes,,10_CORROSION/cgi-042',
    'corrosion-051,corrosion,Binc,2026-10-05,,open,left,,"run at proxy, review",10_CORROSION/corrosion-051',
    'corrosion-059,corrosion,Binc,2026-10-05,,live,right, YES ,,10_CORROSION/corrosion-059',
  ].join('\n') + '\n')
  return t
}

describe('the tracker', () => {
  it('reads locked = yes from 04_TRACKER/shots.csv', () => {
    const t = tree()
    const r = shots.lockedShots(t)
    expect(r.found).toBe(true); expect(r.file).toBe(join(t, '04_TRACKER', 'shots.csv')); expect(r.rows).toBe(3)
    expect([...r.shots].sort()).toEqual(['cgi-042', 'corrosion-059'])
  })

  it('locks nothing without a tree or a tracker, and says where it looked', () => {
    expect(shots.lockedShots(null)).toEqual({ file: null, found: false, shots: new Set(), rows: 0 })
    const r = shots.lockedShots(join(dir, 'nowhere'))
    expect(r.found).toBe(false); expect(r.file).toBe(join(dir, 'nowhere', '04_TRACKER', 'shots.csv')); expect(r.shots.size).toBe(0)
  })
})

describe('shot names in a graph', () => {
  it('finds them in file names, served frames and notes, once each, never inside another word', () => {
    const graph = {
      1: { class_type: 'LoadImage', inputs: { image: '/srv/plates/corrosion-059_3D/corrosion-059_3D.LEFT.093999.dpx' } },
      2: { class_type: 'Note', inputs: { text: 'corrosion-051_graph_v015_api.json, see corrosion-051 and archival-080a; not 9corrosion-051 nor corrosion-0512 nor CGI-042' } },
    }
    expect(shots.shotsNamed(graph)).toEqual(['corrosion-059', 'corrosion-051', 'archival-080a'])
    expect(shots.shotsNamed('nothing here')).toEqual([])
    expect(shots.shotsNamed(null)).toEqual([])
  })

  it('lockedIn names the locked ones the tracker decides', () => {
    const t = tree()
    const r = shots.lockedIn({ 1: { inputs: { image: 'cgi-042_3D.LEFT.000001.dpx' } }, 2: { inputs: { text: 'corrosion-051' } } }, t)
    expect(r.named).toEqual(['cgi-042', 'corrosion-051']); expect(r.locked).toEqual(['cgi-042']); expect(r.tracker.found).toBe(true)
    expect(shots.lockedIn({ 1: { inputs: { text: 'cgi-042' } } }, null).locked).toEqual([])
  })
})
