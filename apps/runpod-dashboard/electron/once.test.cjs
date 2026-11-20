const test = require('node:test'), assert = require('node:assert/strict')
const { once } = require('./once.cjs')
test('once runs the function the first time only, and keeps its result', () => {
  let n = 0; const f = once((x) => { n++; return x * 2 })
  assert.equal(f(4), 8); assert.equal(f(5), 8); assert.equal(f(), 8); assert.equal(n, 1)
})
test('a second boot after the window was closed registers nothing again', () => {
  const calls = []; const setup = once(() => { calls.push('protocols', 'ipc', 'timers') })
  const boot = () => { setup(); calls.push('window') }
  boot(); boot()   // the Dock icon clicked after the window was closed
  assert.deepEqual(calls, ['protocols', 'ipc', 'timers', 'window', 'window'])
})
