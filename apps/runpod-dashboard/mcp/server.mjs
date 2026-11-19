#!/usr/bin/env node
// The MCP server Claude Code launches over stdio (`./start.sh mcp`, `npm run mcp`): the agent pool
// (docs/ADR-002), the pods, volumes, configuration and sync the dashboard's cards and panel act on
// (docs/MCP-ENDPOINTS.md), and the governance pages, over the core (libs/core, docs/ADR-005) and nothing
// else: no Python, no port unless asked (`--http <port>` or MCP_HTTP_PORT serves the same tools over the
// SDK's Streamable HTTP transport on 127.0.0.1 at /mcp, for clients that only take remote MCP; see
// transport.mjs). The pool tools are the port of apps/runpod-api/mcp_server.py, tool for tool, so
// docs/MCP-SERVER.md stays true.
//
// Governance (shared/governance, Binc's policies) is applied to every connecting client: handed over
// at initialize as the server's instructions, served as governance:// resources and through the
// `governance` tool, and enforced on the tools that spend: create_agent, create_pod and create_volume
// without approved_by make nothing, and a sync that takes plates off this PC needs the same named yes.
// Nothing is cached; a re-sync of the pages is applied on the next launch.
//
// No-spend mode (the configuration's dry_run, or RUNPOD_DRY_RUN=1) acts on simulated pods and volumes, as
// the app does, and every answer says so. stdout is the protocol: anything we have to say goes to stderr.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import pkg from '../package.json' with { type: 'json' }
import { isMain, loadCore, serve, startHttp } from './transport.mjs'
import { appTools } from './app-tools.mjs'
import * as docs from './docs.mjs'

export { startHttp }
const version = pkg.version

// The server is built by a factory over the core it is handed and a "sync host": stdio mode (below) keeps a
// private job map; the app (electron/mcp-host.cjs) hands in the one its cards use, so a sync started over MCP
// shows on the card's bar. A host is { get(pod_id) -> job | undefined, start(req, { steps, transport }) -> { ok, job } }.

const LOG_WAIT_MS_DEFAULT = 3000

/** Where a sync job is, for sync_status: the plan, the events syncrun.run sends and the result. */
export function syncSummary(job) {
  const total = job.steps.length
  const started = job.events.filter((e) => e.kind === 'step').length
  const finished = job.events.filter((e) => e.kind === 'step-done').length
  const current = [...job.events].reverse().find((e) => e.kind === 'step') || null
  const inStep = started > finished
  const lastProgress = inStep ? [...job.events].reverse().find((e) => e.kind === 'progress' && e.key === current.key) : null
  const percent = job.done && job.result ? 100 : total ? Math.round(((finished + (inStep ? (lastProgress?.percent ?? 0) / 100 : 0)) / total) * 100) : 0
  const files = job.events.filter((e) => e.kind === 'file').map((e) => e.path)
  const errors = job.events.filter((e) => e.kind === 'problem' || e.kind === 'error').map((e) => e.text)
  if (job.error) errors.push(job.error)
  return {
    pod_id: job.req.pod_id, direction: job.req.direction, transport: job.transport.kind, started: job.started,
    running: !job.done, done: job.done, folder: Math.min(started, total), of: total, current: inStep ? current.key : null, percent,
    files_count: files.length, files: files.slice(-50), errors, failed_folders: job.events.filter((e) => e.kind === 'step-done' && e.code !== 0).map((e) => e.key),
    cancelled: !!job.result?.cancelled, result: job.result, summary: [...job.events].reverse().find((e) => e.kind === 'done')?.text ?? null,
  }
}

/** Sync jobs kept in this process (stdio mode): the plan, the events syncrun.run sends, and the result. A job
 *  outlives the call that started it; sync_status reads it. Same shape as the app's (electron/sync-jobs.cjs). */
export function privateSyncHost(core) {
  const jobs = new Map()
  return {
    get: (id) => jobs.get(id),
    start(req, plan = {}) {
      const prev = jobs.get(req.pod_id)
      if (prev && !prev.done) return { ok: false, running: true, job: prev }
      const job = { req, steps: plan.steps || [], transport: plan.transport || null, ac: new AbortController(), events: [], done: false, result: null, error: null, started: new Date().toISOString() }
      jobs.set(req.pod_id, job)
      core.syncrun.run(req, (e) => job.events.push(e), job.ac.signal)
        .then((r) => { job.result = r })
        .catch((e) => { job.error = e?.message || String(e) })
        .finally(() => { job.done = true })
      return { ok: true, job }
    },
  }
}

/** The pod manager's MCP server over `core` (libs/core's exports). `syncHost` runs the syncs: omitted, a private
 *  one (stdio). Returns a fresh SDK Server; call it again for another connection. */
export function createPodManagerServer({ core, syncHost = privateSyncHost(core) }) {
  const { comfyruns, governance, gpus, history, imports, mounts, outputs, outputsources, pods, pool, syncrun, volumes } = core
  pods.startWatches?.()   // Retry Later (ADR-042 section 19): a watch this server registers is tried again while it is up (the app does the same; a claim keeps the two apart)
  const LOG_WAIT_MS = Number(process.env.MCP_LOG_WAIT_MS) || LOG_WAIT_MS_DEFAULT   // RunPod's log stream stays open after the backfill; this is how long get_logs listens

  const agentId = { type: 'string', description: 'Agent ID' }
  const podId = { type: 'string', description: 'Pod ID (list_pods)' }
  const approvedBy = { type: 'string', description: 'Who said yes to this spend. Only needed when the named-yes setting is on (set_settings agent_named_yes_required); never guessed.' }
  /** The Python's tool list, verbatim where the core allows; the GPU menu is the core's card table, not a guess. */
  const POOL_TOOLS = [
    { name: 'list_agents', description: 'List all agents in the MOE pool with their status', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_pool_status', description: 'Get detailed status of the entire agent pool (running pods, cost, health)', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'governance',
      description: "The rules this session runs under (shared/governance, Binc's policies): list the pages, or read one by name, e.g. policy/agent-permissions.md",
      inputSchema: { type: 'object', properties: { page: { type: 'string', description: 'Page name to read; omit to list every page' } } },
    },
    {
      name: 'create_agent',
      description: `Create a new GPU pod agent for the pool. Spends money. approved_by, the person behind the yes, is needed only when the named-yes setting is on`,
      inputSchema: {
        type: 'object',
        properties: {
          approved_by: approvedBy,
          agent_name: { type: 'string', description: "Agent type (e.g., 'image-gen', 'video-gen', 'upscale')" },
          gpu_type: { type: 'string', enum: pool.GPU_TYPES, description: 'GPU type for this agent: a card from the pod manager\'s table, or auto for the cheapest one in stock' },
          storage_gb: { type: 'integer', description: 'Storage size in GB (50-500); 0 beside a network volume', default: 100 },
        },
        required: ['agent_name', 'gpu_type'],
      },
    },
    { name: 'stop_agent', description: 'Stop a running agent pod (pauses billing)', inputSchema: { type: 'object', properties: { agent_id: { ...agentId, description: 'Agent ID to stop' } }, required: ['agent_id'] } },
    { name: 'resume_agent', description: 'Resume a stopped agent pod', inputSchema: { type: 'object', properties: { agent_id: { ...agentId, description: 'Agent ID to resume' } }, required: ['agent_id'] } },
    { name: 'delete_agent', description: 'Permanently delete an agent pod', inputSchema: { type: 'object', properties: { agent_id: { ...agentId, description: 'Agent ID to delete' } }, required: ['agent_id'] } },
    { name: 'health_check_agent', description: 'Check if an agent is healthy and responding', inputSchema: { type: 'object', properties: { agent_id: { ...agentId, description: 'Agent ID to check' } }, required: ['agent_id'] } },
    { name: 'get_agent_info', description: 'Get detailed information about an agent', inputSchema: { type: 'object', properties: { agent_id: { ...agentId, description: 'Agent ID to get info for' } }, required: ['agent_id'] } },
    {
      name: 'submit_job',
      description: 'Submit a ComfyUI workflow to an agent for execution',
      inputSchema: {
        type: 'object',
        properties: {
          agent_id: { ...agentId, description: 'Agent ID to submit job to' },
          workflow_json: { type: 'string', description: 'ComfyUI workflow JSON (API format)' },
          prompt_name: { type: 'string', description: 'Name/description of this job' },
        },
        required: ['agent_id', 'workflow_json'],
      },
    },
    {
      name: 'get_job_status',
      description: 'Get status of a submitted job',
      inputSchema: {
        type: 'object',
        properties: { agent_id: { ...agentId, description: "Agent that's running the job" }, job_id: { type: 'string', description: 'Job ID from submission' } },
        required: ['agent_id', 'job_id'],
      },
    },
  ]

  /** The same calls the dashboard's cards and the Configuration panel make (docs/MCP-ENDPOINTS.md, "Pods and the rest of the app"). */
  const POD_TOOLS = [
    { name: 'list_pods', description: 'Every pod as the dashboard shows it: id, name, status, card, ComfyUI URL (and whether it answers), idle stop, and its own configuration when it has one', inputSchema: { type: 'object', properties: {} } },
    { name: 'get_pod', description: "One pod with RunPod's details: price per hour, cloud, datacenter, image, disks, status text, and its own configuration", inputSchema: { type: 'object', properties: { pod_id: podId }, required: ['pod_id'] } },
    {
      name: 'create_pod',
      description: `Create a pod the way the dashboard's form does, with the Default Configuration (or a per-pod one) applied. Spends money. approved_by, the person behind the yes, is needed only when the named-yes setting is on. "No card available" lists what was tried.`,
      inputSchema: {
        type: 'object',
        properties: {
          approved_by: approvedBy,
          name: { type: 'string', description: 'Pod name' },
          gpu: { type: 'string', enum: pool.GPU_TYPES, description: "A card from the table, or auto: the cheapest one in stock where the volume lives. Omitted: the Default Configuration's default card (RTX PRO 6000 unless changed; get_configuration shows it as default_gpu)" },
          datacenter: { type: 'string', description: 'Datacenter id (list_datacenters). With a network volume applied its datacenter wins; to run in another region pass apply_mounts=false (no volume, no mount configuration) or make a volume there first (create_volume)' },
          like_pod_id: { type: 'string', description: "A new pod like this one (its image, disk, cloud, idle stop, own configuration and so its network volume and datacenter) on the card named by gpu, in the SAME datacenter; name is then ignored (the new pod is named <old name>-<card>). The old pod is NOT stopped or deleted. Add retry_until_free to wait for a free card (Retry Later's 'Another GPU')" },
          gpus: { type: 'array', items: { type: 'string', enum: pool.GPU_TYPES }, description: "With like_pod_id: several cards in the order you prefer them; each try asks them in that order and the first with a card free is used. ONE pod is made, named <old name>-alt. Use with retry_until_free to wait until one is free (Retry Later's 'Another GPU', several chosen)" },
          gpu_type_id: { type: 'string', description: 'A raw RunPod GPU id (list_gpus / list_datacenters) for a card outside the table, in place of gpu. Blackwell and AMD cards will not run the image' },
          gpu_count: { type: 'integer', minimum: 1, maximum: 8, default: 1 },
          instance_type: { type: 'string', enum: ['on-demand', 'spot'], description: 'on-demand = secure cloud; spot = community cloud. Omitted: the app\'s default (spot); a pod with a network volume is always secure' },
          disk_gb: { type: 'integer', description: 'Container disk in GB (default 20)' },
          volume_gb: { type: 'integer', description: 'A per-pod volume in GB; 0 beside a network volume (default)' },
          start_ssh: { type: 'boolean', default: true },
          start_jupyter: { type: 'boolean', default: false },
          env_vars: { type: 'object', description: 'Extra environment variables for the pod', additionalProperties: { type: 'string' } },
          pip_requirements: { type: 'string', description: 'Extra pip requirements installed at start (CUSTOM_PIP_REQUIREMENTS)' },
          custom_nodes: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, branch: { type: 'string' } }, required: ['url'] }, description: 'Node packs cloned at start' },
          image: { type: 'string', description: "'configured' (the configuration's image), 'prebuilt' (RunPod's stock ComfyUI image), or a registry reference. Omitted: ours when it has been pushed, else prebuilt" },
          idle_stop_minutes: { type: 'integer', description: 'Stop the pod after this many quiet minutes; 0 = never. Omitted: the configuration\'s value' },
          retry_until_free: { type: 'boolean', description: 'When RunPod has no free GPU for this create, do not fail: keep trying the same create (a watch, seen with pod_watch) every every_minutes until it works, for up to give_up_hours. Nothing is deleted or made twice' }, every_minutes: { type: 'number', description: 'With retry_until_free: minutes between tries (default 2, at least 1)' }, give_up_hours: { type: 'number', description: 'With retry_until_free: give up after this create many hours (default 12, at most 72)' },
          apply_mounts: { type: 'boolean', description: 'Apply the mount configuration (volume, env, links). Omitted: the configuration\'s apply_by_default' },
          config: { type: 'object', description: "This pod's own configuration (the Default Configuration's shape, as get_configuration shows it), kept for recreate_pod" },
          auto_sync: { anyOf: [{ type: 'boolean' }, { type: 'object', properties: { pull: { type: 'boolean' }, push: { type: 'boolean' } } }], description: 'Auto sync (docs/ADR-046) for the pods this CREATES (pods reused from the pool are not changed): true = pull the volume\'s changes to this PC, or { pull, push }. Turned on with approved_by as the named yes. See auto_sync' },
          round: { type: 'string', maxLength: 120, description: 'Put the new pod in this delivery round (a map on our side; see set_pod_round). Omitted: no round' },
        },
        required: ['name'],
      },
    },
    { name: 'stop_pod', description: 'Stop a pod (pauses the hourly bill; the disk and the volume stay)', inputSchema: { type: 'object', properties: { pod_id: podId }, required: ['pod_id'] } },
    { name: 'resume_pod', description: "Resume a stopped pod on its host. RunPod pins a stopped pod to its host: when that host has no free GPU the answer says so and offers two ways on: retry_until_free: true keeps trying every few minutes until the host has a card (nothing is deleted; seen with pod_watch), or recreate_pod (a fresh pod elsewhere; this pod and its container disk are deleted, so only for a pod with a network volume or nothing to keep)", inputSchema: { type: 'object', properties: { pod_id: podId, retry_until_free: { type: 'boolean', description: 'When RunPod has no free GPU for this, do not fail: keep trying (a watch, seen with pod_watch) every every_minutes until it works, for up to give_up_hours. Nothing is deleted or made twice' }, every_minutes: { type: 'number', description: 'With retry_until_free: minutes between tries (default 2, at least 1)' }, give_up_hours: { type: 'number', description: 'With retry_until_free: give up after this many hours (default 12, at most 72)' } }, required: ['pod_id'] } },
    { name: 'delete_pod', description: 'Terminate a pod (irreversible; asks nothing, as the card does after its confirm). A network volume is not touched', inputSchema: { type: 'object', properties: { pod_id: podId }, required: ['pod_id'] } },
    { name: 'recreate_pod', description: 'A fresh pod with the same name, image, card choice, disk, idle stop and own configuration on whatever host is free; the old one is TERMINATED with its container disk (files that live only on a pod with no network volume are lost). The network volume follows. When a resume failed only because the host is full, resume_pod with retry_until_free: true is the way that deletes nothing', inputSchema: { type: 'object', properties: { pod_id: podId }, required: ['pod_id'] } },
    { name: 'get_history', description: "What happened on this PC, newest first: `pod` events (a pod was created, started, stopped, recreated, renamed or deleted, with its GPU, datacenter and hourly price) `job` events (a round pull, a delete of a round, or a sync, ended done, failed or cancelled, with files and bytes) and `change` events (a volume made, resized, deleted or made the default; the configuration saved or imported; a shot pack imported; an adapter saved). Each says where it came from: `source` app or mcp, with the `tool` and the `approved_by` of an MCP call. Read from this app's own log, so it covers only what was done through this app. For ComfyUI's own runs use get_comfy_runs; for money use get_spend_history", inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['pod', 'job', 'change'], description: 'only pod events, job events or changes (volumes, configuration, imports, adapters); default: all' }, limit: { type: 'integer', minimum: 1, maximum: 5000, description: 'most events to return (default 200)' } } } },
    { name: 'get_spend_history', description: "What the pods have cost, worked out from the start and stop events in the history: the total, what is running now, each session (pod, from, to, hours, cost) and the cost by day. An estimate (RunPod bills by the second at the price listed then); read its `note`. For the live burn rate use cost_now", inputSchema: { type: 'object', properties: {} } },
    { name: 'get_comfy_runs', description: "A failed item is never just 'failed': it carries `failure` {stage (load/validate/queue/execute/encode/transfer), node_id, node_type, message, missing_models [{name, where_on_volume}], recovery, retryable, text}; a field that could not be obtained says 'not obtained' in `text`. The runs on a pod's ComfyUI, newest first, read from the pod: queued and running ones, then finished ones (up to 50) with status (success, error, running, pending), start time, duration in seconds, an estimated cost (`cost_estimate`, USD: the run's seconds at the pod's hourly price), the output files (filename, type, subfolder) the error message of a failed run, `messages` (ComfyUI's own status timeline for the run: execution_start, execution_cached, execution_success, execution_error, execution_interrupted, each with its time and data) and, for a failed run, `error_detail` (message, node_id, node_type, exception_type, traceback lines). For the server's own log use get_comfy_logs. The pod must be running (otherwise refused: start it first); ComfyUI forgets its history when the pod is recreated. With `saved: true` it instead returns the SAVED runs this app keeps past a pod stop (newest first, no pod needed): prompt_id, workflow, started_at, duration_s, pod_id, pod_name, volume_id, datacenter, recorded_at and files (filename, subfolder, type output); narrow with pod_id and/or volume_id (a run matches its pod or its network volume). The files are on the volume: viewing them needs a running pod on it", inputSchema: { type: 'object', properties: { pod_id: podId, saved: { type: 'boolean', description: 'return the saved runs (kept after the pod stops) instead of reading the pod; pod_id is then optional' }, volume_id: { type: 'string', description: 'with saved: only the runs on this network volume' } }, required: [] } },
    { name: 'list_outputs', description: "The files a pod's runs wrote, from every output source or one, newest first, each run tagged with its `source`: `pod-history` (the running pod's own ComfyUI history), `saved` (this app's record, kept past a stop) and `volume-s3` (the network volume's comfy-shared/output/ folder read over RunPod's S3 API: NO pod is needed and nothing is spent; it needs the RunPod S3 keys in Default Configuration, and a source that cannot answer is reported in `sources` with its reason, the others still answer). The volume is browsed by folder, never whole (the tree is huge): with no `prefix` it starts in the pod's shot folder (output/*/<shot>/) when there is one, else lists the top-level folders; `prefix` (a folder path under output/, e.g. proxy_v004/archival-080) lists what is under it. A volume 'run' is a folder that holds files (a frame sequence, a video folder), started_at = the newest modification; files have bytes and modified. At most 3000 files are returned per listing (`capped`: true, `total` says how many). Folders under the prefix come back in `folders`. Read-only: it never writes or deletes. Answers { sources, runs, folders, prefix, capped, total, volume_id }", inputSchema: { type: 'object', properties: { all: { type: 'boolean', description: "volume-s3 (ADR-045 'All outputs'): the WHOLE comfy-shared/output/ tree in one listing, grouped into runs by folder (at most 25,000 files shown; `total` counts what was found, `total_exact` false past 200,000); `folder_info` flags every folder found as empty or not. Cached 60 s (`fresh` bypasses). With `job: true` it returns { job_id } at once" }, job: { type: 'boolean', description: 'with all: start the listing as a job and return { job_id }' }, job_id: { type: 'string', description: 'the status of a job started with all + job: { state, files_seen, folders_seen, elapsed_s, result? }' }, cancel_job: { type: 'boolean', description: 'with job_id: stop that listing' }, pod_id: { type: 'string', description: 'the pod: its history, its saved runs, and its network volume and Shot for the volume listing' }, volume_id: { type: 'string', description: 'a network volume id (else the pod\'s, else the Shared or default volume)' }, source: { type: 'string', enum: ['pod-history', 'saved', 'volume-s3'], description: 'only this source; default all' }, prefix: { type: 'string', description: "volume-s3: the folder under comfy-shared/output/ to list, e.g. 'proxy_v004/archival-080'; '' is the root; omit to start in the pod's shot folder" }, fresh: { type: 'boolean', description: 'skip the 90 s listing cache' } }, required: [] } },
    { name: 'get_comfy_logs', description: "`problems` lists what the error lines say in words (kind: missing model, out of memory, custom node import failed, file not found; the missing models with where they belong; recovery). ComfyUI's own server log read from a pod, oldest first, newest last: errors, warnings and feedback such as missing models or custom nodes, failed node imports, out-of-memory (OOM) and Python tracebacks. Each entry has `ts` (ISO time or null), `level` (error, warning, info) and `text`; `truncated` is true when older lines were cut by `lines`. Use `level` errors to find what went wrong, warnings for errors and warnings. The pod must be running (otherwise refused: start it first); an old ComfyUI with no log endpoint answers 501. For per-run results use get_comfy_runs", inputSchema: { type: 'object', properties: { pod_id: podId, level: { type: 'string', enum: ['all', 'warnings', 'errors'], description: 'all (default), warnings (warnings and errors) or errors' }, lines: { type: 'integer', minimum: 1, maximum: 2000, description: 'most lines to return, the newest (default 300, max 2000)' } }, required: ['pod_id'] } },
    { name: 'export_history', description: "Export the history as a file's text with its suggested file name: `what` events (the pod and job events, default) or spend (the sessions the cost is worked out from), as `format` json (default) or csv. Only reads: it writes no file, so save the text yourself if it is wanted on disk", inputSchema: { type: 'object', properties: { format: { type: 'string', enum: ['json', 'csv'] }, what: { type: 'string', enum: ['events', 'spend'] } } } },
    { name: 'rename_pod', description: "Name a pod in this app (a map on our side only: RunPod's own name is untouched). An empty name goes back to RunPod's. list_pods and get_pod then show it", inputSchema: { type: 'object', properties: { pod_id: podId, name: { type: 'string', maxLength: 80 } }, required: ['pod_id', 'name'] } },
    { name: 'set_pod_round', description: "Put a pod in a delivery round, or take it out with an empty round (a map on our side only: the pod is not touched, no spend). A round holds a series of pods; list_pods and get_pod show each pod's `round`. Round names are the ones panama_rounds lists", inputSchema: { type: 'object', properties: { pod_id: podId, round: { type: 'string', maxLength: 120, description: 'the round name; empty takes the pod out of its round' } }, required: ['pod_id', 'round'] } },
    { name: 'set_pod_shot', description: "Say which shot a pod works on (our side only, no spend): free text, one of the shots of the pod's round, or the value \"All Shots\". The pod must be in a round (set_pod_round); an empty shot goes back to the default, \"All Shots\". A pod in a round with no shot of its own shows \"All Shots\" in list_pods and get_pod (`shot`)", inputSchema: { type: 'object', properties: { pod_id: podId, shot: { type: 'string', maxLength: 120, description: 'the shot; empty = All Shots' } }, required: ['pod_id', 'shot'] } },
    { name: 'delete_round', description: "Delete a round on our side: its pods leave it (they keep running; nothing on RunPod is touched) and its name goes back to the key", inputSchema: { type: 'object', properties: { round: { type: 'string', maxLength: 120 } }, required: ['round'] } },
    { name: 'rename_round', description: "Name a round in this app (a map on our side only: the delivery round's own name is kept as the key). An empty name goes back to the round's own. list_pods and get_pod show `round` and `round_label`", inputSchema: { type: 'object', properties: { round: { type: 'string', maxLength: 120, description: 'the round (its own name)' }, name: { type: 'string', maxLength: 80 } }, required: ['round', 'name'] } },
    { name: 'set_idle_stop', description: 'Set a pod\'s idle stop: stopped after this many minutes with nothing queued in its ComfyUI; 0 = never', inputSchema: { type: 'object', properties: { pod_id: podId, minutes: { type: 'integer', minimum: 0 } }, required: ['pod_id', 'minutes'] } },
    { name: 'get_logs', description: 'The last lines of a pod\'s logs from RunPod (container and system)', inputSchema: { type: 'object', properties: { pod_id: podId, lines: { type: 'integer', description: 'How many lines, 1-1000', default: 100 } }, required: ['pod_id'] } },
    { name: 'list_datacenters', description: 'Every listed datacenter with S3 support and EVERY card RunPod runs there, free or in use (nothing is hidden: ADR-027), NVIDIA and AMD, each with size, secure-cloud price, stock and whether the image can run it; datacenters with most free cards first. Cached a minute', inputSchema: { type: 'object', properties: { fresh: { type: 'boolean', description: 'Skip the cache and read RunPod now' } } } },
    { name: 'list_volumes', description: 'The network volumes with size, datacenter, cost per month, S3 support, the pods on each, and which is the default', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'create_volume',
      description: `Create a network volume (billed monthly: USD 0.07 per GB). Spends money. approved_by, the person behind the yes, is needed only when the named-yes setting is on`,
      inputSchema: {
        type: 'object',
        properties: { approved_by: approvedBy, name: { type: 'string' }, size_gb: { type: 'integer', description: '10 to 4000' }, datacenter: { type: 'string', description: 'Datacenter id (list_datacenters). The volume lives there and pods that use it must run there; a new region means a new volume' } },
        required: ['name', 'size_gb', 'datacenter'],
      },
    },
    { name: 'delete_volume', description: 'Delete a network volume; refused while a pod is attached to it', inputSchema: { type: 'object', properties: { volume_id: { type: 'string', description: 'Volume ID (list_volumes)' } }, required: ['volume_id'] } },
    { name: 'set_default_volume', description: 'Make a volume the Default Configuration\'s: its id and its datacenter together, since a volume pins both', inputSchema: { type: 'object', properties: { volume_id: { type: 'string', description: 'Volume ID (list_volumes)' } }, required: ['volume_id'] } },
    { name: 'get_configuration', description: '[folder_excludes ({ project, plates, comfy-shared, workflows: [patterns] }, ADR-011: per-folder exclusion defaults, relative to THAT folder\'s root, added to sync_exclude for that step only; a pod\'s own map replaces the Default\'s per key, an empty list clears the key for the pod; at most 100 per key and 300 in all) and sync_exclude_delete (a push with exclusions also removes what the patterns match on the volume, a guarded removal that still needs a named yes; default false) are part of the configuration.] [sync_exclude (a list of folder or file patterns a push leaves out, rsync semantics: `/X/` the top-level folder, `X/` folders anywhere, `X` anything named X) is part of the configuration (ADR-011): the pod\'s own list replaces the Default\'s; a run\'s `exclude` is added; default []; they only remove things from a push.] [render { where, kind, proxy_width, review_width, codecs, fps, pull, skip_existing, publish: { s3, slack } } is part of the configuration (ADR-048): how DPX sequences are rendered; `pull` (Sync the renders to this PC when done) defaults to OFF, `skip_existing` to ON, `publish` (what the Generate window pre-ticks for Publish to S3 / Post to Slack when done) to both off, and publishing needs the renders on this PC (pull on, or where local); they are preferences, a run still needs its own `publish` field and approved_by; an app-wide `outputs { hide_empty_folders }` (default true) is the starting choice of the Outputs window; default { auto, proxy, source, source, [prores422hq], auto, true }; no approver and no allow_partial are ever stored.] [auto_sync { enabled, pull, push, approved_by } is part of the configuration (ADR-046): Auto sync for each pod created under it; enabled: true needs approved_by, the named yes; default off, Pull on, Push off.] The Default Configuration: the folders mapped on this PC and where a pod has them, the volume, datacenter, image, idle stop, mode and what is required', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'sync',
      description: "Start a copy between this PC's mapped folders and the pod's volume, in the app's job runner: push (project, comfy-shared, the repo workflows; plates only with a named yes) or pull (ComfyUI's output, each shot's renders and packages). Returns the plan and the transport (SSH into the running pod, or RunPod's S3 API onto the volume); sync_status follows it",
      inputSchema: {
        type: 'object',
        properties: {
          pod_id: podId,
          direction: { type: 'string', enum: ['push', 'pull'], default: 'push' },
          only: { type: 'array', items: { type: 'string' }, description: 'Narrow to these folders: push project, plates, comfy-shared, workflows; pull output, review, deliver' },
          skip_renders: { type: 'boolean', description: "Push: leave the shots' 05_TEMPS, 06_REVIEW and 07_DELIVER behind" },
          skip_tests: { type: 'boolean', description: "Push: leave Binc's 80_TEST-BUCKET behind" },
          exclude: { type: 'array', items: { type: 'string' }, description: "Push: folders or files to leave out of THIS run (rsync patterns relative to each step's local root: `/CANALV2/` the top-level folder, `CANALV2/` folders of that name anywhere, `X` anything named X; at most 100, no `..`). Added to the configuration's sync_exclude (the pod's own, else the Default's). They only remove things from the push: nothing on the volume is deleted. See sync_folders for the folders to choose from" },
          existing: { type: 'string', enum: ['update', 'size', 'checksum', 'replace'], description: 'A file already on the pod (SSH only): update = send what changed (default), size = skip the same name and size, checksum = skip identical content, replace = send everything again' },
          shared: { type: 'array', items: { type: 'string', enum: ['input', 'models', 'output', 'workflows'] }, description: 'Push: which ComfyUI-Shared folders to send. Default: the pod\'s own configuration, else the Default Configuration (input, models, workflows: output is what pods write and stays home)' },
          plates: { type: 'boolean', description: 'Push the served plates too (client material leaving this PC: approved_by (only when the named-yes setting is on))', default: false },
          delete_excluded: { type: 'boolean', description: "Push with `exclude`: ALSO remove, before copying, what the patterns match on the volume (a targeted, guarded removal: only matched top folders, strictly inside each step's root, one `rm -rf --one-file-system` per folder; never rsync --delete-excluded, so renders and outputs made on the pod stay). Default: the configuration's sync_exclude_delete. Needs approved_by when anything would be removed. Not for a pull. Preview with the app's count (would_delete)" },
          approved_by: { type: 'string', description: 'The named yes for plates leaving this PC, and for deleting excluded folders from the volume' },
        },
        required: ['pod_id'],
      },
    },
    { name: 'sync_status', description: 'Where a sync started by this server is: folder N of M, percent, files landed, errors, done', inputSchema: { type: 'object', properties: { pod_id: podId }, required: ['pod_id'] } },
    { name: 'adapter_spec', description: 'The spec for writing an import adapter (a .mjs module that maps a package folder onto the ComfyUI-Shared structure): the target, the module shape, the plan, what the app enforces. Read this before adapter_save.', inputSchema: { type: 'object', properties: {} } },
    { name: 'adapters_list', description: 'The import adapters: built-in and the user\'s own, with the sha256 of each adapter code (read it with Inspect in the app, or ./start.sh import --show <id>)', inputSchema: { type: 'object', properties: {} } },
    { name: 'adapter_save', description: 'Save an adapter module (ES module source) as ~/.config/runpod-pod-manager/adapters/<id>.mjs. Syntax-checked and structure-checked, nothing is run. It is listed in Default Configuration > Import adapters with its code open to read, edit or delete; test it with import_plan', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'lowercase letters, digits and dashes' }, source: { type: 'string', description: 'the module source' } }, required: ['id', 'source'] } },
    { name: 'import_plan', description: 'Dry-run an import (folder or .zip, which is unpacked once): which adapter recognises the package (or the one named), what it would copy where in ComfyUI-Shared, by kind with counts and bytes, and its findings. Writes nothing. The adapter runs fenced (read-only on that folder). Use it to test an adapter on a real folder', inputSchema: { type: 'object', properties: { source: { type: 'string', description: 'absolute path of the package folder or .zip' }, adapter: { type: 'string', description: 'adapter id (default: the best match)' } }, required: ['source'] } },
    { name: 'import_apply', description: 'Import a folder or .zip through an adapter into this PC\'s ComfyUI-Shared (copies; never deletes; a differing existing file is a conflict unless overwrite). dry_run defaults to true. Getting it onto a pod is the sync, not this', inputSchema: { type: 'object', properties: { source: { type: 'string' }, adapter: { type: 'string' }, dry_run: { type: 'boolean', description: 'default true' }, overwrite: { type: 'boolean' } }, required: ['source'] } },
    { name: 'get_credits', description: "The credits left on the RunPod account (RunPod's own balance), what the running pods spend per hour right now, the account's spend limit, how many hours the credits last at this rate (null while nothing runs) and a level: ok, low (under $15 or 24 hours) or critical (under $5 or 6 hours). Null in no-spend mode. Call it before starting anything that spends", inputSchema: { type: 'object', properties: {} } },
    { name: 'cost_now', description: 'What is billing right now: the running pods\' price per hour summed, and the volumes\' cost per month', inputSchema: { type: 'object', properties: {} } },
  ]

  const NO_SPEND = '(no-spend mode: simulated pod; nothing reached RunPod, nothing is billed)'
  const text = (t, isError = false) => ({ content: [{ type: 'text', text: pool.dryRun() ? `${t}\n\n${NO_SPEND}` : t }], isError })
  /** RunPod's request limit (ADR-042 section 18): an object answer carries it while it holds; a list stays a list (ask rate_limit_status). */
  const limitNow = () => { try { const s = core.ratelimit?.status?.(); return s?.limited ? s : null } catch { return null } }
  const json = (v) => {
    const isObj = v && !Array.isArray(v) && typeof v === 'object'
    const rl = isObj && !('retry_at' in v && 'limited' in v) ? limitNow() : null
    return text(JSON.stringify(isObj ? { ...v, ...(pool.dryRun() ? { dry_run: true } : {}), ...(rl ? { rate_limited: rl } : {}) } : v, null, 2))
  }
  const round2 = (n) => Math.round(n * 100) / 100
  /** An answer with no no-spend note: for documentation and other things that are not about pods. */
  const plain = (v, isError = false) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }], isError })

  const app = appTools({ core, governance, text, json, plain })   // everything else the window does (docs/ADR-028)
  const TOOLS = [...POOL_TOOLS, ...POD_TOOLS, ...app.tools]

  /** Does RunPod's answer say the host or cloud has no card for this pod? */
  /** retry_until_free's numbers (minutes, hours) as the core's watch options (seconds, hours); the core checks the limits. */
  const watchOpts = (a) => ({ ...(a.every_minutes != null ? { every_s: Math.round(Number(a.every_minutes) * 60) } : {}), ...(a.give_up_hours != null ? { give_up_h: Number(a.give_up_hours) } : {}) })
  const hostFull = (message) => pods.NO_STOCK.test(message) || /host|unavailable|resources/i.test(message)

  /** tool name -> what it answers. Each returns a CallToolResult; the dispatcher below turns throws into one. */
  const HANDLERS = {
    ...app.handlers,
    governance: async ({ page }) => {
      if (!page) return json(governance.listing())
      const t = governance.read(page)
      return t == null ? text(`No such page: ${page}. Pages: ${governance.listing().map((p) => p.name).join(', ')}`, true) : text(t)
    },
    list_agents: async () => json(pool.agents()),
    get_pool_status: async () => json(await pool.status()),
    create_agent: async (args) => {
      const refusal = governance.namedYes(args, 'create_agent')   // the gate: no named yes, no pod
      if (refusal) return text(refusal, true)
      const a = await pool.create({ agent_name: args.agent_name, gpu_type: args.gpu_type, storage_gb: args.storage_gb ?? 100 })
      console.error(`create_agent ${a.agent_id} (pod ${a.pod_id}) approved by ${String(args.approved_by).trim()}`)
      return text(`✓ Agent created: ${a.agent_id}\n\nComfyUI: ${a.comfyui_url}\nSSH: ${a.ssh_command}`)
    },
    stop_agent: async ({ agent_id }) => { await pool.stop(agent_id); return text(`✓ Agent stopped: ${agent_id}`) },
    resume_agent: async ({ agent_id }) => { await pool.resume(agent_id); return text(`✓ Agent resumed: ${agent_id}`) },
    delete_agent: async ({ agent_id }) => { await pool.remove(agent_id); return text(`✓ Agent deleted: ${agent_id}`) },
    health_check_agent: async ({ agent_id }) => {
      const { healthy, agent } = await pool.healthCheck(agent_id)
      return text(`${healthy ? '✓ Healthy' : '✗ Unhealthy'}\n\n${JSON.stringify(agent.health, null, 2)}`)
    },
    get_agent_info: async ({ agent_id }) => json(await pool.info(agent_id)),
    submit_job: async ({ agent_id, workflow_json, prompt_name }) => {
      const job = await pool.submitJob(agent_id, workflow_json, prompt_name)
      return text(`✓ Job submitted: ${job.job_id}\n\nAgent: ${job.agent_id}\nAPI: ${job.api_url}\nStatus: ${job.status_url}`)
    },
    get_job_status: async ({ agent_id, job_id }) => json(await pool.jobStatus(agent_id, job_id)),

    // ----- pods and the rest of the app -----
    list_pods: async () => json((await pods.list()).map((p) => ({ ...p, config: pods.config(p.id) }))),
    get_pod: async ({ pod_id }) => {
      const [p, d] = await Promise.all([pods.get(pod_id), pods.details(pod_id)])
      return json({
        ...p, runpod_status: d.status, status_text: d.status_text, cost_per_hr: d.cost_per_hr, cloud: d.cloud, datacenter: d.datacenter, image: d.image,
        disk_gb: d.disk_gb, volume_gb: d.volume_gb, created_at: d.created_at, actions: d.actions, console_url: d.console_url, config: pods.config(pod_id),
      })
    },
    create_pod: async (args) => {
      const refusal = governance.namedYes(args, 'create_pod')
      if (refusal) return text(refusal, true)
      // Auto sync for the new pod (ADR-046): true is pull only; the named yes is approved_by. Never fails the create.
      const wantAuto = args.auto_sync === true ? { pull: true, push: false } : args.auto_sync && typeof args.auto_sync === 'object' ? { pull: args.auto_sync.pull !== false, push: args.auto_sync.push === true } : null
      const applyAuto = (id) => {
        if (!wantAuto) return undefined
        const by = String(args.approved_by || '').trim()
        if (!by) return { enabled: false, skipped: 'Auto sync needs the name of who says yes: give approved_by' }
        try { return core.autosync.set(id, { enabled: true, ...wantAuto, approved_by: by }) } catch (e) { return { enabled: false, skipped: e.message } }
      }
      if (args.like_pod_id) {
        // a pod like another one on another card (or the first free of several, in the order given), same datacenter: a request only, the old pod is never touched (ADR-042 section 19)
        const pid = String(args.like_pod_id)
        const cards = [...new Set((Array.isArray(args.gpus) && args.gpus.length ? args.gpus : [args.gpu]).map((c) => String(c || '').trim()).filter(Boolean))]
        if (!cards.length) throw new Error('like_pod_id needs gpu (a card) or gpus (several cards, the first free one is used)')
        let noCard = null
        for (const card of cards) {
          const likeReq = await pods.requestLike(pid, card, undefined, cards.length > 1 ? 'alt' : undefined)
          try { const p = await pods.create(likeReq); const auto = applyAuto(p.id); console.error(`create_pod ${p.id} (${p.name}, ${p.gpu}) like ${pid} approved by ${String(args.approved_by).trim()}`); return json({ ...p, ...(auto ? { auto_sync: auto } : {}), like: pid, old_pod_untouched: true, config: pods.config(p.id), approved_by: String(args.approved_by).trim() }) }
          catch (e) { if (e?.code !== 'no_card') throw e; noCard = e }   // nothing was made: the next card
        }
        if (!args.retry_until_free) throw new Error(`${noCard.message}\n\nretry_until_free: true keeps trying until ${cards.length > 1 ? `one of ${cards.join(', ')} is` : `a ${cards[0]} is`} free in that datacenter (the old pod ${pid} is not touched; see pod_watch).`)
        const w = await pods.createLikeWhenFree(pid, cards, watchOpts(args))
        console.error(`create_pod like ${pid}: no card, waiting (${w.id}) approved by ${String(args.approved_by).trim()}`)
        return json({ waiting: true, message: `No card is free right now. Waiting: a new pod like ${pid} on ${cards.length > 1 ? `the first free of ${cards.join(', ')} (in that order; one pod is made)` : cards[0]} is tried every ${Math.round(w.every_s / 60)} min until a card is free (up to ${Math.round((Date.parse(w.give_up_at) - Date.parse(w.created_at)) / 3600000)} h). The old pod is not stopped or deleted. Cancel with pod_watch.`, watch: w, approved_by: String(args.approved_by).trim() })
      }
      const req = {
        name: args.name, gpu: args.gpu || mounts.load().default_gpu || gpus.DEFAULT_GPU, image: args.image || pool.imageChoice(mounts.load()), data_center_id: args.datacenter || null,
        idle_stop_minutes: args.idle_stop_minutes ?? null, apply_mounts: args.apply_mounts ?? null, config: args.config || null, ...(args.round ? { round: String(args.round) } : {}),
        ...(args.gpu_type_id ? { gpu_type_id: args.gpu_type_id } : {}), ...(args.gpu_count ? { gpu_count: Number(args.gpu_count) } : {}), ...(args.instance_type ? { instance_type: args.instance_type } : {}),
        ...(args.disk_gb != null ? { disk_gb: Number(args.disk_gb) } : {}), ...(args.volume_gb != null ? { volume_gb: Number(args.volume_gb) } : {}), ...(args.start_ssh != null ? { start_ssh: !!args.start_ssh } : {}), ...(args.start_jupyter ? { start_jupyter: true } : {}),
        ...(args.env_vars ? { env_vars: args.env_vars } : {}), ...(args.pip_requirements ? { pip_requirements: args.pip_requirements } : {}), ...(Array.isArray(args.custom_nodes) && args.custom_nodes.length ? { custom_nodes: args.custom_nodes } : {}),
      }
      const credentials = req.custom_nodes?.length ? await core.git.credentialsEnv(req.custom_nodes.map((n) => n.url || '')) : {}   // only the hosts the pod clones from, as the window does
      let p
      try { p = await pods.create(req, undefined, credentials) }
      catch (e) {
        if (e?.code !== 'no_card') throw e
        if (!args.retry_until_free) throw new Error(`${e.message}\n\nretry_until_free: true keeps trying the same create every few minutes until a card is free (one pod is made, never two; see pod_watch), or ask again with another gpu or datacenter.`)
        const w = pods.createWhenFree(req, watchOpts(args))
        console.error(`create_pod ${req.name}: no card, waiting (${w.id}) approved by ${String(args.approved_by).trim()}`)
        return json({ waiting: true, message: `No card is free right now. Waiting: the same create is tried every ${Math.round(w.every_s / 60)} min until a card is free (up to ${Math.round((Date.parse(w.give_up_at) - Date.parse(w.created_at)) / 3600000)} h). Cancel with pod_watch.`, watch: w, approved_by: String(args.approved_by).trim() })
      }
      const auto = applyAuto(p.id)
      console.error(`create_pod ${p.id} (${p.name}, ${p.gpu}) approved by ${String(args.approved_by).trim()}`)
      return json({ ...p, ...(auto ? { auto_sync: auto } : {}), config: pods.config(p.id), approved_by: String(args.approved_by).trim() })
    },
    stop_pod: async ({ pod_id }) => { const r = await pods.stop(pod_id); return text(`✓ Pod stopped: ${pod_id}\n${r.message}`) },
    resume_pod: async ({ pod_id, retry_until_free, every_minutes, give_up_hours }) => {
      try { const r = await pods.resume(pod_id); return text(`✓ Pod resumed: ${pod_id}\n${r.message}`) }
      catch (e) {
        const m = e?.message || String(e)
        if (e?.status !== 404 && (e?.code === 'host_full' || hostFull(m)) && retry_until_free) {
          const w = await pods.resumeWhenFree(pod_id, watchOpts({ every_minutes, give_up_hours }))
          return text(`⏳ Pod ${pod_id}: its host has no free GPU right now (RunPod: ${m}). Waiting: Resume is tried again every ${Math.round(w.every_s / 60)} min until it works (up to ${Math.round((Date.parse(w.give_up_at) - Date.parse(w.created_at)) / 3600000)} h). Nothing is deleted. Watch ${w.id}: follow or cancel it with pod_watch.`)
        }
        if (e?.status !== 404 && (e?.code === 'host_full' || hostFull(m))) return text(`✗ Pod ${pod_id} could not resume: RunPod pins a stopped pod to its host, and that host has no free card right now (RunPod: ${m}). Two ways on. (1) resume_pod again with retry_until_free: true: it keeps trying every few minutes until the host has a card, and nothing is deleted (follow it with pod_watch). (2) recreate_pod: a fresh pod with the same settings on a free host, and the network volume follows it; but this pod is terminated with its container disk, so only when nothing on that disk is needed (a pod with no network volume keeps its files only there).`, true)
        throw e
      }
    },
    delete_pod: async ({ pod_id }) => { const r = await pods.remove(pod_id); return text(`✓ Pod deleted: ${pod_id}\n${r.message}`) },
    recreate_pod: async ({ pod_id }) => {
      const fresh = await pods.recreate(pod_id)
      return json({ ...fresh, replaced: pod_id, config: pods.config(fresh.id) })
    },
    get_history: async ({ kind, limit }) => {
      if (kind != null && kind !== 'pod' && kind !== 'job') throw new Error("kind must be 'pod' or 'job'")
      return json(history.list({ ...(kind ? { kind } : {}), ...(limit ? { limit: Number(limit) } : {}) }))
    },
    get_spend_history: async () => json(history.spend()),
    get_comfy_runs: async ({ pod_id, saved, volume_id }) => {
      if (saved) return json(outputs.saved({ ...(pod_id ? { pod_id } : {}), ...(volume_id ? { volume_id } : {}) }))
      if (!pod_id) throw new Error('pod_id is required unless saved is true')
      return json(await comfyruns.runs(pod_id))
    },
    list_outputs: async ({ pod_id, volume_id, source, prefix, fresh, all, job, job_id, cancel_job }) => {
      if (job_id) return json(cancel_job ? outputsources.jobCancel(String(job_id)) : outputsources.jobStatus(String(job_id)))
      let ctx = { ...(pod_id ? { pod_id } : {}), ...(volume_id ? { volume_id } : {}) }
      if (pod_id) { try { const p = await pods.get(pod_id); ctx = { ...ctx, ...(p.shot ? { shot: p.shot } : {}), ...(p.round ? { round: p.round } : {}) } } catch { /* a pod that is gone: its saved runs still list */ } }
      return json(await outputsources.listOutputs(ctx, { ...(source ? { source } : {}), ...(prefix !== undefined ? { prefix: String(prefix) } : {}), ...(fresh ? { fresh: true } : {}), ...(all ? { all: true, ...(job ? { job: true } : {}), source: source || 'volume-s3' } : {}) }))
    },
    get_comfy_logs: async ({ pod_id, level, lines }) => json(await comfyruns.logs(pod_id, { ...(level ? { level } : {}), ...(lines ? { lines: Number(lines) } : {}) })),
    export_history: async ({ format, what }) => {
      if (format != null && format !== 'json' && format !== 'csv') throw new Error("format must be 'json' or 'csv'")
      if (what != null && what !== 'events' && what !== 'spend') throw new Error("what must be 'events' or 'spend'")
      const f = history.exportHistory({ format: format || 'json', what: what || 'events' })
      return text(`${f.name} (${f.mime})\n${f.text}`)
    },
    set_pod_round: async ({ pod_id, round }) => json(await pods.setRound(pod_id, String(round ?? ''))),
    set_pod_shot: async ({ pod_id, shot }) => json(await pods.setShot(String(pod_id), String(shot ?? ''))),
    delete_round: async ({ round }) => json(await pods.deleteRound(String(round ?? ''))),
    rename_round: async ({ round, name }) => json(await pods.renameRound(String(round ?? ''), String(name ?? ''))),
    rename_pod: async ({ pod_id, name }) => json(await pods.rename(pod_id, String(name ?? ''))),
    set_idle_stop: async ({ pod_id, minutes }) => {
      const r = await pods.setIdleStop(pod_id, Number(minutes))
      return json({ ...r, note: r.idle_stop_minutes ? `stopped after ${r.idle_stop_minutes} quiet minutes with nothing queued, while the app's idle watch runs` : 'never stopped for being idle' })
    },
    get_logs: async ({ pod_id, lines }) => {
      const n = Math.max(1, Math.min(Number(lines) || 100, 1000))
      await pods.get(pod_id)
      const out = []
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), LOG_WAIT_MS)
      try { await pods.logs(pod_id, { tail: n }, (e) => { out.push(e); if (out.length > n) out.shift() }, ac.signal) }
      finally { clearTimeout(timer); ac.abort() }
      if (!out.length) return text(`No log lines for ${pod_id} in ${LOG_WAIT_MS} ms`)
      return text(`Last ${out.length} line${out.length === 1 ? '' : 's'} of ${pod_id}:\n` + out.map((e) => `${e.ts ? e.ts + ' ' : ''}[${e.source}] ${e.line}`).join('\n'))
    },
    list_datacenters: async ({ fresh } = {}) => json(await pods.datacenters(undefined, !!fresh)),
    list_volumes: async () => json(await volumes.list()),
    create_volume: async (args) => {
      const refusal = governance.namedYes(args, 'create_volume')
      if (refusal) return text(refusal, true)
      const v = await volumes.create({ name: args.name, size_gb: Number(args.size_gb), datacenter: args.datacenter })
      console.error(`create_volume ${v.id} (${v.name}, ${v.size_gb} GB in ${v.datacenter}, USD ${v.cost_per_month}/month) approved by ${String(args.approved_by).trim()}`)
      return json({ ...v, approved_by: String(args.approved_by).trim() })
    },
    delete_volume: async ({ volume_id }) => { const r = await volumes.remove(volume_id); return text(`✓ Volume deleted: ${r.removed}${r.was_default ? '\nIt was the Default Configuration\'s volume: the configuration now has none (set_default_volume picks another).' : ''}`) },
    set_default_volume: async ({ volume_id }) => {
      const v = await volumes.useAsDefault(volume_id)
      const cfg = mounts.load()
      return json({ volume: v, configuration: { network_volume_id: cfg.network_volume_id, data_center_id: cfg.data_center_id } })
    },
    get_configuration: async () => {
      const cfg = mounts.load()
      const p = mounts.payload(cfg)
      return json({
        mode: p.mode, dry_run: p.dry_run, required: p.require, required_from: p.require_source, stored: p.stored, file: p.store,
        folders: p.folders.map((r) => ({ key: r.key, what: r.what, local: r.local || null, exists: r.exists, required: r.required, on_pod: r.container, mode: r.mode, custom: !!r.custom, in_mirror: r.mirror, declared: r.declared?.path ?? null })),
        volume: cfg.network_volume_id || null, datacenter: cfg.data_center_id || null, mount_path: cfg.mount_path, image: cfg.image, registry_auth: !!cfg.registry_auth_id,
        idle_stop_minutes: cfg.idle_stop_minutes, apply_by_default: cfg.apply_by_default,
        links: p.links.map((l) => `${l.path} -> ${l.target}`), env: cfg.env, pod_env: p.preview.env,
      })
    },
    sync: async (args) => {
      const pod_id = String(args.pod_id || '').trim()
      if (!pod_id) return text('sync needs pod_id', true)
      const running = syncHost.get(pod_id)
      if (running && !running.done) return text(`A sync is already running for ${pod_id} (${running.req.direction}, started ${running.started}): sync_status follows it`, true)
      const req = { pod_id, direction: args.direction === 'pull' ? 'pull' : 'push', only: Array.isArray(args.only) && args.only.length ? args.only.map(String) : undefined, plates: !!args.plates, approved_by: args.approved_by, ...(Array.isArray(args.shared) ? { shared: args.shared.map(String) } : {}), ...(args.skip_renders !== undefined ? { skip_renders: !!args.skip_renders } : {}), ...(args.skip_tests !== undefined ? { skip_tests: !!args.skip_tests } : {}), ...(Array.isArray(args.exclude) ? { exclude: args.exclude.map(String) } : {}), ...(args.delete_excluded !== undefined ? { delete_excluded: !!args.delete_excluded } : {}), ...(['update', 'size', 'checksum', 'replace'].includes(args.existing) ? { existing: args.existing } : {}) }
      await pods.get(pod_id)   // a clear 404; in no-spend mode the simulated copy would otherwise run for any id
      const steps = syncrun.planFor(req)   // refuses plates without the named yes, in the policy's words
      const transport = await syncrun.transportFor(pod_id)
      console.error(`sync ${req.direction} ${pod_id}: ${steps.map((s) => s.key).join(', ') || 'nothing to copy'} over ${transport.kind} (${transport.reason})`)
      if (!steps.length) return text(`Nothing to copy${req.only ? ` for ${req.only.join(', ')}` : ''}: map the folders in the Default Configuration first (get_configuration shows them)`, true)
      if (transport.kind === 'none') return text(transport.reason, true)
      const started = await syncHost.start(req, { steps, transport })
      if (!started.ok) return text(`A sync is already running for ${pod_id}: sync_status follows it`, true)
      const job = started.job
      if (req.plates) console.error(`sync push with plates for ${pod_id} approved by ${String(args.approved_by).trim()}`)
      return json({ pod_id, direction: req.direction, transport, steps, started: job.started, follow: 'sync_status' })
    },
    sync_status: async ({ pod_id }) => {
      const job = syncHost.get(String(pod_id || '').trim())
      if (!job) return json({ pod_id, running: false, done: false, message: `No sync started for ${pod_id} (nothing is running for it)` })
      return json(syncSummary(job))
    },
    adapter_spec: async () => text(imports.spec()),
    adapters_list: async () => json(await imports.list()),
    adapter_save: async ({ id, source }) => {
      const a = await imports.save(id, source)
      const problems = imports.validateSource(source, id)
      const head = problems.length ? `Structure problems (fix these and save again):\n${problems.map((p) => `- ${p}`).join('\n')}\n\n` : 'Structure ok. '
      return text(`${head}Saved ${a.id} (sha256 ${a.sha256.slice(0, 12)}…). Nothing was run. It is listed in Default Configuration > Import adapters, where the code can be read, edited or deleted. Test it with import_plan.`)
    },
    import_plan: async ({ source, adapter }) => {
      const p = await imports.plan(source, adapter || undefined)
      return json({ adapter: p.adapter, source: p.source, fenced: p.fenced, summary: p.summary, findings: p.findings, first_ops: p.ops.slice(0, 40), ops_total: p.ops.length })
    },
    import_apply: async ({ source, adapter, dry_run = true, overwrite = false }) => {
      const p = await imports.plan(source, adapter || undefined)
      const r = await imports.apply(p, { dryRun: dry_run !== false, overwrite: !!overwrite })
      return json({ adapter: p.adapter, dry_run: r.dry_run, ok: r.ok, counts: r.counts, record: r.record, findings: p.findings, problems: r.results.filter((x) => ['conflict', 'hash-mismatch', 'error'].includes(x.status)).slice(0, 30) })
    },
    get_credits: async () => json({ credits: await pods.credits() }),
    cost_now: async () => {
      const [all, vols] = await Promise.all([pods.list(), volumes.list()])
      const billing = all.filter((p) => p.status === 'running' || p.status === 'starting')   // a starting pod is already billed
      const priced = await Promise.all(billing.map(async (p) => {
        let cost = null
        try { cost = (await pods.details(p.id)).cost_per_hr } catch { /* no details: the sum says what it could price */ }
        return { id: p.id, name: p.name, status: p.status, gpu: p.gpu, cost_per_hr: cost }
      }))
      return json({
        currency: 'USD', pods_per_hour: round2(priced.reduce((s, p) => s + (p.cost_per_hr ?? 0), 0)), running_pods: priced,
        unpriced_pods: priced.filter((p) => p.cost_per_hr == null).map((p) => p.id),
        volumes_per_month: round2(vols.reduce((s, v) => s + (v.cost_per_month || 0), 0)), volumes: vols.map((v) => ({ id: v.id, name: v.name, size_gb: v.size_gb, datacenter: v.datacenter, cost_per_month: v.cost_per_month })),
        spend_cap_usd: governance.spendCap() || null,
      })
    },
  }

  /** A fresh SDK server with every handler; one per connection (stdio: one; HTTP: one per request, transport.mjs). */
  function makeServer() {
    const server = new Server({ name: 'comfy-moe-server', version }, {
      capabilities: { tools: {}, resources: {} },
      instructions: governance.instructions() + (docs.root() ? '\n\n---\nThe README and our documentation (the ADRs, setup, MCP, workflows) are readable here: call the docs tool (no arguments lists the pages, page reads one, search finds text), or read the docs:// resources.\nAnything the app window can do has a tool here (docs/ADR-028); list_pods, list_datacenters and get_configuration are the quick look.' : '\n\n---\nAnything the app window can do has a tool here (docs/ADR-028).'),   // applied to every client at initialize
    })

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const handler = HANDLERS[params.name]
      if (!handler) return text(`Unknown tool: ${params.name}`, true)
      try {
        const args = params.arguments || {}
        const client = server.getClientVersion?.()?.name
        const who = { source: 'mcp', tool: params.name, ...(typeof client === 'string' && client ? { client: client.slice(0, 80) } : {}), ...(typeof args.approved_by === 'string' && args.approved_by.trim() ? { approved_by: args.approved_by.trim() } : {}) }
        return await (history?.runAs ? history.runAs(who, () => handler(args)) : handler(args))   // what the tool records in the history says it came from MCP
      } catch (e) {
        const message = e?.message || String(e)
        if (typeof e?.status === 'number') return text(message, true)   // the core's own refusal: "Agent not found: x", "No card available right now: tried ..."
        console.error(`Tool error: ${params.name}: ${message}`)
        return text(`Error executing ${params.name}: ${message}`, true)
      }
    })

    // Every governance page, as governance://<page>.
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        ...governance.listing().map((p) => ({ uri: p.uri, name: p.name, mimeType: 'text/markdown', description: "shared/governance: Binc's policies, copied from the CANALV2 tree" })),
        ...docs.listing().map((p) => ({ uri: p.uri, name: p.name, mimeType: 'text/markdown', description: p.title })),   // the README and our documentation (docs/ADR-028)
      ],
    }))
    server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
      if (String(params.uri).startsWith('docs://')) {
        const d = docs.read(params.uri)
        if (d == null) throw new Error(`No such documentation page: ${docs.uriToName(params.uri)}`)
        return { contents: [{ uri: params.uri, mimeType: 'text/markdown', text: d }] }
      }
      const name = governance.uriToName(String(params.uri))
      const t = governance.read(name)
      if (t == null) throw new Error(`No such governance page: ${name}`)
      return { contents: [{ uri: params.uri, mimeType: 'text/markdown', text: t }] }
    })
    return server
  }
    return makeServer()
}

/** stdio (or --http <port>): the core by path, the settings the panel saved, then serve. */
export async function main() {
  const core = await loadCore()
  core.settings.applyToEnv()   // the key the panel saved, when the shell exported none; no key is fine in no-spend mode
  const syncHost = privateSyncHost(core)
  const served = await serve(() => createPodManagerServer({ core, syncHost }))
  console.error(`comfy-moe-server ${version} on ${served.text}; governance from ${core.governance.folder() || 'nowhere'}; ${core.pool.dryRun() ? 'no-spend mode' : process.env.RUNPOD_API_KEY ? 'live' : 'no RUNPOD_API_KEY: pod tools will refuse until one is set'}`)
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e?.stack || e); process.exit(1) })
