import { afterEach, describe, expect, it } from 'vitest'
import * as autogenerate from '../src/autogenerate.js'

// Import Round > Generate Outputs: which DPX sequences on the volume count as "new" for a shot. The listing is a fake; nothing reaches S3.
const frames = (folder: string, stem: string, ns: number[], modified: string) => ({ folder, files: ns.map((n) => ({ filename: `${stem}.${String(n).padStart(4, '0')}.dpx`, modified })) })
afterEach(() => autogenerate.setDeps(null))

describe('newVolumeSequences', () => {
  it('returns the new complete sequences of the shot; leaves out old ones, ones with gaps, weights and other shots, with reasons', async () => {
    const since = Date.parse('2026-11-20T10:00:00Z')
    autogenerate.setDeps({
      volumeListing: async () => [
        frames('cgi-043', 'cgi-043_new', [1, 2, 3, 4], '2026-11-20T10:30:00Z'),
        frames('cgi-043', 'cgi-043_old', [1, 2, 3], '2026-11-19T10:30:00Z'),
        frames('cgi-043', 'cgi-043_gap', [1, 2, 4], '2026-11-20T10:30:00Z'),
        frames('cgi-044', 'cgi-044_new', [1, 2], '2026-11-20T10:30:00Z'),
        frames('cgi-043', 'cgi-043_nodate', [1, 2], ''),
      ],
    })
    const r = await autogenerate.newVolumeSequences('cgi-043', since)
    expect(r.sequences).toEqual([{ dir: 'cgi-043', name: 'cgi-043_new', first: 1, last: 4, frames: 4, pad: 4 }])
    const why = Object.fromEntries(r.skipped.map((s) => [s.stem, s.reason]))
    expect(why['cgi-043_old']).toMatch(/not new/); expect(why['cgi-043_gap']).toMatch(/incomplete: 1 gap/); expect(why['cgi-043_nodate']).toMatch(/cannot tell/)
    expect(Object.keys(why)).not.toContain('cgi-044_new')
  })
  it('a listing that cannot be read gives nothing, not an error', async () => {
    autogenerate.setDeps({ volumeListing: async () => null })
    expect(await autogenerate.newVolumeSequences('cgi-043', 0)).toEqual({ sequences: [], skipped: [] })
  })
})
