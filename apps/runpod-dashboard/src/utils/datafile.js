// The text of a data file for the Data File popup (Lucas, 2026-11-21: "it's always 1 data file so have this be a modal popup"): read lazily through the route the gallery already uses (podfile://, s3file://,
// localfile://), at most 1 MB of it; a binary or unknown type is not shown, only its name, size and Download. Pure except `readText`, which takes the fetch response so the specs can fake it.

export const PREVIEW_MAX = 1024 * 1024
export const TEXT_EXT = /\.(json|md|csv|txt|log|yaml|yml|xml|tsv|ini|cfg|toml)$/i
export const isTextName = (name) => TEXT_EXT.test(String(name || ''))

/** Read up to `max` bytes of the response body (the stream is cancelled when the cap is reached), decoded as UTF-8: { text, truncated, binary }. */
export async function readText(res, max = PREVIEW_MAX) {
  const reader = res.body?.getReader?.()
  const chunks = []
  let n = 0, truncated = false
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const room = max - n
      if (value.length > room) { chunks.push(value.slice(0, room)); n += room; truncated = true; try { await reader.cancel() } catch { /* the stream is dropped anyway */ } break }
      chunks.push(value); n += value.length
    }
  } else {
    const all = new Uint8Array(await res.arrayBuffer())
    truncated = all.length > max
    chunks.push(truncated ? all.slice(0, max) : all); n = Math.min(all.length, max)
  }
  const bytes = new Uint8Array(n)
  let o = 0
  for (const c of chunks) { bytes.set(c, o); o += c.length }
  const binary = bytes.subarray(0, Math.min(n, 8192)).includes(0)   // a NUL byte in the first 8 KB: not text
  return { text: binary ? '' : new TextDecoder('utf-8', { fatal: false }).decode(bytes), truncated, binary }
}

/** JSON pretty-printed (two spaces) when the whole file was read and it parses; the text as it is otherwise (a cut-off JSON is never reformatted). */
export function pretty(name, text, truncated) {
  if (truncated || !/\.json$/i.test(String(name || ''))) return text
  try { return JSON.stringify(JSON.parse(text), null, 2) } catch { return text }
}
