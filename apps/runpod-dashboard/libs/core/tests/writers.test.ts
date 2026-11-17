import { describe, expect, it } from 'vitest'
import * as runflows from '../src/runflows.js'
import { WRITER_FILE_CAP, writtenFiles } from '../src/writers.js'

// OCIOWrite saves a frame sequence and tells ComfyUI only the first file and a count; the Outputs button needs the whole list.
const FOLDER = 'proxy_v004/archival-080/archival-080_a_v004_dpx16'
const outputs = { '128': { ocio: ['Gamma 2.6 P3-D65 - Display -> Gamma 2.6 P3-D65 - Display'], count: ['3'], saved: ['archival-080_a_v004_proxy.0000.dpx'], meta: ['dpx 16 clipped'] } }
const api = { '128': { class_type: 'OCIOWrite', inputs: { output_folder: FOLDER, filename: 'archival-080_a_v004_proxy', write_sidecar: true, still_format: 'dpx' } } }

describe('a writer node that reports a first file and a count', () => {
  it('lists every frame, numbered from the first, and the sidecar, under its output folder', () => {
    expect(writtenFiles(outputs, api)).toEqual([
      { node: '128', filename: 'archival-080_a_v004_proxy.0000.dpx', subfolder: FOLDER },
      { node: '128', filename: 'archival-080_a_v004_proxy.0001.dpx', subfolder: FOLDER },
      { node: '128', filename: 'archival-080_a_v004_proxy.0002.dpx', subfolder: FOLDER },
      { node: '128', filename: 'archival-080_a_v004_proxy.json', subfolder: FOLDER },
    ])
  })
  it('keeps the first frame\'s number and width when the sequence starts elsewhere', () => {
    const o = { '7': { saved: ['shot.0998.exr'], count: ['3'] } }
    expect(writtenFiles(o, { '7': { inputs: { output_folder: 'a/b' } } }).map((f) => f.filename)).toEqual(['shot.0998.exr', 'shot.0999.exr', 'shot.1000.exr'])
  })
  it('lists one file for a single-file write, and nothing for a node with no saved name', () => {
    expect(writtenFiles({ '9': { saved: ['clip.mov'], count: ['1'] } }, { '9': { inputs: { output_folder: 'x' } } })).toEqual([{ node: '9', filename: 'clip.mov', subfolder: 'x' }])
    expect(writtenFiles({ '9': { images: [] }, '10': { count: ['4'] } }, {})).toEqual([])
  })
  it('never names a path outside the output folder, and caps a very long sequence', () => {
    expect(writtenFiles(outputs, { '128': { inputs: { output_folder: '../escape' } } })).toEqual([])
    expect(writtenFiles({ '1': { saved: ['../x.0000.dpx'], count: ['2'] } }, {})).toEqual([])
    expect(writtenFiles({ '1': { saved: ['f.0000.dpx'], count: ['100000'] } }, { '1': { inputs: {} } }).length).toBe(WRITER_FILE_CAP)
  })
  it('reaches the run window: a finished run with only that writer has outputs and its files, as the gallery wants them', () => {
    const o = runflows.outcomeOf({ status: { status_str: 'success' }, outputs, prompt: [1, 'p', api] })
    expect(o).toMatchObject({ done: true, outputs: 1 })
    expect(o?.files).toHaveLength(4)
    expect(o?.files?.[0]).toMatchObject({ filename: 'archival-080_a_v004_proxy.0000.dpx', subfolder: FOLDER, type: 'output', kind: 'other', node: '128' })
    expect(runflows.filesOf(outputs)).toEqual([])   // without the graph there is no folder to name: nothing is invented
  })
})
