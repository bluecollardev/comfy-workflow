#!/usr/bin/env python3
"""Convert one ComfyUI UI graph (the Workflows panel's format) to an API graph with ComfyUI's own frontend (ADR-037).

Usage: ui2api.py <file holding the UI graph as base64 JSON>
Opens the pod's own ComfyUI page in a headless Chromium, loads the graph and calls app.graphToPrompt(), exactly what the Run button does.
Prints one line: `UI2API-RESULT<TAB><base64 of the API graph JSON>`, or `UI2API-ERROR<TAB><message>` (exit 1). Queues nothing.
"""
import base64, json, os, sys

PAGE_READY = "window.app && window.app.graph && window.app.canvas"
PAGE_CONVERT = """async (graph) => {
  await window.app.loadGraphData(graph, true, false, 'ui2api')
  const p = await window.app.graphToPrompt()
  return p.output
}"""


def main() -> int:
    try:
        graph = json.loads(base64.b64decode(open(sys.argv[1]).read()))
        from playwright.sync_api import sync_playwright
        url = os.environ.get("COMFY_URL", "http://127.0.0.1:%s" % os.environ.get("COMFY_PORT", "8188"))
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox"])
            try:
                page = browser.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_function(PAGE_READY, timeout=60000)
                out = page.evaluate(PAGE_CONVERT, graph)
            finally:
                browser.close()
        if not isinstance(out, dict) or not out:
            raise RuntimeError("the page returned no API graph")
        print("UI2API-RESULT\t" + base64.b64encode(json.dumps(out).encode()).decode())
        return 0
    except Exception as e:  # one line for the caller, never a traceback
        print("UI2API-ERROR\t" + str(e).replace("\n", " ")[:500])
        return 1


if __name__ == "__main__":
    sys.exit(main())
