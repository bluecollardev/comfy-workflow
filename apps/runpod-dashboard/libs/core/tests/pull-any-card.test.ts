import { describe, expect, it } from 'vitest'
import * as mounts from '../src/mounts.js'

describe('the pull_any_card root setting', () => {
  it('is on by default, whether the saved file has it or not, and only an explicit false turns it off', () => {
    expect(mounts.defaults().pull_any_card).toBe(true)
    expect(mounts.normalize({}).pull_any_card).toBe(true)
    expect(mounts.normalize({ pull_any_card: true }).pull_any_card).toBe(true)
    expect(mounts.normalize({ pull_any_card: false }).pull_any_card).toBe(false)
    expect(mounts.normalize({ pull_any_card: 'no' as never }).pull_any_card).toBe(true)   // not a boolean false: ignored, never turns the safety on or off by accident
  })
})
