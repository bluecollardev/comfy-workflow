import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as panama from '../src/panama.js'
import * as settings from '../src/settings.js'

// The bucket, region and profile are ordinary settings with built-in defaults (ADR-021): prefilled, and a value equal to its default is not stored.
const KEYS = ['PANAMA_S3_BUCKET', 'PANAMA_S3_REGION', 'PANAMA_S3_PROFILE']
describe('Panama bucket settings', () => {
  let file = ''
  beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'ps-')), '.env'); process.env.SETTINGS_ENV_FILE = file; for (const k of KEYS) delete process.env[k] })
  afterEach(() => { delete process.env.SETTINGS_ENV_FILE; for (const k of KEYS) delete process.env[k] })

  it('reports the built-in defaults, and the commands use them', () => {
    const g = settings.get()
    expect(g).toMatchObject({ panama_bucket: 'bh-panama-exchange-610140802195', panama_region: 'us-west-2', panama_profile: 'panama' })
    expect(g.panama_defaults).toEqual({ bucket: 'bh-panama-exchange-610140802195', region: 'us-west-2', profile: 'panama' })
    expect(panama.bucket()).toBe('bh-panama-exchange-610140802195')
  })
  it('stores an override, which the commands then use, and drops it when set back to the default or emptied', () => {
    settings.set({ panama_bucket: 'my-other-bucket', panama_region: 'eu-west-1' })
    expect(settings.get()).toMatchObject({ panama_bucket: 'my-other-bucket', panama_region: 'eu-west-1', panama_profile: 'panama' })
    expect(panama.bucket()).toBe('my-other-bucket'); expect(panama.region()).toBe('eu-west-1')
    expect(readFileSync(file, 'utf8')).toContain('PANAMA_S3_BUCKET=my-other-bucket')
    settings.set({ panama_bucket: 'bh-panama-exchange-610140802195', panama_region: '' })   // the default; empty
    expect(settings.get()).toMatchObject({ panama_bucket: 'bh-panama-exchange-610140802195', panama_region: 'us-west-2' })
    expect(panama.bucket()).toBe('bh-panama-exchange-610140802195')
    expect(readFileSync(file, 'utf8')).not.toMatch(/PANAMA_S3_BUCKET=.+/)
  })
  it('refuses a value that cannot be a bucket, a region or a profile', () => {
    expect(() => settings.set({ panama_bucket: 'Has Spaces' })).toThrow(/bucket name/)
    expect(() => settings.set({ panama_bucket: 'UPPER' })).toThrow(/bucket name/)
    expect(() => settings.set({ panama_region: 'nowhere' })).toThrow(/region/)
    expect(() => settings.set({ panama_profile: 'a b' })).toThrow(/profile/)
  })
})
