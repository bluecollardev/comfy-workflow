import { describe, expect, it } from 'vitest'
import * as layout from '../src/publishlayout.js'

describe('elementOf: the element of a clip name', () => {
  it('reads a multi-letter element, a single letter and MAIN', () => {
    expect(layout.elementOf('ARCHIVAL-087_PLATFORM_FINAL_V01_3840X2160_23.976_PRORES422HQ')).toBe('PLATFORM')
    expect(layout.elementOf('ARCHIVAL-087_RAIN_FINAL_V01_3840X2160_23.976_PRORES422HQ')).toBe('RAIN')
    expect(layout.elementOf('PHOTOREAL-013_CHASM07_FINAL_V01_1920X1080_24_HEVC')).toBe('CHASM07')
    expect(layout.elementOf('CREATURE-266_DOLPHIN-LOWTRACK_ALT_V01_1920X1080_23.976_PRORES422HQ')).toBe('DOLPHIN-LOWTRACK')
    expect(layout.elementOf('ARCHIVAL-077_A_FINAL_V03_3840X2160_23.976_PRORES422HQ')).toBe('A')
    expect(layout.elementOf('ARCHIVAL-080_A_STILL_V01_6336X2688_PNG')).toBe('A')
    expect(layout.elementOf('ARCHIVAL-071_MAIN_FINAL_V02_3840X2160_23.976_PRORES422HQ')).toBe('main')
    expect(layout.elementOf('something-else')).toBe('main')
  })
})

describe('mergeManifest keeps the other elements of a shot', () => {
  const item = (shot: string, element: string) => ({ shot, element, input_final: { delivered_name: `${shot}_${element}`, sha256: 'x' } }) as never
  const pod = { pod_id: 'n/a' } as never
  it('replaces only the elements this run published', () => {
    const first = layout.mergeManifest(null, { round: 'r', returned_by: 'L', now: 1, pod, items: [item('archival-123', 'C')] })
    const second = layout.mergeManifest(JSON.stringify(first), { round: 'r', returned_by: 'L', now: 2, pod, items: [item('archival-123', 'F'), item('archival-087', 'RAIN')] })
    expect(second.items.map((i: { shot: string; element: string }) => `${i.shot}|${i.element}`).sort()).toEqual(['archival-087|RAIN', 'archival-123|C', 'archival-123|F'])
    const third = layout.mergeManifest(JSON.stringify(second), { round: 'r', returned_by: 'L', now: 3, pod, items: [item('archival-123', 'C')] })
    expect(third.items).toHaveLength(3)   // C replaced in place, F and RAIN kept
  })
})
