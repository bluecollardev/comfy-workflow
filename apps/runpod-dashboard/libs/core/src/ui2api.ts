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

/**
 * The converter script, carried by the app (a copy of apps/comfy-app/docker/ui2api.py; a test fails when they differ). The pod used to run its IMAGE's copy through a `sed` that
 * lengthened the 60 s page timeout, which only works when the image's copy looks exactly as expected; on 2026-11-21 pods kept answering "Page.wait_for_function: Timeout 60000ms exceeded"
 * even so (Lucas's queue, 06:32 to 06:48). Now the script the app sends is the script that runs: its timeouts are 240 s and nothing on the image has to match.
 */
export const UI2API_PY: string = "#!/usr/bin/env python3\n\"\"\"Convert one ComfyUI UI graph (the Workflows panel's format) to an API graph with ComfyUI's own frontend (ADR-037).\n\nUsage: ui2api.py <file holding the UI graph as base64 JSON>\nOpens the pod's own ComfyUI page in a headless Chromium, loads the graph and calls app.graphToPrompt(), exactly what the Run button does.\nPrints one line: `UI2API-RESULT<TAB><base64 of the API graph JSON>`, or `UI2API-ERROR<TAB><message>` (exit 1). Queues nothing.\n\"\"\"\nimport base64, json, os, sys\n\nPAGE_READY = \"window.app && window.app.graph && window.app.canvas\"\nPAGE_CONVERT = \"\"\"async (graph) => {\n  await window.app.loadGraphData(graph, true, false, 'ui2api')\n  const p = await window.app.graphToPrompt()\n  return p.output\n}\"\"\"\n\n\ndef main() -> int:\n    try:\n        graph = json.loads(base64.b64decode(open(sys.argv[1]).read()))\n        import os\n        os.environ.setdefault(\"PLAYWRIGHT_BROWSERS_PATH\", \"/opt/playwright\")   # an ssh session does not carry the image's ENV\n        from playwright.sync_api import sync_playwright\n        url = os.environ.get(\"COMFY_URL\", \"http://127.0.0.1:%s\" % os.environ.get(\"COMFY_PORT\", \"8188\"))\n        with sync_playwright() as p:\n            browser = p.chromium.launch(args=[\"--no-sandbox\"])\n            try:\n                page = browser.new_page()\n                page.goto(url, wait_until=\"domcontentloaded\", timeout=int(os.environ.get(\"UI2API_TIMEOUT_MS\", \"240000\")))\n                page.wait_for_function(PAGE_READY, timeout=int(os.environ.get(\"UI2API_TIMEOUT_MS\", \"240000\")))\n                out = page.evaluate(PAGE_CONVERT, graph)\n            finally:\n                browser.close()\n        if not isinstance(out, dict) or not out:\n            raise RuntimeError(\"the page returned no API graph\")\n        print(\"UI2API-RESULT\\t\" + base64.b64encode(json.dumps(out).encode()).decode())\n        return 0\n    except Exception as e:  # one line for the caller, never a traceback\n        print(\"UI2API-ERROR\\t\" + str(e).replace(\"\\n\", \" \")[:500])\n        return 1\n\n\nif __name__ == \"__main__\":\n    sys.exit(main())\n"

/** The pod's way: a script on the pod runs the same page code in the pod's own Chromium. It prints `UI2API-RESULT<TAB><base64 json>` or `UI2API-ERROR<TAB><message>`; exit 127 means a pod without python3 or Playwright. */
export function podScript(graph: unknown): string {
  const payload = Buffer.from(JSON.stringify(graph)).toString('base64').replace(/(.{76})/g, '$1\n')
  return ['set -eu', 'export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/playwright}"   # an ssh session does not carry the image\'s ENV: the browser is in /opt/playwright, not /root/.cache',
    'export UI2API_TIMEOUT_MS="${UI2API_TIMEOUT_MS:-240000}"   # a pod that is still loading its nodes can need minutes for ComfyUI\'s page',
    'UI2API_FILE="$(mktemp)"; UI2API_PY="$(mktemp)"; trap \'rm -f "$UI2API_FILE" "$UI2API_PY"\' EXIT',
    `cat > "$UI2API_FILE" <<'UI2API_B64'`, payload, 'UI2API_B64',
    `cat > "$UI2API_PY" <<'UI2API_PYSRC'`, UI2API_PY.replace(/\n$/, ''), 'UI2API_PYSRC',
    'python3 "$UI2API_PY" "$UI2API_FILE"'].join('\n')
}
export function parsePodOutput(lines: string[]): Record<string, unknown> {
  const err = lines.find((l) => l.startsWith('UI2API-ERROR\t'))
  if (err) throw new CoreError(502, `The pod could not convert the graph: ${err.slice('UI2API-ERROR\t'.length)}`)
  const ok = lines.find((l) => l.startsWith('UI2API-RESULT\t'))
  if (!ok) throw new CoreError(502, 'The pod printed no converted graph.')
  try { return JSON.parse(Buffer.from(ok.slice('UI2API-RESULT\t'.length), 'base64').toString('utf8')) } catch { throw new CoreError(502, 'The pod printed a converted graph that is not JSON.') }
}
