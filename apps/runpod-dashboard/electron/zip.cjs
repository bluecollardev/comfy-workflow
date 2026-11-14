// A small streaming ZIP writer (stored, no compression: outputs are already PNG/MP4/MOV) for "Download all as a zip": each file is fetched and written straight to the zip on disk,
// so a few hundred MB of video never sits in memory. Data descriptors carry each file's size and CRC32 after its bytes. Plain ZIP (no ZIP64): a total over 4 GB is refused with a message.
const fs = require('node:fs')
const zlib = require('node:zlib')

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (buf, prev = 0) => {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf, prev)
  let c = ~prev >>> 0
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}
const dosTime = (d) => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() })
const LIMIT = 0xffffffff

/** The name inside the zip: forward slashes, no leading slash or "..", and a number added when two entries would share a name. */
function safeNames(entries) {
  const seen = new Set()
  return entries.map((e) => {
    let n = String(e.name || 'file').replace(/\\/g, '/').split('/').filter((p) => p && p !== '.' && p !== '..').join('/') || 'file'
    if (seen.has(n)) { const i = n.lastIndexOf('.'); const base = i > 0 ? n.slice(0, i) : n, ext = i > 0 ? n.slice(i) : ''; let k = 2; while (seen.has(`${base} (${k})${ext}`)) k++; n = `${base} (${k})${ext}` }
    seen.add(n); return n
  })
}

/** Write `entries` ([{ url, name }]) to `dest`. `fetchFn` is fetch (replaced in tests). Returns { files, bytes }. Deletes a partly written zip on any failure. */
async function writeZip(entries, dest, { fetchFn = fetch, onFile } = {}) {
  const out = fs.createWriteStream(dest)
  let failure = null
  const done = new Promise((res, rej) => { out.on('finish', res); out.on('error', (e) => { failure = e; rej(e) }) })
  done.catch(() => {})   // a failure is thrown by the next write or by awaiting done below
  const write = (buf) => new Promise((res, rej) => { if (failure) return rej(failure); if (out.write(buf)) res(); else out.once('drain', res) })
  let offset = 0, total = 0
  const central = []
  const now = dosTime(new Date())
  const names = safeNames(entries)
  try {
    for (let i = 0; i < entries.length; i++) {
      const name = Buffer.from(names[i], 'utf8')
      const res = await fetchFn(entries[i].url)
      if (!res.ok || !res.body) throw new Error(`The pod answered HTTP ${res.status} for ${names[i]}.`)
      const local = Buffer.alloc(30)
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0808, 6); local.writeUInt16LE(0, 8)   // bit 3: sizes follow the data; bit 11: UTF-8 names
      local.writeUInt16LE(now.time, 10); local.writeUInt16LE(now.date, 12); local.writeUInt16LE(name.length, 26)
      const headerAt = offset
      await write(local); await write(name); offset += 30 + name.length
      let crc = 0, size = 0
      for await (const chunk of res.body) {
        const b = Buffer.from(chunk)
        crc = crc32(b, crc); size += b.length; offset += b.length
        if (offset > LIMIT) throw new Error('Together these files are over 4 GB, more than a zip can hold here: download them one by one.')
        await write(b)
      }
      const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc >>> 0, 4); dd.writeUInt32LE(size, 8); dd.writeUInt32LE(size, 12)
      await write(dd); offset += 16; total += size
      central.push({ name, crc: crc >>> 0, size, headerAt })
      if (onFile) onFile(i + 1, entries.length)
    }
    const cdStart = offset
    for (const c of central) {
      const h = Buffer.alloc(46)
      h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(0, 10)
      h.writeUInt16LE(now.time, 12); h.writeUInt16LE(now.date, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.size, 20); h.writeUInt32LE(c.size, 24); h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE(c.headerAt, 42)
      await write(h); await write(c.name); offset += 46 + c.name.length
    }
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10); end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16)
    await write(end)
    out.end(); await done
    return { files: central.length, bytes: total }
  } catch (e) {
    out.destroy(); await fs.promises.rm(dest, { force: true }).catch(() => {})
    throw e
  }
}

module.exports = { writeZip, crc32, safeNames }
