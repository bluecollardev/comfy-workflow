import { describe, expect, it } from 'vitest'
import { ucwords } from '../../../src/utils/ucwords.js'

describe('ucwords: the title case of a job line (shown, not stored)', () => {
  it('capitalizes plain words and keeps names exactly', () => {
    expect(ucwords('starting: ComfyUI-Pull-vol-a3upg9ey48-1115')).toBe('Starting: ComfyUI-Pull-vol-a3upg9ey48-1115')
    expect(ucwords('Approved by a click in the app window.')).toBe('Approved By A Click In The App Window.')
    expect(ucwords('downloading file 2 of 5')).toBe('Downloading File 2 Of 5')
    expect(ucwords('connecting (SSH)')).toBe('Connecting (SSH)')
    expect(ucwords('FETCHED vae/ae.safetensors 335304388\nFETCH-DONE')).toBe('FETCHED vae/ae.safetensors 335304388\nFETCH-DONE')   // markers, paths and numbers stay
    expect(ucwords('done: 2 files loaded')).toBe('Done: 2 Files Loaded')
    expect(ucwords('')).toBe('')
  })
})
