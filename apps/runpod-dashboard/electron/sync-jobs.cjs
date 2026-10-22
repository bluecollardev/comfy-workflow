// The app's sync jobs, one per pod: the plan, the events syncrun.run sends, and the result. ONE runner for
// both doors: the cards (IPC 'core:sync:*', core.cjs) and the MCP servers the app hosts (mcp-host.cjs passes
// this object to the pod manager as its `syncHost`), so a sync started over MCP shows on the card's bar and one
// started on a card is followed by sync_status. Free of Electron: `broadcast(payload)` is how the events reach
// the windows (core.cjs wires it to every BrowserWindow), which keeps this testable in a plain node process.
//
// A job: { req, steps, transport, ac, events, done, result, error, started }. Events are what syncrun.run
// sends plus a final { kind: 'result', result } or { kind: 'error', text }.

function createSyncJobs({ loadCore, broadcast = () => {}, keepMs = 60_000 }) {
  const jobs = new Map()   // pod id -> job

  /** Start a job unless one is running for the pod. `plan` ({ steps, transport }) is what the caller already asked the core. */
  async function start(req, plan = {}) {
    const id = req.pod_id
    const c = await loadCore()
    const prev = jobs.get(id)
    if (prev && !prev.done) return { ok: false, running: true, job: prev }
    const job = { req, steps: plan.steps || [], transport: plan.transport || null, ac: new AbortController(), events: [], done: false, result: null, error: null, started: new Date().toISOString() }
    jobs.set(id, job)
    const send = (payload) => { job.events.push(payload); broadcast({ id, ...payload }) }
    c.syncrun.run(req, send, job.ac.signal)
      .then((r) => { job.result = r; send({ kind: 'result', result: r }) })
      .catch((e) => { job.error = e?.message || String(e); send({ kind: 'error', text: job.error }) })
      .finally(() => { job.done = true; setTimeout(() => { if (jobs.get(id) === job) jobs.delete(id) }, keepMs).unref?.() })
    return { ok: true, job }
  }

  return {
    start,
    get: (id) => jobs.get(id),
    cancel: (id) => { jobs.get(id)?.ac.abort() },
    /** What a window needs to pick a running job up again. */
    state: (id) => { const j = jobs.get(id); return j && !j.done ? { running: true, events: j.events } : { running: false, events: j ? j.events : [] } },
  }
}

module.exports = { createSyncJobs }
