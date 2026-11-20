// The window's copy of the OCIO table and the DPX transfer names (src/utils/ocio.js) must say what the core's say (renders.ts): the Outputs chips and the Colour panel name the colour the converter converts from.
import { describe, expect, it } from 'vitest'
import * as renders from '../src/renders'
// @ts-expect-error the renderer's plain JavaScript module
import * as win from '../../../src/utils/ocio.js'

describe('src/utils/ocio.js agrees with the core', () => {
  it('the interop table: same ids, colour_in, label and linearity', () => {
    expect(win.OCIO_INTEROP).toEqual(renders.OCIO_INTEROP)
  })
  it('the transfer names and the not-display codes', () => {
    expect(win.TRANSFER_NAMES).toEqual(renders.TRANSFER_NAMES)
    expect(win.NOT_DISPLAY).toEqual(renders.NOT_DISPLAY)
  })
  it('a record parses to the same colour, label and words; the same records are no record', () => {
    const rec = (id: string) => JSON.stringify({ attributes: { colorInteropID: id, 'com.ocio.colorspace': 'Gamma 2.6 P3-D65 - Display', 'com.ocio.gamut': 'P3-D65' } })
    for (const id of [...Object.keys(renders.OCIO_INTEROP), 'nope', 'constructor']) {
      const a = renders.parseOcioRecord(rec(id)), b = win.parseOcioRecord(rec(id))
      if (!a) { expect(b).toBeNull(); continue }
      expect(b).toMatchObject({ colour_in: a.colour_in, label: a.label, colorInteropID: a.colorInteropID, colorspace: a.colorspace, gamut: a.gamut })
      for (const t of [0, 1, 2, 3, 4, 6, 13]) expect(win.headerDisagrees(b, { transfer: t })).toBe(renders.headerDisagrees(a, { transfer: t } as never))
    }
  })
})
