/**
 * DPX quick-look decoder (docs/ADR-037, amendment 2026-11-17). Browsers and ComfyUI's /view?preview= cannot decode DPX, so the Outputs viewer reads the file's bytes and decodes them here.
 * It is a PREVIEW, not a review: the values are taken as display-referred (the OCIOWrite files are "Gamma 2.6 P3-D65 - Display", already clipped) and mapped linearly to 8 bits (value * 255 / max); there is
 * no colour management, no transfer curve, no matrix. Use DJV (or the grading tool) for real review.
 *
 * Reads (SMPTE 268M): magic 'SDPX' (big-endian) or 'XPDS' (little-endian); offset to image data @4; width @772, height @776; image element 0 @780: descriptor u8 @800 (50 RGB, 51 RGBA, 6 luma),
 * bit depth u8 @803, packing u16 @804 (0 packed, 1 filled method A, 2 filled method B), data offset u32 @808, end-of-line padding u32 @812.
 * Supports 8, 10 (three components per 32-bit word, methods A and B), 12 (in 16-bit words, A: high 12 bits, B: low 12 bits) and 16 bit, for RGB, RGBA (alpha dropped) and luma, in both byte orders.
 * Limits: only element 0; no other descriptors (YCbCr, CbYCr, planar); 10 and 12 bit with packing 0 (a continuous bit stream) are refused; no 32-bit float; no orientation flag (rows are top to bottom).
 * Output: RGBA8 { width, height, data } (ImageData-compatible), box-averaged down by the smallest whole factor that fits `maxWidth` (default 1920; a tile thumbnail may use 320).
 * Errors (Error.message): bad magic, header too short, unsupported layout, truncated data. The parser needs no DOM; only `drawToCanvas` does.
 * Empty frames: the decoder also measures the picture (`stats`: min, max, mean per channel as fractions of full scale, the fraction of pixels that are exactly 0,0,0, from the FULL-resolution rows, sampling about every 3rd pixel and 4th row of a 4K frame)
 * and sets `problem` when it is empty: `black` or `flat` (every sampled pixel identical: all black, or one flat value). A frame that is clipped or mostly black but varies is NOT flagged. Frames that cannot be decoded at all carry a DpxError
 * with a `kind` (`empty-file` 0 bytes, `truncated` {have, need}, `zero-size` width or height 0, `missing` HTTP 404, `http`, `network`); `problemOfError` turns the first four into the same `problem` shape.
 */

/** An error with a `kind` (see above) and the numbers that explain it. */
export class DpxError extends Error {
  constructor(message, kind, extra = {}) { super(message); this.name = 'DpxError'; this.kind = kind; Object.assign(this, extra) }
}
const PROBLEM_KINDS = ['empty-file', 'truncated', 'zero-size', 'missing']
/** The `problem` of a frame that failed with `err`, or null when the failure is not a statement about the file (bad magic, a network error). */
export const problemOfError = (err) => (err && PROBLEM_KINDS.includes(err.kind) ? { kind: err.kind, have: err.have, need: err.need } : null)

const DESCRIPTORS = { 50: { name: 'RGB', n: 3 }, 51: { name: 'RGBA', n: 4 }, 6: { name: 'luma', n: 1 } }

/** The fields of the header that decide the layout; throws a clear error for anything this decoder does not read. */
export function parseDpxHeader(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (u8.byteLength === 0) throw new DpxError('Empty frame: the file is 0 bytes', 'empty-file')
  if (u8.byteLength < 4) throw new DpxError('Not a DPX file: shorter than its magic number', 'truncated', { have: u8.byteLength, need: 4 })
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3])
  if (magic !== 'SDPX' && magic !== 'XPDS') throw new Error(`Not a DPX file: bad magic "${magic.replace(/[^\x20-\x7e]/g, '?')}" (expected SDPX or XPDS)`)
  if (u8.byteLength < 820) throw new DpxError('Truncated DPX: the header is cut short', 'truncated', { have: u8.byteLength, need: 820 })
  const le = magic === 'XPDS'
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const width = dv.getUint32(772, le), height = dv.getUint32(776, le)
  const descriptor = dv.getUint8(800), bits = dv.getUint8(803), packing = dv.getUint16(804, le)
  const dataOffset = dv.getUint32(808, le) || dv.getUint32(4, le), eolPad = dv.getUint32(812, le)
  const d = DESCRIPTORS[descriptor]
  if (!width || !height) throw new DpxError(`Empty frame: the header says ${width}x${height}`, 'zero-size')
  if (width > 65535 || height > 65535) throw new Error(`Unsupported DPX: implausible size ${width}x${height}`)
  if (!d) throw new Error(`Unsupported DPX: descriptor ${descriptor} (this viewer reads RGB 50, RGBA 51 and luma 6)`)
  if (![8, 10, 12, 16].includes(bits)) throw new Error(`Unsupported DPX: ${bits} bits per component (this viewer reads 8, 10, 12 and 16)`)
  if (packing > 2) throw new Error(`Unsupported DPX: packing ${packing}`)
  if (packing === 0 && (bits === 10 || bits === 12)) throw new Error(`Unsupported DPX: ${bits}-bit with packing 0 (a continuous bit stream); only filled methods A and B are read`)
  const rowBytes = bits === 8 ? width * d.n : bits === 10 ? Math.ceil((width * d.n) / 3) * 4 : width * d.n * 2
  return { magic, littleEndian: le, width, height, descriptor, descriptorName: d.name, components: d.n, bits, packing, dataOffset, eolPad, rowBytes, stride: rowBytes + eolPad }
}

/** Decode one row's component values (width * components of them, as integers of `bits` bits) into `out`. */
function readRow(dv, off, h, out) {
  const { width, components: n, bits, packing, littleEndian: le } = h
  const count = width * n
  if (bits === 8) { for (let i = 0; i < count; i++) out[i] = dv.getUint8(off + i) }
  else if (bits === 16) { for (let i = 0; i < count; i++) out[i] = dv.getUint16(off + i * 2, le) }
  else if (bits === 12) { for (let i = 0; i < count; i++) { const w = dv.getUint16(off + i * 2, le); out[i] = packing === 1 ? w >>> 4 : w & 0xfff } }
  else {   // 10 bit: three components per 32-bit word; A leaves the low two bits empty (2..11, 12..21, 22..31), B the high two (0..9, 10..19, 20..29)
    const sh = packing === 1 ? [22, 12, 2] : [20, 10, 0]
    for (let i = 0, wi = 0; i < count; wi++) {
      const w = dv.getUint32(off + wi * 4, le)
      for (let k = 0; k < 3 && i < count; k++, i++) out[i] = (w >>> sh[k]) & 0x3ff
    }
  }
}

/** Decode `bytes` (ArrayBuffer or Uint8Array of a whole DPX file) to RGBA8, box-averaged down to at most `maxWidth` wide. Returns { width, height, data, header }. */
export function decodeDpx(bytes, { maxWidth = 1920 } = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const h = parseDpxHeader(u8)
  const need = h.dataOffset + h.stride * (h.height - 1) + h.rowBytes
  if (u8.byteLength < need) throw new DpxError(`Truncated DPX: ${u8.byteLength} bytes, the header (${h.width}x${h.height}, ${h.bits}-bit ${h.descriptorName}) needs ${need}`, 'truncated', { have: u8.byteLength, need })
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const f = Math.max(1, Math.ceil(h.width / Math.max(1, maxWidth)))
  const ow = Math.floor(h.width / f), oh = Math.floor(h.height / f)
  const n = h.components, max = (1 << h.bits) - 1, rgb = n >= 3
  const row = new Uint16Array(h.width * n), acc = new Float64Array(ow * 3), out = new Uint8ClampedArray(ow * oh * 4)
  const scale = 255 / (max * f * f)
  // The picture's statistics, from the full-resolution rows (every sy-th row, every sx-th pixel).
  const sx = Math.max(1, Math.ceil(h.width / 1024)), sy = Math.max(1, Math.ceil(h.height / 540))
  const mn = [max, max, max], mx = [0, 0, 0], sum = [0, 0, 0]
  let zeros = 0, count = 0, flat = true, r0 = 0, g0 = 0, b0 = 0
  const sample = (y) => {
    for (let x = 0; x < h.width; x += sx) {
      const i = x * n, r = row[i], g = rgb ? row[i + 1] : r, b = rgb ? row[i + 2] : r
      if (count === 0) { r0 = r; g0 = g; b0 = b } else if (flat && (r !== r0 || g !== g0 || b !== b0)) flat = false
      if (r < mn[0]) mn[0] = r; if (g < mn[1]) mn[1] = g; if (b < mn[2]) mn[2] = b
      if (r > mx[0]) mx[0] = r; if (g > mx[1]) mx[1] = g; if (b > mx[2]) mx[2] = b
      sum[0] += r; sum[1] += g; sum[2] += b
      if (r === 0 && g === 0 && b === 0) zeros++
      count++
    }
  }
  for (let oy = 0; oy < oh; oy++) {
    acc.fill(0)
    for (let dy = 0; dy < f; dy++) {
      readRow(dv, h.dataOffset + (oy * f + dy) * h.stride, h, row)
      if ((oy * f + dy) % sy === 0) sample(oy * f + dy)
      for (let ox = 0; ox < ow; ox++) {
        let r = 0, g = 0, b = 0
        for (let dx = 0; dx < f; dx++) { const i = (ox * f + dx) * n; if (rgb) { r += row[i]; g += row[i + 1]; b += row[i + 2] } else { r += row[i] } }
        acc[ox * 3] += r; acc[ox * 3 + 1] += rgb ? g : r; acc[ox * 3 + 2] += rgb ? b : r
      }
    }
    for (let ox = 0, o = oy * ow * 4; ox < ow; ox++, o += 4) { out[o] = acc[ox * 3] * scale; out[o + 1] = acc[ox * 3 + 1] * scale; out[o + 2] = acc[ox * 3 + 2] * scale; out[o + 3] = 255 }
  }
  const stats = { min: mn.map((v) => v / max), max: mx.map((v) => v / max), mean: sum.map((v) => v / max / count), zeroFraction: zeros / count, flat, samples: count }
  return { width: ow, height: oh, data: out, header: h, stats, problem: flat ? { kind: r0 === 0 && g0 === 0 && b0 === 0 ? 'black' : 'flat' } : null }
}

/**
 * Fetch a DPX from `url` (one request, read to the end; `onProgress(received, total|0)` when it can) and decode it. `signal` aborts the download.
 * Failures say what happened: HTTP 404 is a DpxError `missing`, another status `http`, and a network or CORS failure (fetch throws a TypeError, "Failed to fetch") is `network` with "Could not reach the pod file: <detail>".
 * `fallback(url)`, when given, is tried ONCE after such a TypeError and returns { status, bytes } (the app reads the file through the main process, so the viewer still works when the podfile:// scheme lacks its privilege).
 */
export async function loadDpx(url, { signal, onProgress, maxWidth, fallback } = {}) {
  const check = (status) => {
    if (status === 404) throw new DpxError('Missing: the pod has no such file', 'missing')
    if (status < 200 || status > 299) throw new DpxError(`The pod answered HTTP ${status} for this frame`, 'http', { status })
  }
  let bytes
  try {
    const r = await fetch(url, { signal })
    check(r.status)
    const total = Number(r.headers.get('content-length')) || 0
    if (r.body && onProgress) {
      const reader = r.body.getReader(), parts = []
      let got = 0
      for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress(got, total) }
      bytes = new Uint8Array(got); let p = 0
      for (const c of parts) { bytes.set(c, p); p += c.length }
    } else bytes = new Uint8Array(await r.arrayBuffer())
  } catch (e) {
    if (e?.name === 'AbortError' || e instanceof DpxError || !(e instanceof TypeError)) throw e
    if (!fallback) throw new DpxError(`Could not reach the pod file: ${e.message === 'Failed to fetch' ? 'the request failed (blocked, or the pod did not answer)' : e.message}`, 'network')
    let r
    try { r = await fallback(url) } catch (e2) { throw new DpxError(/^Could not reach/.test(e2?.message) ? e2.message : `Could not reach the pod file: ${e2?.message || e.message}`, 'network') }
    check(r.status)
    bytes = r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes)
    onProgress?.(bytes.length, bytes.length)
  }
  return decodeDpx(bytes, { maxWidth })
}

/** A small least-recently-used cache of decoded frames, by key (the frame's address). */
export function frameCache(size = 6) {
  const m = new Map()
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v },
    set(k, v) { m.delete(k); m.set(k, v); while (m.size > size) m.delete(m.keys().next().value) },
    has: (k) => m.has(k),
    get size() { return m.size },
  }
}

/** Draw a decoded frame on a canvas (the only DOM use here). */
export function drawToCanvas(canvas, frame) {
  canvas.width = frame.width; canvas.height = frame.height
  canvas.getContext('2d').putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0)
}

/**
 * A download queue for frames: at most `concurrency` (2) requests to the pod at once, higher `priority` first (a frame the viewer is waiting for before one being cached), one request per address (asking again shares it and can raise its priority).
 * `load(url, { priority, onProgress })` resolves to the decoded frame; `abort(url)` cancels one (queued or running) with an AbortError.
 */
export function createFrameLoader({ concurrency = 2, maxWidth = 1920, fallback } = {}) {
  const jobs = new Map(), queue = []
  let running = 0, n = 0
  const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
  function pump() {
    while (running < concurrency && queue.length) {
      let bi = 0
      queue.forEach((j, i) => { if (j.priority > queue[bi].priority || (j.priority === queue[bi].priority && j.seq < queue[bi].seq)) bi = i })
      const j = queue.splice(bi, 1)[0]
      running++; j.started = true
      loadDpx(j.url, { signal: j.ctrl.signal, maxWidth, fallback, onProgress: (g, t) => j.onProgress?.(g, t) }).then(j.resolve, j.reject).finally(() => { running--; if (jobs.get(j.url) === j) jobs.delete(j.url); pump() })
    }
  }
  return {
    load(url, { priority = 0, onProgress } = {}) {
      let j = jobs.get(url)
      if (j) { j.priority = Math.max(j.priority, priority); if (onProgress) j.onProgress = onProgress; return j.promise }
      j = { url, priority, onProgress, ctrl: new AbortController(), seq: n++, started: false }
      j.promise = new Promise((res, rej) => { j.resolve = res; j.reject = rej }); j.promise.catch(() => {})
      jobs.set(url, j); queue.push(j); pump()
      return j.promise
    },
    abort(url) {
      const j = jobs.get(url); if (!j) return
      jobs.delete(url); j.ctrl.abort()
      if (!j.started) { queue.splice(queue.indexOf(j), 1); j.reject(aborted()) }
    },
    abortAll() { for (const u of [...jobs.keys()]) this.abort(u) },
    get running() { return running },
    get queued() { return queue.length },
  }
}
