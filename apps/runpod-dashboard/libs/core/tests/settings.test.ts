import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as settings from '../src/settings.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); delete process.env.RUNPOD_API_KEY })

describe('settings', () => {
  it('stores the RunPod key in the .env the shell reads, shows only a hint, and puts it in the environment', () => {
    expect(settings.get()).toMatchObject({ runpod_api_key_set: false, runpod_api_key_hint: '', source: 'none' })
    writeFileSync(join(dir, '.env'), 'GITHUB_CLIENT_ID=abc\n# keep me\n')
    const r = settings.set({ runpod_api_key: 'rpa_0123456789ABCDEFXYZ1' })
    expect(r).toMatchObject({ runpod_api_key_set: true, runpod_api_key_hint: '••••XYZ1' })
    expect(process.env.RUNPOD_API_KEY).toBe('rpa_0123456789ABCDEFXYZ1')
    const text = readFileSync(join(dir, '.env'), 'utf8')
    expect(text).toContain('GITHUB_CLIENT_ID=abc'); expect(text).toContain('# keep me'); expect(text).toContain('RUNPOD_API_KEY=rpa_0123456789ABCDEFXYZ1')
    settings.set({ runpod_api_key: 'rpa_NEWKEY9876543210' })   // replaced in place, not appended twice
    expect(readFileSync(join(dir, '.env'), 'utf8').match(/RUNPOD_API_KEY=/g)?.length).toBe(1)
    expect(settings.set({ runpod_api_key: '' }).runpod_api_key_hint).toBe('••••3210')   // empty leaves it alone
    expect(() => settings.set({ runpod_api_key: 'short' })).toThrow(/does not look like/)
    expect(settings.set({ runpod_api_key: null }).runpod_api_key_set).toBe(false)
    expect(process.env.RUNPOD_API_KEY).toBeUndefined()
  })

  it('stores the optional Anthropic key like the others: hint only, in the .env, in the environment, removable', () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(settings.get()).toMatchObject({ anthropic_key_set: false, anthropic_key_hint: '' })
    expect(() => settings.set({ anthropic_api_key: 'short' })).toThrow(/does not look like an Anthropic/)
    const r = settings.set({ anthropic_api_key: 'sk-ant-api03-0123456789ABCDWXYZ' })
    expect(r).toMatchObject({ anthropic_key_set: true, anthropic_key_hint: '••••WXYZ' })
    expect(JSON.stringify(r)).not.toContain('0123456789')
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-api03-0123456789ABCDWXYZ')
    expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('ANTHROPIC_API_KEY=sk-ant-api03-0123456789ABCDWXYZ')
    expect(settings.set({ anthropic_api_key: '' }).anthropic_key_set).toBe(true)   // empty leaves it alone
    expect(settings.set({ anthropic_api_key: null }).anthropic_key_set).toBe(false)
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})
