import { beforeEach, describe, expect, it } from 'vitest'
import * as library from '../src/library.js'
import { scratch } from './helpers.js'

// ADR-044 step 1: where rounds come from. A source only lists, in one shape; the BH bucket (panama-s3) is the first.
beforeEach(() => { scratch() })

describe('the library', () => {
  it('shows a BH round in the shared item shape, with the same fields the picker always had', () => {
    const it1 = library.itemOfRound({ name: 'brynley-comfy-2026-10-20', staged: false, state: 'partial', present: 391, expected: 1283, missing: 892, bytes: 8100000000 })
    expect(it1).toEqual({ source: 'panama-s3', id: 'brynley-comfy-2026-10-20', name: 'brynley-comfy-2026-10-20', shots: [], staged: false, verified: false, importable: true, state: 'partial', present: 391, expected: 1283, missing: 892, bytes: 8100000000 })
    const done = library.itemOfRound({ name: 'r', staged: true, state: 'complete', present: 3, expected: 3, missing: 0, bytes: 9 })
    expect(done).toMatchObject({ staged: true, verified: true, importable: true })   // verified is the done marker: all of it, checked
    expect(library.itemOfRound({ name: 'r', staged: false, state: 'unverified', present: 3, expected: 3, missing: 0, bytes: 9 }).verified).toBe(false)
  })

  it('lists the sources: the BH bucket, with whether it can be used now and why not', () => {
    const s = library.sources()
    expect(s.map((x) => x.id)).toEqual(['panama-s3', 'volume'])   // the volume source (ADR-044) is the second; it needs a volume chooser
    expect(s[1]).toMatchObject({ id: 'volume', needs: 'volume' })
    expect(s[0]).toMatchObject({ id: 'panama-s3', name: 'BH (Panama bucket)' })
    expect(typeof s[0].available).toBe('boolean'); expect(typeof s[0].reason).toBe('string'); expect(s[0].hint).toMatch(/bucket/)
    if (!s[0].available) expect(s[0].reason).not.toBe('')   // a source that is off says why
    expect(library.DEFAULT_SOURCE).toBe('panama-s3')
  })

  it('refuses a source it does not have, naming the ones it has', async () => {
    await expect(library.list('nope')).rejects.toMatchObject({ status: 404 })
    await expect(library.list('nope')).rejects.toThrow(/No such source: nope \(have: panama-s3, volume\)/)
  })
})
