const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { createAppLog, redact } = require('./app-log.cjs')

const mk = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'applog-')), t = { now: new Date('2026-11-20T15:48:12.345Z') }; return { dir, t, log: createAppLog({ dir: path.join(dir, 'app-logs'), now: () => t.now }) } }
const read = (dir, day = '2026-11-20') => fs.readFileSync(path.join(dir, 'app-logs', `${day}.log`), 'utf8')

test('a line is the time, the level and the text, in the file of its day; a new day is a new file', () => {
  const { dir, t, log } = mk(); log.write('error', 'idle watch: boom'); log.write('info', 'two\nlines'); t.now = new Date('2026-11-21T00:00:01Z'); log.write('warn', 'next day')
  assert.equal(read(dir), '2026-11-20T15:48:12.345Z ERROR idle watch: boom\n2026-11-20T15:48:12.345Z INFO two\n  lines\n')
  assert.match(read(dir, '2026-11-21'), /WARN next day/)
})
test('secrets never reach the file: keys, bearer tokens, a signed link, a webhook', () => {
  const { dir, log } = mk()
  log.write('error', 'fetch failed Authorization: Bearer abcdefghijklmnop1234 and api_key=rpa_ABCDEFGHIJKLMNOP1234 AKIAABCDEFGHIJKLMNOP https://x/y?X-Amz-Signature=deadbeef&X-Amz-Credential=cred https://hooks.slack.com/services/T000/B000/XXXXXXXX')
  const s = read(dir); for (const bad of ['abcdefghijklmnop1234', 'ABCDEFGHIJKLMNOP1234', 'AKIAABCDEFGHIJKLMNOP', 'deadbeef', 'XXXXXXXX', 'cred']) assert.ok(!s.includes(bad), bad)
  assert.match(s, /fetch failed/); assert.equal(redact('nothing secret here'), 'nothing secret here')
})
test('install tees the console (it still prints), logs unhandled errors, and a runaway line is cut', () => {
  const { dir, log } = mk(), printed = [], con = { log: (...a) => printed.push(a), info: (...a) => printed.push(a), warn: (...a) => printed.push(a), error: (...a) => printed.push(a) }, proc = Object.assign(new EventEmitter(), { pid: 7, versions: { node: '22', electron: '44' } })
  log.install(proc, con); con.error('mcp host:', new Error('port in use')); con.log({ a: 1 }); proc.emit('unhandledRejection', new Error('nope')); con.warn('x'.repeat(9000))
  assert.equal(printed.length, 3)
  const s = read(dir); assert.match(s, /app log started \(pid 7/); assert.match(s, /ERROR mcp host: Error: port in use/); assert.match(s, /INFO \{"a":1\}/); assert.match(s, /ERROR unhandled rejection: Error: nope/)
  assert.ok(s.split('\n').every((l) => l.length < 4100))
})
test('the window: warnings and errors of the page, a gone renderer, a failed load; plain logs are not kept', () => {
  const { dir, log } = mk(), wc = new EventEmitter(); log.watchWindow(wc)
  wc.emit('console-message', { level: 'info', message: 'chatty', lineNumber: 1, sourceId: 'file:///x/app.js' }); wc.emit('console-message', { level: 'warning', message: 'deprecated', lineNumber: 3, sourceId: 'file:///x/app.js' }); wc.emit('console-message', { level: 'error', message: 'TypeError: x', lineNumber: 9, sourceId: 'file:///x/app.js' })
  wc.emit('console-message', {}, 3, 'old style', 4, 'file:///y/b.js')   // the older signature
  wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 }); wc.emit('did-fail-load', {}, -102, 'CONNECTION_REFUSED', 'http://localhost:5173/?token=abc'); wc.emit('unresponsive')
  const s = read(dir); assert.ok(!s.includes('chatty')); assert.match(s, /WARN page app.js:3 deprecated/); assert.match(s, /ERROR page app.js:9 TypeError: x/); assert.match(s, /ERROR page b.js:4 old style/)
  assert.match(s, /the page process is gone: crashed \(exit 133\)/); assert.match(s, /failed to load: CONNECTION_REFUSED \(-102\) http:\/\/localhost:5173\//); assert.ok(!s.includes('token=abc')); assert.match(s, /stopped responding/)
})
test('a broken folder never throws', () => { const log = createAppLog({ dir: '/proc/nope/never', now: () => new Date() }); assert.doesNotThrow(() => log.write('error', 'x')) })
