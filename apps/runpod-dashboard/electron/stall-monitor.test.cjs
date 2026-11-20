const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createStallMonitor } = require('./stall-monitor.cjs')

function rig(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-'))
  const file = path.join(dir, 'stalls.log')
  let t = 1_000_000
  let cb = null
  const mon = createStallMonitor({ file, now: () => t, setIntervalFn: (f) => { cb = f; return { unref() {} } }, clearIntervalFn: () => { cb = null }, ...opts })
  return { mon, file, advance: (ms) => { t += ms }, fire: () => cb(), lines: () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []) }
}

test('a normal tick writes nothing', () => {
  const r = rig(); r.mon.start()
  r.advance(100); r.fire(); r.advance(150); r.fire()
  assert.equal(r.lines().length, 0)
})

test('a late tick logs lag, the calls and the ticks of the last 2 s, names and durations only', () => {
  const r = rig(); r.mon.start()
  r.mon.call('panama.rounds', () => r.advance(150))
  r.mon.tick('queue.tick', () => r.advance(10))
  r.advance(900); r.fire()
  const [l] = r.lines()
  assert.equal(l.kind, 'stall')
  assert.ok(l.lag_ms >= 900 && l.lag_ms < 1200, String(l.lag_ms))
  assert.deepEqual(l.calls.map((c) => [c.name, c.ms]), [['panama.rounds', 150]])
  assert.deepEqual(l.ticks.map((c) => c.name), ['queue.tick'])
  assert.deepEqual(Object.keys(l.calls[0]).sort(), ['ago_ms', 'ms', 'name'])
})

test('calls older than 2 s are not listed', () => {
  const r = rig(); r.mon.start()
  r.mon.call('old.call', () => r.advance(5))
  r.advance(2500); r.fire()
  assert.deepEqual(r.lines()[0].calls, [])
})

test('a call that blocks over 200 ms is logged by name; a quick one is not', () => {
  const r = rig()
  r.mon.call('a.quick', () => r.advance(50))
  r.mon.call('b.slow', () => r.advance(250))
  r.mon.tick('c.slowtick', () => r.advance(400))
  assert.deepEqual(r.lines().map((l) => [l.kind, l.name, l.ms]), [['slow_call', 'b.slow', 250], ['slow_tick', 'c.slowtick', 400]])
})

test('call returns the value (and the promise) and rethrows', async () => {
  const r = rig()
  assert.equal(r.mon.call('x.y', () => 5), 5)
  assert.equal(await r.mon.call('x.z', async () => 7), 7)
  assert.throws(() => r.mon.call('x.t', () => { throw new Error('boom') }), /boom/)
})

test('names that are not a plain identifier are not written (no arguments leak)', () => {
  const r = rig()
  r.mon.call('secret key=AKIA123 /Users/me/file', () => r.advance(500))
  assert.equal(r.lines()[0].name, 'unnamed')
  assert.doesNotMatch(JSON.stringify(r.lines()), /AKIA|Users/)
})

test('the file keeps the newest lines', () => {
  const r = rig({ maxLines: 50 })
  for (let i = 0; i < 400; i++) r.mon.call(`n.${i}`, () => r.advance(300))
  const ls = r.lines()
  assert.ok(ls.length <= 60 && ls.length >= 50, String(ls.length))
  assert.equal(ls[ls.length - 1].name, 'n.399')
})

test('never throws when the log cannot be written', () => {
  const r = rig({ file: '/dev/null/nope/stalls.log' })
  r.mon.start()
  assert.doesNotThrow(() => { r.mon.call('a.b', () => r.advance(500)); r.advance(1000); r.fire() })
  assert.deepEqual(r.mon.last(), [])
})

test('last() returns the newest first', () => {
  const r = rig()
  r.mon.call('first.one', () => r.advance(300)); r.mon.call('second.one', () => r.advance(300))
  assert.deepEqual(r.mon.last(5).map((l) => l.name), ['second.one', 'first.one'])
})

test('real timers: a blocked loop is noticed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-real-'))
  const file = path.join(dir, 'stalls.log')
  const mon = createStallMonitor({ file })
  mon.start()
  await new Promise((r) => setTimeout(r, 150))
  mon.call('busy.loop', () => { const e = Date.now() + 500; while (Date.now() < e); })
  await new Promise((r) => setTimeout(r, 250))
  mon.stop()
  const ls = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  assert.ok(ls.some((l) => l.kind === 'stall' && l.lag_ms >= 300 && l.calls.some((c) => c.name === 'busy.loop')), JSON.stringify(ls))
  assert.ok(ls.some((l) => l.kind === 'slow_call' && l.name === 'busy.loop'))
})
