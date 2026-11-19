import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as configio from '../src/configio.js'
import * as publish from '../src/publish.js'
import * as settings from '../src/settings.js'
import { scratch } from './helpers.js'

// The publishing settings travel in the configuration file; the S3 keys and the Slack webhook never do (only their names, as `needs`).
const HOOK = 'https://hooks.slack.com/services/T000/B000/SECRETWEBHOOKVALUE', KEYID = 'AKIAEXAMPLEKEY1234', KEYSECRET = 'secretsecretsecret1234'
let dir: string
beforeEach(async () => {
  dir = scratch(); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.PUBLISH_SLACK_HOST_ALLOW = 'hooks.slack.com'; for (const k of settings.PUBLISH_SECRETS) delete process.env[k]
  publish.reset()
  await publish.setSettings({ s3: { credentials: 'app', bucket: 'my-bucket', prefix: 'returns/BKK/', region: 'us-west-2', access_key_id: KEYID, secret_access_key: KEYSECRET }, slack: { webhook_url: HOOK, channel: '#returns', per_shot: true, file_link_count: 4 }, defaults: { targets: ['s3'] } })
})

describe('publishing settings in the configuration file', () => {
  it('the export carries publish (non-secret) and needs (names only); a scan of the file finds no webhook and no key value', () => {
    for (const includeSecrets of [true, false]) {
      const f = configio.exportConfig({ includeSecrets }), text = JSON.stringify(f)
      expect(f.publish).toMatchObject({ s3: { bucket: 'my-bucket', prefix: 'returns/BKK/', region: 'us-west-2' }, slack: { channel: '#returns', per_shot: true, file_link_count: 4 }, defaults: { targets: ['s3'] } }); expect(f.needs).toEqual(['Slack webhook', 'S3 keys'])
      for (const secret of ['hooks.slack.com', 'SECRETWEBHOOKVALUE', KEYID, KEYSECRET]) expect(text).not.toContain(secret)
    }
  })
  it('the import plan shows a publish section and needs (what this machine has unset); apply writes the settings and leaves the keys and webhook alone; undo restores; a bad value is a 400 naming the field; an old file without publish imports fine', async () => {
    const f = configio.exportConfig({ includeSecrets: false }); await publish.setSettings({ s3: { bucket: 'other', prefix: 'x/' }, slack: { channel: '#other' } })
    let plan = configio.planImport(f); expect(plan.sections.find((s) => s.key === 'publish')).toMatchObject({ changed: true, error: null }); expect(plan.needs).toEqual([])   // both are still set here
    configio.applyImport(f, { sections: ['publish'] }); const after = JSON.parse(readFileSync(join(dir, 'publish.json'), 'utf8')); expect(after.s3.bucket).toBe('my-bucket'); expect(after.slack.channel).toBe('#returns')
    expect(settings.lookup('PUBLISH_SLACK_WEBHOOK_URL')).toBe(HOOK); expect(settings.lookup('PUBLISH_S3_SECRET_ACCESS_KEY')).toBe(KEYSECRET)
    const backups = readdirSync(join(dir, 'backups')).map((n) => readFileSync(join(dir, 'backups', n), 'utf8')).join('\n'); for (const secret of ['hooks.slack.com', 'SECRETWEBHOOKVALUE', KEYSECRET]) expect(backups).not.toContain(secret)
    configio.undoImport(); expect(JSON.parse(readFileSync(join(dir, 'publish.json'), 'utf8')).s3.bucket).toBe('other')
    // a machine with nothing set: needs names them; an import never sets them
    for (const k of settings.PUBLISH_SECRETS) delete process.env[k]; writeFileSync(join(dir, '.env'), '')
    plan = configio.planImport(f); expect(plan.needs).toEqual(['Slack webhook', 'S3 keys']); const res = configio.applyImport(f, { sections: ['publish'] }); expect(res.needs).toEqual(['Slack webhook', 'S3 keys']); expect(settings.lookup('PUBLISH_SLACK_WEBHOOK_URL')).toBe('')
    const bad = { ...f, publish: { s3: { presign_hours: 999 } } }; const bp = configio.planImport(bad); expect(bp.sections.find((s) => s.key === 'publish')!.error).toMatch(/publish\.s3\.presign_hours/); expect(() => configio.applyImport(bad, { sections: ['publish'] })).toThrow(/presign_hours/)
    const old = { ...f } as Record<string, unknown>; delete old.publish; delete old.needs; const op = configio.planImport(old); expect(op.sections.some((s) => s.key === 'publish')).toBe(false); expect(op.needs).toBeUndefined(); expect(op.ok).toBe(true)
  })
})
