import { test } from 'node:test'
import assert from 'node:assert/strict'
import { triggerInfo } from './trigger.js'

test('triggerInfo: window is manual, mcp is MCP with its client, auto-publish is auto, backfill; external is a flag; older jobs are manual', () => {
  assert.deepEqual(triggerInfo({ trigger: 'window' }), { label: 'manual', key: 'manual', title: '', external: false })
  assert.deepEqual(triggerInfo({ trigger: 'mcp', mcp_client: 'claude-code', external: true }), { label: 'MCP', key: 'mcp', title: 'MCP: claude-code', external: true })
  assert.equal(triggerInfo({ trigger: 'auto-publish' }).label, 'auto'); assert.equal(triggerInfo({ trigger: 'backfill' }).label, 'backfill')
  for (const j of [undefined, {}, { trigger: 'whatever' }]) assert.equal(triggerInfo(j).label, 'manual')
})
