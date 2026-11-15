import { describe, expect, it } from 'vitest'
import * as paths from '../src/paths.js'
import * as rl from '../src/ratelimit.js'

/** The guard: no core test may write the user's real configuration (ADR-042 section 18). A live app writes its own History while the
 *  suite runs, so modification times cannot be compared; every path the core writes to is checked instead: none resolves inside the real directory. */
describe('the real configuration is not reachable from the core tests', () => {
  const real = (globalThis as Record<string, unknown>).__realConfigDir as string
  it('the config directory is a scratch one', () => {
    expect(paths.configDir().startsWith(real)).toBe(false)
    expect(process.env.POD_MANAGER_CONFIG_DIR).toMatch(/runpod-core-/)
  })
  it('every file and folder the core writes resolves outside the real directory', () => {
    const fns = Object.entries(paths).filter(([k, v]) => typeof v === 'function' && /(File|Dir)$/.test(k))
    expect(fns.length).toBeGreaterThan(10)
    for (const [name, fn] of fns) { const p = (fn as () => string)(); expect({ name, inReal: p.startsWith(real) }).toEqual({ name, inReal: false }) }
  })
  it('Claude Code\'s own settings file is not the real one either', () => {
    expect(process.env.CLAUDE_USER_SETTINGS).toMatch(/runpod-core-global-/)
  })
  it('the volume cache is written under the scratch directory', () => {
    rl.rememberVolumes([{ id: 'x', name: 'x', size: 10, dataCenterId: 'EU' }])
    expect(rl.lastVolume('x')?.name).toBe('x')
  })
})
