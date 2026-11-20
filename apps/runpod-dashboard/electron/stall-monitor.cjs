// Event-loop stall monitor for the Electron main process (docs/TROUBLESHOOTING-BEACH-BALL.md).
//
// The core runs in the main process, so any slow synchronous work freezes the window (the macOS beach ball). This module
// answers "what was running when it froze": a 100 ms timer notices when the loop was late by more than 300 ms and writes one
// JSON line to stalls.log: the time, the lag, the IPC calls and core ticks that ran in the last 2 s (namespace.function and
// duration only), and any call whose synchronous part alone blocked for more than 200 ms is logged by name too.
//
// Never throws, never records arguments or values (names are checked against a plain pattern), and costs one timer wake-up
// every 100 ms plus two clock reads around each call. The file is kept to the newest ~500 lines.
const fs = require('node:fs')
const path = require('node:path')

const NAME = /^[A-Za-z0-9_.:-]{1,80}$/
const safeName = (n) => (typeof n === 'string' && NAME.test(n) ? n : 'unnamed')

function createStallMonitor(opts = {}) {
  const {
    file,
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    intervalMs = 100,
    thresholdMs = 300,
    slowCallMs = 200,
    windowMs = 2000,
    maxLines = 500,
    fsImpl = fs,
  } = opts
  let timer = null, last = 0
  let recent = []          // { kind: 'call' | 'tick', name, ms, at } newest last; trimmed to windowMs
  let count = null         // lines in the file, counted once, then in memory

  const trimRecent = (t) => { let i = 0; while (i < recent.length && t - recent[i].at > windowMs) i++; if (i) recent = recent.slice(i); if (recent.length > 200) recent = recent.slice(-200) }

  function append(obj) {
    if (!file) return
    try {
      fsImpl.mkdirSync(path.dirname(file), { recursive: true })
      if (count === null) { try { count = fsImpl.readFileSync(file, 'utf8').split('\n').filter(Boolean).length } catch { count = 0 } }
      fsImpl.appendFileSync(file, JSON.stringify(obj) + '\n')
      count++
      if (count > maxLines * 1.2) {   // trim rarely: the newest maxLines stay
        const lines = fsImpl.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-maxLines)
        fsImpl.writeFileSync(file, lines.join('\n') + '\n')
        count = lines.length
      }
    } catch { /* the monitor never gets in the way */ }
  }

  function record(kind, name, ms, at) {
    try {
      const n = safeName(name)
      recent.push({ kind, name: n, ms, at })
      trimRecent(at)
      if (ms > slowCallMs) append({ time: new Date(at).toISOString(), kind: kind === 'tick' ? 'slow_tick' : 'slow_call', name: n, ms: Math.round(ms) })
    } catch { /* ignore */ }
  }

  /** Time the synchronous part of `fn` (up to its first await when it returns a promise), under `name`. Returns fn's result. */
  function time(kind, name, fn) {
    const t0 = now()
    try { return fn() } finally { try { const t1 = now(); record(kind, name, t1 - t0, t1) } catch { /* ignore */ } }
  }
  const call = (name, fn) => time('call', name, fn)
  const tick = (name, fn) => time('tick', name, fn)
  /** For code that cannot be wrapped: `const end = begin('x'); ...; end()`. */
  function begin(kind, name) { const t0 = now(); return () => { try { const t1 = now(); record(kind, name, t1 - t0, t1) } catch { /* ignore */ } } }

  function check() {
    try {
      const t = now()
      const lag = t - last - intervalMs
      last = t
      if (lag <= thresholdMs) return
      trimRecent(t)
      const pick = (kind) => recent.filter((r) => r.kind === kind).map((r) => ({ name: r.name, ms: Math.round(r.ms), ago_ms: Math.round(t - r.at) }))
      append({ time: new Date(t).toISOString(), kind: 'stall', lag_ms: Math.round(lag), calls: pick('call'), ticks: pick('tick') })
    } catch { /* ignore */ }
  }

  function start() {
    if (timer) return
    last = now()
    timer = setIntervalFn(check, intervalMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }
  function stop() { if (timer) { clearIntervalFn(timer); timer = null } }

  /** The newest `n` lines of the log, newest first (what a diagnostics view shows). */
  function last_(n = 50) {
    try {
      const lines = fsImpl.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      const out = []
      for (const l of lines.slice(-Math.max(1, Math.min(n, maxLines))).reverse()) { try { out.push(JSON.parse(l)) } catch { /* torn line */ } }
      return out
    } catch { return [] }
  }

  return { start, stop, check, call, tick, begin, last: last_, file }
}

module.exports = { createStallMonitor }
