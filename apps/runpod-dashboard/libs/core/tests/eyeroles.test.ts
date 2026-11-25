import { describe, expect, it } from 'vitest'
import { EYE_TOKENS, eyeRoleOf, eyeStemOf } from '../src/eyeroles.js'
// @ts-expect-error the page's JS mirror
import * as page from '../../../src/utils/eyeroles.js'

describe('eye roles (ADR-058)', () => {
  it('reads the role from a whole token', () => {
    for (const n of ['clip_LEFT.0001.dpx', 'clip_L.0001.dpx', 'clip.L.0001.dpx', 'clip_LE', 'clip-left']) expect(eyeRoleOf(n)).toBe('left')
    for (const n of ['clip_RIGHT.0001.dpx', 'clip_R', 'clip.R.0001.dpx', 'clip_RE', 'clip_right']) expect(eyeRoleOf(n)).toBe('right')
    for (const n of ['clip_OVERALL', 'clip_STEREO.0001.dpx', 'clip_sbs', 'clip_PACK']) expect(eyeRoleOf(n)).toBe('overall')
  })
  it('a name with no token is the left eye; a token inside a word is not a token', () => {
    expect(eyeRoleOf('delivery_v008_clip.0001.dpx')).toBe('left')
    expect(eyeRoleOf('RELEASE_REVIEW')).toBe('left')
    expect(eyeRoleOf('PACKAGE_x')).toBe('left')
    expect(eyeRoleOf('leftover_r2')).toBe('left')
  })
  it('overall wins over a left or right token', () => { expect(eyeRoleOf('clip_SBS_L')).toBe('overall') })
  it('the stem drops the token so the three slots share it', () => {
    expect(eyeStemOf('clip_v8_L')).toBe('clip_v8')
    expect(eyeStemOf('clip_v8_R')).toBe('clip_v8')
    expect(eyeStemOf('clip_v8_SBS')).toBe('clip_v8')
    expect(eyeStemOf('clip_v8')).toBe('clip_v8')
  })
  it('the page mirror has the same table and answers', () => {
    expect(page.EYE_TOKENS).toEqual(EYE_TOKENS)
    for (const n of ['a_L', 'a_R', 'a_SBS', 'a', 'a.RE.x']) { expect(page.eyeRoleOf(n)).toBe(eyeRoleOf(n)); expect(page.eyeStemOf(n)).toBe(eyeStemOf(n)) }
  })
})
