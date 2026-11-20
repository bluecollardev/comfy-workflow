/** Synthetic DPX files for the tests (the decoder's unit test and the gallery's browser test): a header with the fields utils/dpx.js reads, and pixels from `fn(x, y, c)` (an integer of `bits` bits). */
export function makeDpx({ width = 16, height = 8, bits = 16, packing = 0, le = false, descriptor = 50, eol = 0, transfer = 2, colorimetric = 2, timecode = 0, fn = (x, y, c) => 0 } = {}) {
  const n = { 50: 3, 51: 4, 6: 1 }[descriptor]
  const rowBytes = bits === 8 ? width * n : bits === 10 ? Math.ceil((width * n) / 3) * 4 : width * n * 2
  const off = 2048, buf = Buffer.alloc(off + (rowBytes + eol) * height)
  const w32 = (o, v) => (le ? buf.writeUInt32LE(v, o) : buf.writeUInt32BE(v, o)), w16 = (o, v) => (le ? buf.writeUInt16LE(v, o) : buf.writeUInt16BE(v, o))
  buf.write(le ? 'XPDS' : 'SDPX', 0, 'latin1'); w32(4, off); w32(772, width); w32(776, height)
  buf[800] = descriptor; buf[801] = transfer; buf[802] = colorimetric; buf[803] = bits; w32(1920, timecode); w16(804, packing); w32(808, off); w32(812, eol)
  for (let y = 0; y < height; y++) {
    const ro = off + y * (rowBytes + eol)
    const vals = []; for (let x = 0; x < width; x++) for (let c = 0; c < n; c++) vals.push(fn(x, y, c))
    if (bits === 8) vals.forEach((v, i) => (buf[ro + i] = v))
    else if (bits === 16) vals.forEach((v, i) => w16(ro + i * 2, v))
    else if (bits === 12) vals.forEach((v, i) => w16(ro + i * 2, packing === 1 ? v << 4 : v))
    else for (let i = 0, wi = 0; i < vals.length; wi++) {
      let w = 0; const sh = packing === 1 ? [22, 12, 2] : [20, 10, 0]
      for (let k = 0; k < 3 && i < vals.length; k++, i++) w |= vals[i] << sh[k]
      w32(ro + wi * 4, w >>> 0)
    }
  }
  return buf
}
