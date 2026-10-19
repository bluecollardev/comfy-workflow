import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as g from '../src/governance.js'
import { REPO_ROOT } from '../src/paths.js'
import { scratch } from './helpers.js'

beforeEach(() => { scratch() })

describe('governance', () => {
  it('finds the folder and its pages', () => {
    expect(g.folder()).toBe(join(REPO_ROOT, 'shared', 'governance'))
    const names = new Set(Object.keys(g.pages()))
    for (const n of ['README.md', 'operator-brief.md', 'policy/agent-permissions.md', 'workflow/workflow-rules.md']) expect(names.has(n)).toBe(true)
    expect(names.has('MANIFEST.md')).toBe(false); expect(names.size).toBeGreaterThanOrEqual(36)
    expect(g.syncedOn().startsWith('20')).toBe(true)
  })

  it('instructions carry the lead pages verbatim', () => {
    const text = g.instructions()
    expect(text).toContain('Needs a named yes: any download or install, any spend')
    expect(text).toContain('You do not write, edit or install code of any kind.')
    expect(text).toContain('USD 100'); expect(text).toContain('governance://')
  })

  it('lists, reads and gates spend', () => {
    const uris = new Set(g.listing().map((p) => p.uri))
    expect(uris.has('governance://policy/agent-permissions.md')).toBe(true)
    expect(g.read(g.uriToName('governance://operator-brief.md'))).toContain('operator, not a builder')
    expect(g.read('nope.md')).toBeNull()
    expect(g.namedYes({ agent_name: 'x' }, 'create_agent')).toMatch(/approved_by/)
    expect(g.namedYes({ approved_by: 'Binc' }, 'create_agent')).toBeNull()
    expect(g.namedYes({ approved_by: '   ' }, 'create_agent')).toBeTruthy()
    expect(g.summary().spend_cap_usd).toBe(100)
  })
})
