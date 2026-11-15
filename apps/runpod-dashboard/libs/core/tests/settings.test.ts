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

  it('stores the Hugging Face token like the other keys: hint only, in the .env, in the environment, removable, no spaces', () => {
    delete process.env.HF_TOKEN
    expect(settings.get()).toMatchObject({ hf_token_set: false, hf_token_hint: '' })
    expect(() => settings.set({ hf_token: 'short' })).toThrow(/does not look like a Hugging Face token/)
    expect(() => settings.set({ hf_token: 'hf_has a space_1234' })).toThrow(/does not look like/)
    const r = settings.set({ hf_token: 'hf_ABCDEFGHIJKLMNOP1234' })
    expect(r).toMatchObject({ hf_token_set: true, hf_token_hint: '••••1234' }); expect(JSON.stringify(r)).not.toContain('ABCDEFGHIJKLMNOP')
    expect(process.env.HF_TOKEN).toBe('hf_ABCDEFGHIJKLMNOP1234'); expect(readFileSync(join(dir, '.env'), 'utf8')).toContain('HF_TOKEN=hf_ABCDEFGHIJKLMNOP1234')
    expect(settings.checkSecret('HF_TOKEN', 'hf_ABCDEFGHIJKLMNOP1234')).toBeNull(); expect(settings.secretValues().HF_TOKEN).toBe('hf_ABCDEFGHIJKLMNOP1234')
    expect(settings.set({ hf_token: null }).hf_token_set).toBe(false); expect(process.env.HF_TOKEN).toBeUndefined()
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

  it('checks the Anthropic key with one cheap call, and reports what Anthropic said', async () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(await settings.checkAnthropic()).toEqual({ ok: false, error: 'No Anthropic API key is set' })
    settings.set({ anthropic_api_key: 'sk-ant-api03-0123456789ABCDWXYZ' })
    let seen: { url: string; key: string } | null = null
    const good = (async (url: string, init: { headers: Record<string, string> }) => { seen = { url, key: init.headers['x-api-key'] }; return { ok: true, status: 200, json: async () => ({}) } }) as unknown as typeof fetch
    expect(await settings.checkAnthropic(null, good)).toEqual({ ok: true })
    expect(seen).toEqual({ url: 'https://api.anthropic.com/v1/models?limit=1', key: 'sk-ant-api03-0123456789ABCDWXYZ' })
    const bad = (async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) })) as unknown as typeof fetch
    expect(await settings.checkAnthropic(null, bad)).toEqual({ ok: false, error: 'Anthropic answered 401: invalid x-api-key' })
    const down = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    expect((await settings.checkAnthropic(null, down)).error).toMatch(/Could not reach Anthropic: ECONNREFUSED/)
    // a typed key is tested without being stored
    expect(await settings.checkAnthropic('sk-ant-api03-TYPEDTYPEDTYPEDTYPED', good)).toEqual({ ok: true })
    expect(seen!.key).toBe('sk-ant-api03-TYPEDTYPEDTYPEDTYPED')
    expect(settings.get().anthropic_key_hint).toBe('••••WXYZ')   // the stored one is untouched
    expect((await settings.checkAnthropic('sk-ant-…', good)).error).toMatch(/does not look like/)   // the placeholder from earlier never reaches Anthropic
    process.env.ANTHROPIC_API_URL = 'http://127.0.0.1:9/'
    await settings.checkAnthropic(null, good)
    expect(seen!.url).toBe('http://127.0.0.1:9/v1/models?limit=1')   // the stand-in URL, for tests
    delete process.env.ANTHROPIC_API_URL
    settings.set({ anthropic_api_key: null })
  })
})

describe('the agent rules (system-wide, ADR-042)', () => {
  it('are off with no ceiling by default, stored in the settings file, shown by get(), and cleared with off or 0', () => {
    expect(settings.agentRules()).toEqual({ require_named_yes: false, spend_cap_usd: 0, shell_guard: false })
    expect(settings.get()).toMatchObject({ agent_named_yes_required: false, agent_spend_cap_usd: 0 })
    settings.set({ agent_named_yes_required: true, agent_spend_cap_usd: 25.5 })
    expect(settings.agentRules()).toEqual({ require_named_yes: true, spend_cap_usd: 25.5, shell_guard: false })
    expect(readFileSync(join(dir, '.env'), 'utf8')).toMatch(/AGENT_REQUIRE_NAMED_YES=1/)
    expect(settings.get()).toMatchObject({ agent_named_yes_required: true, agent_spend_cap_usd: 25.5 })
    settings.set({ agent_named_yes_required: false, agent_spend_cap_usd: null })
    expect(settings.agentRules()).toEqual({ require_named_yes: false, spend_cap_usd: 0, shell_guard: false })
  })
  it('refuse a negative or non-numeric ceiling and a non-boolean switch', () => {
    expect(() => settings.set({ agent_spend_cap_usd: -1 })).toThrow(/dollars/)
    expect(() => settings.set({ agent_named_yes_required: 'yes' as never })).toThrow(/true or false/)
    expect(settings.checkAgentRules({ require_named_yes: 'x', spend_cap_usd: 1 })).toMatch(/true or false/)
  })
})

