import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as ui2api from '../src/ui2api.js'

const REPO_PY = join(__dirname, '..', '..', '..', '..', 'comfy-app', 'docker', 'ui2api.py')
describe('the converter script the pod runs', () => {
  it('is a copy of the repo script (docker/ui2api.py): edit one, edit both', () => {
    expect(ui2api.UI2API_PY).toBe(readFileSync(REPO_PY, 'utf8'))
  })
  it("waits four minutes for ComfyUI's page, never sixty seconds", () => {
    expect(ui2api.UI2API_PY).not.toMatch(/timeout=60000/)
    expect(ui2api.UI2API_PY).toMatch(/UI2API_TIMEOUT_MS", "240000"/)
  })
  it('the pod script writes exactly that script and the graph to temp files and runs python3 on them with the 240 s timeout in its environment', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ui2api-'))
    const fake = join(dir, 'python3')   // a stand-in python3 that reports what it was given instead of starting a browser
    writeFileSync(fake, '#!/bin/sh\necho "TIMEOUT=$UI2API_TIMEOUT_MS"\necho "BROWSERS=$PLAYWRIGHT_BROWSERS_PATH"\ncat "$1"\necho "---GRAPH---"\ncat "$2"\n'); chmodSync(fake, 0o755)
    const out = execFileSync('bash', ['-c', ui2api.podScript({ nodes: [{ id: 1 }], links: [] })], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' })
    expect(out).toContain('TIMEOUT=240000'); expect(out).toContain('BROWSERS=/opt/playwright')
    const i = out.indexOf('---GRAPH---\n'); expect(i).toBeGreaterThan(0)
    const src = out.slice(out.indexOf('#!/usr/bin/env python3'), i), graph = out.slice(i + '---GRAPH---\n'.length)
    expect(src.trim()).toBe(ui2api.UI2API_PY.trim())
    expect(JSON.parse(Buffer.from(graph.replace(/\s+/g, ''), 'base64').toString())).toEqual({ nodes: [{ id: 1 }], links: [] })
  }, 30_000)   // it spawns bash and a stand-in python3 synchronously: 40 to 320 ms alone, but a loaded machine stalled it past the 5 s default once in a full run
})
