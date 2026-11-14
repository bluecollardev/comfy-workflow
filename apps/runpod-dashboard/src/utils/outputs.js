/** The address of one output file on a pod's ComfyUI: GET /view?filename=&subfolder=&type= (the `base` is the pod's web address). */
export const viewUrl = (base, f) => `${String(base || '').replace(/\/$/, '')}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}`

const KINDS = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image', mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', wav: 'audio', mp3: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio' }
export const kindOf = (filename) => KINDS[String(filename).split('.').pop().toLowerCase()] || 'other'
/** A pod's finished runs (what ComfyUI's history keeps) as the runs that produced files: saved results and previews, never the `input` echoes of a loader; newest first. */
export function runsWithOutputs(runs) {
  return (runs || []).filter((r) => r.status === 'success').map((r) => ({
    prompt_id: r.prompt_id, started_at: r.started_at, duration_s: r.duration_s,
    files: (r.outputs || []).filter((o) => o.type === 'output' || o.type === 'temp').map((o) => ({ filename: o.filename, subfolder: o.subfolder || '', type: o.type, kind: kindOf(o.filename) }))
      .sort((a, b) => Number(a.type === 'temp') - Number(b.type === 'temp')),
  })).filter((r) => r.files.length)
}
