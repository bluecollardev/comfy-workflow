// The colour chips and the viewer's Colour panel (src/utils/ocio.js): the interop table, the record parser, the header/record disagreement, the chips as data, the record's address, and the lazy cached read. `npm run dpx:test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OCIO_INTEROP, parseOcioRecord, chromaText, headerDisagrees, chipsOf, transferName, headerColour, stemOf, recordUrl, loadRecord, loadHeaderColour, clearColourCache } from './ocio.js'
import { makeDpx } from './dpx-fixture.mjs'

const record = (id, extra = {}) => JSON.stringify({ file: 'x.0000.dpx', writer: 'ComfyUI-OCIO', codec: 'dpx 16', attributes: { chromaticities: [0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.3127, 0.329], 'com.ocio.gamut': 'P3-D65', colorInteropID: id, 'com.ocio.colorspace': 'Gamma 2.6 P3-D65 - Display', ...extra } })
const G26 = record('g26_p3d65_display')

test('the interop table maps each id to the converter colour and a label', () => {
  assert.deepEqual(Object.keys(OCIO_INTEROP).sort(), ['g22_p3d65_display', 'g26_p3d65_display', 'lin_p3d65_scene', 'lin_rec709_scene', 'srgb_p3d65_display'])
  assert.equal(parseOcioRecord(G26).colour_in, 'p3-d65-gamma26')
  assert.equal(parseOcioRecord(record('lin_rec709_scene')).colour_in, 'linear-rec709')
  assert.equal(parseOcioRecord(record('srgb_p3d65_display')).label, 'sRGB P3-D65')
})
test('a record gives the writer\'s words; junk, an unknown id and a huge file are no record', () => {
  assert.deepEqual(parseOcioRecord(JSON.stringify({ writer: 'ComfyUI-OCIO', attributes: { colorInteropID: 'g26_p3d65_display', fps: 24, 'com.ocio.gamut': 'P3-D65', 'com.ocio.colorspace': 'Gamma 2.6 P3-D65 - Display', chromaticities: [0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.3127, 0.329] } })), { colour_in: 'p3-d65-gamma26', label: 'Gamma 2.6 P3-D65', linear: false, colorInteropID: 'g26_p3d65_display', colorspace: 'Gamma 2.6 P3-D65 - Display', gamut: 'P3-D65', chromaticities: 'R 0.68, 0.32 · G 0.265, 0.69 · B 0.15, 0.06 · W 0.3127, 0.329', writer: 'ComfyUI-OCIO', fps: 24 })
  for (const bad of [record('g24_rec2020_display'), record('constructor'), '{', '', 'null', '[]', '{"attributes":{}}', '{"attributes":{"colorInteropID":5}}', JSON.stringify({ attributes: { colorInteropID: 'g26_p3d65_display', pad: 'x'.repeat(300_000) } })]) assert.equal(parseOcioRecord(bad), null)
  assert.equal(parseOcioRecord(null), null); assert.equal(parseOcioRecord(undefined), null)
  assert.equal(chromaText([1, 2]), null)
})
test('the header disagrees with a display record when it says linear, log or density; with a linear record when it is not linear', () => {
  const g26 = parseOcioRecord(G26), lin = parseOcioRecord(record('lin_p3d65_scene'))
  for (const t of [1, 2, 3, 11, 12, 13]) assert.equal(headerDisagrees(g26, { transfer: t }), true)
  for (const t of [0, 4, 6]) assert.equal(headerDisagrees(g26, { transfer: t }), false)
  assert.equal(headerDisagrees(lin, { transfer: 2 }), false); assert.equal(headerDisagrees(lin, { transfer: 6 }), true)
  assert.equal(headerDisagrees(null, { transfer: 2 }), false); assert.equal(headerDisagrees(g26, null), false)
})
test('the chips: record muted, amber header when it disagrees, grey header words with no record, nothing when they agree or nothing is known', () => {
  const g26 = parseOcioRecord(G26)
  assert.deepEqual(chipsOf(g26, { transfer: 2 }), { record: { label: 'Gamma 2.6 P3-D65' }, header: { name: 'linear', disagrees: true } })
  assert.deepEqual(chipsOf(null, { transfer: 1 }), { record: null, header: { name: 'printing density', disagrees: false } })
  assert.deepEqual(chipsOf(g26, { transfer: 6 }), { record: { label: 'Gamma 2.6 P3-D65' }, header: null })
  assert.deepEqual(chipsOf(g26, null), { record: { label: 'Gamma 2.6 P3-D65' }, header: null })
  assert.deepEqual(chipsOf(null, null), { record: null, header: null })
  assert.equal(transferName(99), 'code 99')
})
test('the record sits beside the frames: <stem>.json in the same folder', () => {
  assert.equal(stemOf('archival-080_b_mono_v018_NOT_RELEASED.0040.dpx'), 'archival-080_b_mono_v018_NOT_RELEASED')
  assert.equal(stemOf('shot_0001.dpx'), 'shot'); assert.equal(stemOf('single.dpx'), 'single')
  assert.equal(recordUrl('https://p-8188.proxy.runpod.net', { filename: 'a.0001.dpx', subfolder: 'r/s', type: 'output' }), 'https://p-8188.proxy.runpod.net/view?filename=a.json&subfolder=r%2Fs&type=output')
  assert.equal(recordUrl('', { filename: 'a.0001.dpx' }), '')
})
test('the header colour is read from the first bytes, leniently', () => {
  assert.deepEqual(headerColour(makeDpx({ transfer: 2, colorimetric: 2 }).subarray(0, 2048)), { transfer: 2, colorimetric: 2 })
  assert.equal(headerColour(new Uint8Array(100)), null); assert.equal(headerColour(Buffer.alloc(900)), null)
})

const asResponse = (status, body) => ({ status, arrayBuffer: async () => body, body: body && { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new Uint8Array(body) })) } } } })
test('the record is read once per address; a missing, refused or broken read is null and never throws; the app reader is the fallback', async () => {
  const real = globalThis.fetch, calls = []
  try {
    clearColourCache()
    globalThis.fetch = async (u) => { calls.push(u); if (u.includes('ok')) return asResponse(200, new TextEncoder().encode(G26).buffer); if (u.includes('gone')) return asResponse(404, null); throw new Error('boom') }
    assert.equal((await loadRecord('x://ok'))?.colour_in, 'p3-d65-gamma26'); assert.equal((await loadRecord('x://ok'))?.colour_in, 'p3-d65-gamma26')
    assert.equal(calls.length, 1)
    assert.equal(await loadRecord('x://gone'), null); assert.equal(await loadRecord('x://boom'), null); assert.equal(await loadRecord(''), null)
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
    assert.equal((await loadRecord('podfile://via-app', { fallback: async () => ({ status: 200, bytes: new TextEncoder().encode(G26) }) }))?.label, 'Gamma 2.6 P3-D65')
    assert.equal(await loadRecord('podfile://app-fails', { fallback: async () => { throw new Error('no') } }), null)
    assert.equal(await loadRecord('podfile://too-big', { fallback: async () => ({ status: 200, bytes: new Uint8Array(300_000) }) }), null)
  } finally { globalThis.fetch = real; clearColourCache() }
})
test('the header is peeked from a frame\'s first 2 KB, and not read for a volume address', async () => {
  const real = globalThis.fetch
  try {
    clearColourCache()
    globalThis.fetch = async () => asResponse(200, makeDpx({ transfer: 2 }).buffer.slice(0, 4096))
    assert.deepEqual(await loadHeaderColour('https://p/view?x=1'), { transfer: 2, colorimetric: 2 })
    assert.equal(await loadHeaderColour('s3file://v/key'), null)
    globalThis.fetch = async () => asResponse(404, null)
    assert.equal(await loadHeaderColour('https://p/view?x=2'), null)
  } finally { globalThis.fetch = real; clearColourCache() }
})
