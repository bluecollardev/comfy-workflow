/**
 * UI graph -> API graph with ComfyUI's own frontend (ADR-037). The Workflows panel holds UI graphs; ComfyUI queues only API graphs. The frontend converts them itself
 * (`app.graphToPrompt()`), muted and bypassed nodes, reroutes and primitives included, exactly as its Run button does. Two ways to reach a frontend:
 *   - on the pod: a headless Chromium on the pod opens http://127.0.0.1:8188 (docker/ui2api.py, in the image since ADR-037's tag); nothing here depends on this PC;
 *   - on this PC: Chrome (headless, through playwright-core) opens the pod's own page.
 * Both run the same two steps in the page: load the graph, then graphToPrompt. Neither queues anything.
 */
import { CoreError } from './errors.js'

/** The page-side function, as source, so both converters (and the tests) run the same code. */
export const PAGE_CONVERT = `async (graph) => {
  await window.app.loadGraphData(graph, true, false, 'ui2api')
  const p = await window.app.graphToPrompt()
  return p.output
}`
export const PAGE_READY = 'window.app && window.app.graph && window.app.canvas'

export type Converter = (graph: unknown) => Promise<Record<string, unknown>>

/** This PC's way: headless Chrome against the pod's page. `base` is the pod's ComfyUI URL (its RunPod proxy). */
export function browserConverter(base: string, opts: { timeoutMs?: number } = {}): Converter {
  return async (graph) => {
    let chromium: { launch: (o: object) => Promise<{ newPage: () => Promise<any>; close: () => Promise<void> }> }
    try { chromium = ((await import('playwright-core')) as any).chromium } catch { throw new CoreError(501, 'Converting here needs playwright-core and Chrome on this PC (npm install), or a pod image with ui2api (ADR-037).') }
    const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch((e: Error) => { throw new CoreError(501, `Could not start Chrome to convert the graph: ${e.message}`) })
    try {
      const page = await browser.newPage()
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 60_000 })
      await page.waitForFunction(PAGE_READY, undefined, { timeout: opts.timeoutMs ?? 60_000 })
      const out = await page.evaluate(`(${PAGE_CONVERT})(${JSON.stringify(graph)})`)
      if (!out || typeof out !== 'object') throw new CoreError(502, 'The ComfyUI page returned no API graph.')
      return out as Record<string, unknown>
    } finally { await browser.close().catch(() => {}) }
  }
}

/** The pod's way: a script on the pod runs the same page code in the pod's own Chromium. It prints `UI2API-RESULT<TAB><base64 json>` or `UI2API-ERROR<TAB><message>`; exit 127 means an image without it. */
export function podScript(graph: unknown): string {
  const payload = Buffer.from(JSON.stringify(graph)).toString('base64').replace(/(.{76})/g, '$1\n')
  return ['set -eu', 'UI2API_FILE="$(mktemp)"; trap \'rm -f "$UI2API_FILE"\' EXIT', `cat > "$UI2API_FILE" <<'UI2API_B64'`, payload, 'UI2API_B64', 'python3 /opt/comfy-app/ui2api.py "$UI2API_FILE"'].join('\n')
}
export function parsePodOutput(lines: string[]): Record<string, unknown> {
  const err = lines.find((l) => l.startsWith('UI2API-ERROR\t'))
  if (err) throw new CoreError(502, `The pod could not convert the graph: ${err.slice('UI2API-ERROR\t'.length)}`)
  const ok = lines.find((l) => l.startsWith('UI2API-RESULT\t'))
  if (!ok) throw new CoreError(502, 'The pod printed no converted graph.')
  try { return JSON.parse(Buffer.from(ok.slice('UI2API-RESULT\t'.length), 'base64').toString('utf8')) } catch { throw new CoreError(502, 'The pod printed a converted graph that is not JSON.') }
}
