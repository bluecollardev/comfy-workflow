// The MCP tools for everything the window does that server.mjs did not already cover (docs/ADR-028: anything the app can do, the MCP can do).
// Each tool is a thin call into the same core function the window's IPC channel calls (electron/core.cjs TABLE); mcp/parity.mjs says which tool answers which channel.
// Spend is gated with the named yes (governance.namedYes); the pod manager's own keys and settings are not (ADR-028, decision 6); the no-spend switch is never settable here.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import * as docs from './docs.mjs'

const obj = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) })
const S = (description, extra = {}) => ({ type: 'string', description, ...extra })
const N = (description, extra = {}) => ({ type: 'integer', description, ...extra })
const B = (description) => ({ type: 'boolean', description })
const O = (description) => ({ type: 'object', description })

/** A patch over a configuration: objects (folders, env, required, mcp_http) merge by key, everything else replaces. `dry_run` (no-spend) is never taken from a patch. */
export function mergeConfig(base, patch) {
  if (patch && 'dry_run' in patch) throw Object.assign(new Error('The no-spend switch (dry_run) is not settable over MCP: it is the safety, set it in the app.'), { status: 400 })
  const out = { ...base }
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = { ...base[k], ...v }
    else out[k] = v
  }
  return out
}

/** The settings `set_settings` takes, by field. A value of null removes it. */
export const SETTING_FIELDS = ['runpod_api_key', 'anthropic_api_key', 'runpod_s3_access_key', 'runpod_s3_secret_key', 'panama_aws_access_key', 'panama_aws_secret_key', 'panama_console_key', 'panama_bucket', 'panama_region', 'panama_profile']

const MAX_FILE = 2 * 1024 * 1024

export function appTools({ core, governance, text, json, plain = text }) {
  const { mounts, pods, volumes, settings, configio, panama, podpull, runflows, imports, studio, images, git, repositories, remote, mcp } = core
  const yes = (args, what) => governance.namedYes(args, what)
  const approved = obj({ approved_by: S('Who said yes to this spend. Required; never guessed.') })
  const absolutePath = (p, what) => { if (!p || !isAbsolute(p)) throw Object.assign(new Error(`${what} must be an absolute path`), { status: 400 }); return p }
  const target = { type: 'string', enum: ['local', 'pod'], default: 'local', description: 'local = staged on this PC; pod = staged on the network volume by a pod (a pod download may start a pod: needs approved_by)' }
  const pickPanama = (args) => (args.target === 'pod' ? podpull : panama)
  const summaryOf = (cfg) => { const p = mounts.payload(cfg); return { mode: p.mode, volume: cfg.network_volume_id || null, datacenter: cfg.data_center_id || null, image: cfg.image, idle_stop_minutes: cfg.idle_stop_minutes, apply_by_default: cfg.apply_by_default, folders: p.folders.map((r) => ({ key: r.key, local: r.local || null, on_pod: r.container })) } }

  const T = [
    // ---------- pods ----------
    { name: 'list_gpus', description: "The card menu with what RunPod has in stock and the on-demand price, for a datacenter (or the volume's, or anywhere): the table's cards, big ones included (explicit-only, ADR-026)", inputSchema: obj({ datacenter: S('Datacenter id (list_datacenters); omit for the configured volume\'s, else anywhere') }),
      run: async ({ datacenter }) => json(await pods.gpuMenu(undefined, datacenter || undefined)) },
    { name: 'get_volume_info', description: "The network volume a pod would use (the configured one, or the one named): size, datacenter, cost", inputSchema: obj({ volume_id: S('Volume ID; omit for the configured one') }),
      run: async ({ volume_id }) => json(await pods.volumeInfo(volume_id || undefined)) },
    { name: 'get_pod_config', description: "A pod's own configuration (the Default Configuration's shape, kept for recreate_pod), or null when it uses the Default Configuration", inputSchema: obj({ pod_id: S('Pod ID') }, ['pod_id']),
      run: async ({ pod_id }) => { await pods.get(pod_id); const c = pods.config(pod_id); return json({ pod_id, custom_config: !!c, config: c, note: c ? undefined : 'This pod uses the Default Configuration (get_configuration).' }) } },
    { name: 'set_pod_config', description: "Change a pod's own configuration: a patch over its current one (or the Default Configuration), or reset it back to the default. It is kept for recreate_pod; most of it (volume, env, links, image) reaches a pod only when it is made, so pass recreate=true to apply it now (that makes a new pod: spends, needs approved_by). dry_run is never settable.",
      inputSchema: obj({ pod_id: S('Pod ID'), patch: O('Fields to change, in the Default Configuration\'s shape (get_configuration); objects merge by key'), reset: B('Go back to the Default Configuration'), recreate: B('Then recreate the pod with it (spends)'), approved_by: approved.properties.approved_by }, ['pod_id']),
      run: async (args) => {
        await pods.get(args.pod_id)
        if (args.recreate) { const refusal = yes(args, 'set_pod_config with recreate'); if (refusal) return text(refusal, true) }
        let saved
        if (args.reset) saved = pods.setConfig(args.pod_id, null)
        else saved = pods.setConfig(args.pod_id, mergeConfig(pods.config(args.pod_id) || mounts.load(), args.patch || {}))
        const fresh = args.recreate ? await pods.recreate(args.pod_id) : null
        return json({ ...saved, config: saved.config ? summaryOf(saved.config) : null, recreated_as: fresh ? fresh.id : null })
      } },

    // ---------- the Default Configuration and the keys ----------
    { name: 'set_configuration', description: 'Change the Default Configuration: a patch (objects such as folders, env, required merge by key; lists and the rest replace). Same validation as the window. dry_run (no-spend) is never settable. Returns the saved summary.',
      inputSchema: obj({ patch: O('Fields to change, as get_configuration shows them: folders {key: path}, network_volume_id, data_center_id, mount_path, image, registry_auth_id, idle_stop_minutes, apply_by_default, env {NAME: value}, links, custom, required, sync_shared, pull_shared, pull_any_card, mcp_http ...') }, ['patch']),
      run: async ({ patch }) => { const saved = mounts.put(mergeConfig(mounts.load(), patch || {})); return json({ saved: true, configuration: summaryOf(mounts.load()), warnings: saved.warnings ?? undefined }) } },
    { name: 'preview_configuration', description: 'What a pod would get from a configuration without saving it: the env and the links. A patch over the Default Configuration, or none for the saved one', inputSchema: obj({ patch: O('Fields to change') }),
      run: async ({ patch }) => json(mounts.preview(mergeConfig(mounts.load(), patch || {}))) },
    { name: 'reset_configuration', description: 'Delete the saved Default Configuration and go back to the defaults (the keys and settings are separate and stay)', inputSchema: obj(),
      run: async () => json({ reset: true, configuration: summaryOf(mounts.reset()) }) },
    { name: 'get_local_env', description: "The shell lines (export NAME=...) that set this PC up like a pod: the mapped folders as variables, for a terminal or an IDE run configuration", inputSchema: obj(),
      run: async () => json(mounts.envLines(mounts.load())) },
    { name: 'list_dirs', description: "The folders on this PC under a path (the window's folder picker), for choosing what to map", inputSchema: obj({ path: S('Absolute path; omit for the home folder'), hidden: B('Include dot folders') }),
      run: async ({ path, hidden }) => json(core.listDirs(path || '', !!hidden)) },
    { name: 'get_settings', description: 'The API keys and settings: whether each key is set and its last four characters, never a value; the Panama bucket, region and profile', inputSchema: obj(),
      run: async () => json(settings.get()) },
    { name: 'set_settings', description: `Set or remove the pod manager's own keys and settings: ${SETTING_FIELDS.join(', ')}. A string sets it, null removes it. Values are never returned (get_settings shows the last four characters). A key typed here is in this conversation's transcript: prefer entering it in the app if that matters. The no-spend switch is not a setting here.`,
      inputSchema: obj({ values: { type: 'object', description: 'field -> value or null', properties: Object.fromEntries(SETTING_FIELDS.map((f) => [f, { type: ['string', 'null'] }])), additionalProperties: false } }, ['values']),
      run: async ({ values }) => {
        const unknown = Object.keys(values || {}).filter((k) => !SETTING_FIELDS.includes(k))
        if (unknown.length) return text(`Not a setting: ${unknown.join(', ')}. Settings: ${SETTING_FIELDS.join(', ')}`, true)
        const after = settings.set(values)
        return json({ changed: Object.keys(values), settings: after })
      } },
    { name: 'check_anthropic_key', description: 'Whether the Anthropic key (the one saved, or one passed to try) is accepted; used by the adapter drafting and describing tools', inputSchema: obj({ key: S('A key to try without saving it') }),
      run: async ({ key }) => json(await settings.checkAnthropic(key || null)) },
    { name: 'config_export', description: 'The Default Configuration as the JSON the window exports (folders, volume, image, env, adapters list, ...). Keys and tokens are left out unless a file path is given: then the whole file, secrets included, is written there (mode 600) and not returned',
      inputSchema: obj({ file: S('Absolute path to write; with it, secrets are included'), include_secrets: B('With file: leave them out when false (default true)') }),
      run: async ({ file, include_secrets }) => {
        if (!file) return json({ file: null, suggested_name: configio.suggestedName(), config: configio.exportConfig({ includeSecrets: false }) })
        absolutePath(file, 'file')
        writeFileSync(file, JSON.stringify(configio.exportConfig({ includeSecrets: include_secrets !== false }), null, 2) + '\n', { mode: 0o600 })
        return json({ file, secrets_included: include_secrets !== false })
      } },
    { name: 'config_import_plan', description: 'What importing a configuration file would change, section by section (nothing is written): the folders (paths from another machine are flagged), the pod defaults, the keys (names and last four characters only)', inputSchema: obj({ file: S('Absolute path of the JSON file') }, ['file']),
      run: async ({ file }) => json(configio.planImport(readJsonFile(file))) },
    { name: 'config_import_apply', description: 'Import a configuration file: backs up first, then applies the sections named (default: the ones the plan ticks). dry_run defaults to true and only plans', inputSchema: obj({ file: S('Absolute path of the JSON file'), sections: { type: 'array', items: { type: 'string' }, description: 'Section keys from config_import_plan; omit for the ticked ones' }, dry_run: B('default true') }, ['file']),
      run: async ({ file, sections, dry_run = true }) => {
        const data = readJsonFile(file), plan = configio.planImport(data)
        if (dry_run !== false) return json({ dry_run: true, plan })
        const chosen = Array.isArray(sections) && sections.length ? sections : plan.sections.filter((s) => s.default_checked).map((s) => s.key)
        return json({ dry_run: false, sections: chosen, result: configio.applyImport(data, { sections: chosen }) })
      } },
    { name: 'config_undo', description: 'Undo the last configuration import from its backup', inputSchema: obj(), run: async () => json(configio.undoImport()) },
    { name: 'config_backups', description: 'The backups of the configuration that imports made', inputSchema: obj(), run: async () => json(configio.listBackups()) },

    // ---------- volumes ----------
    { name: 'resize_volume', description: `Grow a network volume (RunPod only grows them; billed monthly, USD 0.07 per GB). Spends money: needs approved_by (cap USD ${governance.SPEND_CAP_USD}). Create one in a chosen datacenter with create_volume`,
      inputSchema: obj({ approved_by: approved.properties.approved_by, volume_id: S('Volume ID (list_volumes)'), size_gb: N('The new size in GB, larger than now') }, ['volume_id', 'size_gb']),
      run: async (args) => {
        const refusal = yes(args, 'resize_volume'); if (refusal) return text(refusal, true)
        const v = await volumes.resize(args.volume_id, Number(args.size_gb))
        console.error(`resize_volume ${v.id} to ${v.size_gb} GB approved by ${String(args.approved_by).trim()}`)
        return json({ ...v, approved_by: String(args.approved_by).trim() })
      } },

    // ---------- Panama / BH ----------
    { name: 'panama_status', description: 'Is the BH exchange bucket reachable: the bucket, region, how it is read (the keys in the app or an AWS profile), where rounds are staged on this PC, and whether Pod mode is available', inputSchema: obj(), run: async () => json(panama.status()) },
    { name: 'panama_rounds', description: 'The delivery rounds in the bucket with what is staged: on this PC (target local) or on the network volume as last seen by a pod (target pod). Per round: state (none, partial, unverified, complete), files present and expected, bytes', inputSchema: obj({ target }),
      run: async (args) => json(args.target === 'pod' ? await podpull.rounds() : panama.rounds()) },
    { name: 'panama_round_files', description: "One round's files in the bucket as a folder tree (read-only), each marked when already on this PC. Folders carry totals. Narrow with prefix; the list is cut at limit", inputSchema: obj({ round: S('Round name'), prefix: S('Only paths under this folder'), limit: N('At most this many entries (default 300)') }, ['round']),
      run: async ({ round, prefix, limit }) => {
        const r = panama.files(round), p = String(prefix || '').replace(/^\/+|\/+$/g, '')
        const all = p ? r.entries.filter((e) => e.path === p || e.path.startsWith(`${p}/`)) : r.entries
        const n = Math.max(1, Math.min(Number(limit) || 300, 5000))
        return json({ round, files: r.files, bytes: r.bytes, shown: Math.min(all.length, n), matching: all.length, entries: all.slice(0, n) })
      } },
    { name: 'panama_round_size', description: 'Files and bytes in one round (a listing; a big round takes a few seconds)', inputSchema: obj({ round: S('Round name') }, ['round']), run: async ({ round }) => json(panama.size(round)) },
    { name: 'panama_pod_plan', description: 'What a pod download of a round would do before it does it: use a pod of yours or start a short-lived one, its card and price, the volume, the size, the ceiling in minutes', inputSchema: obj({ round: S('Round name'), route: S("'current' (your pod on the volume, started first if it is off) or 'temporary' (a sync-agent pod of the cheapest card). Default: your pod if it runs, else temporary") }, ['round']), run: async ({ round, route }) => json(await podpull.plan(round, route ? { route } : {})) },
    { name: 'panama_pull', description: 'Download a round: to this PC (aws s3 sync, resumable, never deletes) or onto the network volume by a pod. Returns a job; follow it with panama_job. A pod download may start a pod: needs approved_by',
      inputSchema: obj({ round: S('Round name'), target, route: S("Pod downloads: 'current' (your pod, started first if off) or 'temporary' (sync-agent pod, cheapest card)"), approved_by: approved.properties.approved_by }, ['round']),
      run: async (args) => {
        if (args.target === 'pod') { const refusal = yes(args, 'panama_pull on a pod'); if (refusal) return text(refusal, true); console.error(`panama_pull ${args.round} on a pod approved by ${String(args.approved_by).trim()}`) }
        return json(args.target === 'pod' ? await podpull.pull(args.round, args.route ? { route: args.route } : {}) : panama.pull(args.round))
      } },
    { name: 'panama_job', description: 'Where a download (or delete) is: state, files, bytes done of total, rate, the latest files', inputSchema: obj({ id: S('Job id from panama_pull'), target }, ['id']),
      run: async (args) => { const j = pickPanama(args).job(args.id); return j ? json(j) : text(`No such job: ${args.id}`, true) } },
    { name: 'panama_cancel', description: 'Stop a download; what is already there stays and a later pull resumes', inputSchema: obj({ id: S('Job id'), target }, ['id']), run: async (args) => json(pickPanama(args).cancel(args.id)) },
    { name: 'panama_remove', description: "Delete a round's staged copy: on this PC, or on the volume by a pod (needs approved_by: it uses a pod). The bucket is read-only and never touched", inputSchema: obj({ round: S('Round name'), target, approved_by: approved.properties.approved_by }, ['round']),
      run: async (args) => {
        if (args.target === 'pod') { const refusal = yes(args, 'panama_remove on a pod'); if (refusal) return text(refusal, true); return json(await podpull.remove(args.round)) }
        return json(panama.remove(args.round))
      } },
    { name: 'list_pod_workflows', description: "The graphs in a running pod's Workflows panel (its comfy-shared/workflows), grouped by folder (a shot or a round). What the Run workflows window lists (ADR-037)", inputSchema: obj({ pod_id: S('A running pod') }, ['pod_id']), run: async ({ pod_id }) => json(await runflows.list(pod_id)) },
    { name: 'run_pod_workflows', description: "Run chosen graphs from a pod's Workflows panel on that pod, one after another (ADR-037). Each UI graph is converted with ComfyUI's own frontend (on the pod if its image has it, else Chrome on this PC), queued and waited for; locked shots are refused. Every outcome and error is written to the History. Returns a job: follow it with run_workflows_job. Runs on a pod that is already billing: needs approved_by", inputSchema: obj({ pod_id: S('A running pod'), paths: { type: 'array', items: { type: 'string' }, description: 'Panel paths from list_pod_workflows, e.g. rounds/<round>/<shot>/graph.json' }, approved_by: approved.properties.approved_by }, ['pod_id', 'paths']),
      run: async (args) => { const refusal = yes(args, 'run_pod_workflows'); if (refusal) return text(refusal, true); console.error(`run_pod_workflows on ${args.pod_id} (${(args.paths || []).length} graphs) approved by ${String(args.approved_by).trim()}`); return json(await runflows.run(args.pod_id, args.paths || [], { approvedBy: String(args.approved_by).trim() })) } },
    { name: 'run_workflows_job', description: 'Where a run_pod_workflows job is: each graph waiting, running, done, failed (with the error) or skipped; cancel: true stops it (the running graph is interrupted)', inputSchema: obj({ id: S('Job id from run_pod_workflows'), cancel: B('Stop the job') }, ['id']), run: async ({ id, cancel }) => { const j = cancel ? runflows.cancel(id) : runflows.job(id); return j ? json(j) : text(`No such run: ${id}`, true) } },
    { name: 'panama_place', description: "Put a round that a pod has pulled where its graphs look (ADR-033), on a running pod of yours: its inputs linked into input/rounds/<round>/ (and at the shipped path when free, a differing file is a conflict, never replaced), each loaded file also hard-linked at the top of input/ under a unique name (ComfyUI's dropdown lists only top-level files), and path-corrected copies of its graphs in workflows/rounds/<round>/ (the originals stay in the round folder, not in the panel). A pod pull does this by itself once its check passes; this is for a round pulled before, or to re-run. dry_run (default true) reads and reports, writes nothing. Idempotent",
      inputSchema: obj({ round: S('Round name'), pod_id: S('A running pod (default: the running pod of yours on the configured volume)'), dry_run: B('default true: report only') }, ['round']),
      run: async ({ round, pod_id, dry_run = true }) => json(await podpull.placeRound(round, { pod_id: pod_id || undefined, dry_run: dry_run !== false })) },
    { name: 'panama_import', description: "Import a downloaded round into ComfyUI-Shared (the window's Use): plans it through an adapter, and applies unless dry_run (default true). The round must be staged on this PC (panama_pull)", inputSchema: obj({ round: S('Round name'), adapter: S('Adapter id (default: the best match)'), dry_run: B('default true'), overwrite: B('Replace differing files') }, ['round']),
      run: async ({ round, adapter, dry_run = true, overwrite = false }) => {
        const dir = `${panama.stagingDir()}/${round}`
        if (!existsSync(dir)) return text(`${round} is not staged on this PC (${dir}): panama_pull it first`, true)
        const p = await imports.plan(dir, adapter || undefined)
        const r = await imports.apply(p, { dryRun: dry_run !== false, overwrite: !!overwrite })
        return json({ round, adapter: p.adapter, dry_run: r.dry_run, ok: r.ok, counts: r.counts, record: r.record, findings: p.findings, problems: r.results.filter((x) => ['conflict', 'hash-mismatch', 'error'].includes(x.status)).slice(0, 30) })
      } },

    // ---------- import: adapters, packages, zips ----------
    { name: 'import_detect', description: 'Which adapters recognise a package, best first, with a match score. The source is a folder or a .zip (unpacked once)', inputSchema: obj({ source: S('Absolute path of a folder or a .zip') }, ['source']),
      run: async ({ source }) => json(await imports.detect(imports.prepareSource(absolutePath(source, 'source')))) },
    { name: 'package_summary', description: "A package at a glance (the window's description input): file counts, folders, sample files. Folder or .zip", inputSchema: obj({ source: S('Absolute path of a folder or a .zip') }, ['source']),
      run: async ({ source }) => { const { _texts, ...rest } = imports.draftPreview(imports.prepareSource(absolutePath(source, 'source'))); return json(rest) } },
    { name: 'package_tree', description: "A package as a file tree (the Adapter Studio's explorer). Folder or .zip", inputSchema: obj({ source: S('Absolute path of a folder or a .zip') }, ['source']),
      run: async ({ source }) => json(studio.packageTree(imports.prepareSource(absolutePath(source, 'source')))) },
    { name: 'package_file', description: 'Read one file of a package, as the Adapter Studio shows it (text, or what it is). Folder or .zip', inputSchema: obj({ source: S('Absolute path of a folder or a .zip'), path: S('Path inside the package') }, ['source', 'path']),
      run: async ({ source, path }) => json(studio.readPackageFile(imports.prepareSource(absolutePath(source, 'source')), path)) },
    { name: 'package_describe', description: 'A written description of a package from Claude (needs the Anthropic key; sends file names and small text files to Anthropic). Folder or .zip', inputSchema: obj({ source: S('Absolute path of a folder or a .zip') }, ['source']),
      run: async ({ source }) => json(await imports.describe(imports.prepareSource(absolutePath(source, 'source')))) },
    { name: 'adapter_draft', description: 'Have Claude draft an adapter for a package (needs the Anthropic key). Returns the adapter, whether it is valid and the model; save it with adapter_save to keep a changed one', inputSchema: obj({ source: S('Absolute path of a folder or a .zip'), id: S('Adapter id to draft into (optional)') }, ['source']),
      run: async ({ source, id }) => json(await imports.draft(imports.prepareSource(absolutePath(source, 'source')), id ? { id } : {})) },
    { name: 'adapter_document', description: "Have Claude write the documentation header an adapter must carry (needs the Anthropic key). Returns the adapter with its header; the code is saved with it", inputSchema: obj({ id: S('Adapter id') }, ['id']),
      run: async ({ id }) => json(await studio.documentAdapter(id)) },
    { name: 'adapter_problems', description: "Check an adapter's code: its structure problems and, with a package, whether a test plan on it runs", inputSchema: obj({ id: S('Adapter id'), source: S('Absolute path of a package (folder or .zip) to test it on') }, ['id']),
      run: async ({ id, source }) => json(await studio.problems(id, source ? imports.prepareSource(absolutePath(source, 'source')) : null)) },
    { name: 'adapter_manage', description: "The adapters' housekeeping the Adapter Studio does: source (read the code), remove (a user's own, or reset a built-in override), template (a starter module), duplicate (from_id to id), get_prompt / save_prompt (the drafting prompt kept with it), rename (id and/or name), history (earlier versions), validate (check source text)",
      inputSchema: obj({ action: S('One of source, remove, template, duplicate, get_prompt, save_prompt, rename, history, validate', { enum: ['source', 'remove', 'template', 'duplicate', 'get_prompt', 'save_prompt', 'rename', 'history', 'validate'] }), id: S('Adapter id'), from_id: S('duplicate: the adapter to copy'), name: S('template / rename: a display name'), new_id: S('rename: the new id'), text: S('save_prompt / validate: the text') }, ['action']),
      run: async (a) => {
        switch (a.action) {
          case 'source': return json(imports.source(a.id))
          case 'remove': return json(imports.remove(a.id))
          case 'template': return text(imports.template(a.id, a.name || undefined))
          case 'duplicate': return json({ id: a.id, code: imports.duplicate(a.from_id, a.id) })
          case 'get_prompt': return text(imports.getPrompt(a.id))
          case 'save_prompt': return json(imports.savePrompt(a.id, a.text || ''))
          case 'rename': return json(await imports.rename(a.id, { id: a.new_id || undefined, name: a.name || undefined }))
          case 'history': return json(imports.history(a.id))
          case 'validate': return json({ problems: imports.validateSource(a.text || '', a.id || undefined) })
          default: return text(`Unknown action: ${a.action}`, true)
        }
      } },
    { name: 'sync_after', description: 'What to sync to a pod after an import (the follow-up the window offers): the folders and the pod, or why nothing', inputSchema: obj({ pod_id: S('Pod ID; omit for the running one') }), run: async ({ pod_id }) => json(imports.syncAfter(pod_id || null)) },

    // ---------- images, git, repositories, remote, MCP ----------
    { name: 'image_env', description: "The ENV and ARG lines of the pod image (or the repo's Dockerfile) the form can load as pod environment", inputSchema: obj({ source: S('"image" or "dockerfile"'), image: S('An image reference') }), run: async (a) => json(await images.env({ source: a.source, image: a.image })) },
    { name: 'image_dockerfile', description: 'The Dockerfile an image was built from (read from its registry), for the image menu', inputSchema: obj({ image: S('An image reference') }), run: async (a) => json(await images.dockerfile({ image: a.image })) },
    { name: 'git_accounts', description: 'The git accounts connected (GitHub etc.): list, disconnect one, or list its repositories (q filters). Connecting one is an OAuth round trip in a browser: the window', inputSchema: obj({ action: S('list, disconnect or repos', { enum: ['list', 'disconnect', 'repos'] }), id: S('Account id'), q: S('repos: a filter') }, ['action']),
      run: async (a) => { if (a.action === 'disconnect') { git.disconnect(a.id); return json({ disconnected: a.id }) } return json(a.action === 'repos' ? await git.listRepos(a.id, a.q || '') : git.listAccounts()) } },
    { name: 'repositories', description: 'The repositories attached to pods: list, add (url, branch), remove, search (GitHub), branches (of a url), folders (of a url and branch)', inputSchema: obj({ action: S('list, add, remove, search, branches, folders', { enum: ['list', 'add', 'remove', 'search', 'branches', 'folders'] }), url: S('Repository URL'), branch: S('Branch'), id: S('remove: repository id'), q: S('search: a query') }, ['action']),
      run: async (a) => {
        switch (a.action) {
          case 'list': return json(repositories.list())
          case 'add': return json(await repositories.add(a.url, a.branch || null))
          case 'remove': repositories.remove(a.id); return json({ removed: a.id })
          case 'search': return json(await repositories.search(a.q || ''))
          case 'branches': return json(await repositories.branches(a.url))
          case 'folders': return json(await repositories.folders(a.url, a.branch || 'main'))
          default: return text(`Unknown action: ${a.action}`, true)
        }
      } },
    { name: 'remote_mcp', description: "The MCP servers this app uses (BH's console): status, or check (ask it for its tools). Its key is a setting: set_settings panama_console_key", inputSchema: obj({ action: S('status or check', { enum: ['status', 'check'] }) }, ['action']),
      run: async ({ action }) => json(action === 'check' ? await remote.check() : remote.status()) },
    { name: 'mcp_endpoints', description: "The two MCP endpoints the app offers (this pod manager and the ComfyUI bridge) with their client configuration snippets, and what the bridge can point at. Serving them from the app and probing them is the window's Connect tab", inputSchema: obj({ comfy: S('A ComfyUI URL for the bridge snippet') }),
      run: async ({ comfy }) => json({ endpoints: mcp.endpoints({ comfy: comfy || null, served: {} }), targets: await mcp.targets() }) },

    // ---------- the README and the documentation ----------
    { name: 'docs', description: 'Our README, changelog and documentation (docs/*.md: the ADRs, setup, MCP, workflows). No arguments: the list. page: read one (README.md, docs/ADR-028-....md). search: matching lines across them. Not the client-job pages (the public docs site leaves those out too)',
      inputSchema: obj({ page: S('A page name from the list, or its docs:// uri'), search: S('Text to find') }),
      run: async ({ page, search }) => {
        if (!docs.root()) return plain('The documentation is not available here: it is read from the repository checkout (or COMFY_REPO_ROOT), and this server has none.', true)
        if (search) return plain({ query: search, matches: docs.search(search) })
        if (!page) return plain(docs.listing().map(({ name, title, bytes }) => ({ name, title, bytes })))
        const t = docs.read(page)
        return t == null ? plain(`No such page: ${page}. Pages: ${docs.listing().map((p) => p.name).join(', ')}`, true) : plain(t)
      } },
  ]

  const readJsonFile = (file) => {
    absolutePath(file, 'file')
    if (!existsSync(file) || !statSync(file).isFile()) throw Object.assign(new Error(`not a file: ${file}`), { status: 400 })
    if (statSync(file).size > MAX_FILE) throw Object.assign(new Error('That is not a configuration file (too large)'), { status: 400 })
    try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { throw Object.assign(new Error(`not valid JSON: ${e.message}`), { status: 400 }) }
  }

  return { tools: T.map(({ run, ...def }) => def), handlers: Object.fromEntries(T.map((t) => [t.name, t.run])) }
}
