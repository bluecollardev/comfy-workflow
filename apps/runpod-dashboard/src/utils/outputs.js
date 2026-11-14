/** The address of one output file on a pod's ComfyUI: GET /view?filename=&subfolder=&type= (the `base` is the pod's web address). */
/** `web: true` is the https address (Open in a tab, Download); otherwise, in the app, the podfile:// address the main process serves (RunPod's proxy refuses a page's own request for these files with a 403). `thumb` asks ComfyUI for a small WebP of an image (the 4K frames are several MB). */
export const viewUrl = (base, f, o = {}) => {
  let b = String(base || '').replace(/\/$/, '')
  if (!o.web && typeof window !== 'undefined' && window.core) b = b.replace(/^https:\/\//, 'podfile://')
  return `${b}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}${o.thumb ? '&preview=webp;70' : ''}`
}

const KINDS = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image', mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', wav: 'audio', mp3: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio' }
export const kindOf = (filename) => KINDS[String(filename).split('.').pop().toLowerCase()] || 'other'
/** A run started in ComfyUI's own window has no workflow tag: guess the shot from the file names a delivery uses (`<shot>__<name>`), e.g. archival-123__archival-123c-wide-… -> archival-123c. */
export function guessOf(outputs) {
  for (const o of outputs || []) {
    const seg = String(o.filename).split('__')[1]
    const m = seg && seg.match(/^([A-Za-z]+-\d+[a-z]?)/)
    if (m) return m[1]
  }
  return ''
}
/** The name of a run for headers and zip folders: the workflow's file name (without .json), else the guessed shot, else nothing. */
export const runName = (r) => (r.workflow ? r.workflow.split('/').pop().replace(/\.json$/i, '') : r.guess || '')
/** A pod's finished runs as the runs that produced files: saved results and previews, never the `input` echoes of a loader; newest first. Each carries the workflow it came from (the app's tag in ComfyUI's history) or a guess from the file names. */
export function runsWithOutputs(runs) {
  return (runs || []).filter((r) => r.status === 'success').map((r) => ({
    prompt_id: r.prompt_id, started_at: r.started_at, duration_s: r.duration_s, workflow: r.workflow || '', guess: r.workflow ? '' : guessOf(r.outputs),
    files: (r.outputs || []).filter((o) => o.type === 'output' || o.type === 'temp').map((o) => ({ filename: o.filename, subfolder: o.subfolder || '', type: o.type, kind: kindOf(o.filename) }))
      .sort((a, b) => Number(a.type === 'temp') - Number(b.type === 'temp')),
  })).filter((r) => r.files.length)
}
/** The runs of one shot: the workflow's path or the guessed shot contains the shot's name. */
export const runsForShot = (runs, shot) => (shot ? (runs || []).filter((r) => `${r.workflow || ''} ${r.guess || ''}`.toLowerCase().includes(String(shot).toLowerCase())) : runs || [])
