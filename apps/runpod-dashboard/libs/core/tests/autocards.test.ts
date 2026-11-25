import { describe, it, expect } from 'vitest'
import * as mounts from '../src/mounts.js'
import * as gpus from '../src/gpus.js'

describe('auto_cards (the stock default cards)', () => {
  it('is empty by default and then autoCards is the built-in stock list', () => {
    const d = mounts.normalize({})
    expect(d.auto_cards).toEqual([])
    expect(mounts.autoCards(d).map((g) => g.id)).toEqual(gpus.autoCards().map((g) => g.id))
  })
  it('a saved list replaces the stock list, in its order, and an unknown card is refused', () => {
    const c = mounts.normalize({ auto_cards: ['rtx4090', 'a4000', 'rtx4090', 'rtxpro6000'] })
    expect(c.auto_cards).toEqual(['rtx4090', 'a4000', 'rtxpro6000'])
    expect(mounts.autoCards(c).map((g) => g.name)).toEqual(['RTX 4090', 'RTX A4000', 'RTX PRO 6000'])
    expect(() => mounts.validate(mounts.normalize({ auto_cards: ['gtx-9000'] }))).toThrow(/auto_cards/)
  })
})
