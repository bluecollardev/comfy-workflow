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
export const SETTING_FIELDS = ['runpod_api_key', 'anthropic_api_key', 'hf_token', 'runpod_s3_access_key', 'runpod_s3_secret_key', 'panama_aws_access_key', 'panama_aws_secret_key', 'panama_console_key', 'panama_bucket', 'panama_region', 'panama_profile', 'agent_named_yes_required', 'agent_spend_cap_usd', 'agent_shell_guard']

const MAX_FILE = 2 * 1024 * 1024

export function appTools({ core, governance, text, json, plain = text }) {
  const { hf, wantedmodels, mounts, pods, volumes, settings, configio, panama, podpull, runflows, chunking, queue, imports, studio, images, git, repositories, remote, mcp } = core
  const yes = (args, what) => governance.namedYes(args, what)
  const approved = obj({ approved_by: S('Who said yes to this spend. Only needed when the named-yes setting is on (set_settings agent_named_yes_required); never guessed.') })
  const absolutePath = (p, what) => { if (!p || !isAbsolute(p)) throw Object.assign(new Error(`${what} must be an absolute path`), { status: 400 }); return p }
  const target = { type: 'string', enum: ['local', 'pod'], default: 'local', description: 'local = staged on this PC; pod = staged on the network volume by a pod (a pod download may start a pod: approved_by (only when the named-yes setting is on))' }
  const volumes_job = { browse: (id, path) => podpull.browseVolume(id, path ? { path } : {}), erase: (id, keys, o) => podpull.eraseVolume(id, keys, o) }
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
    { name: 'set_pod_config', description: "Change a pod's own configuration: a patch over its current one (or the Default Configuration), or reset it back to the default. It is kept for recreate_pod; most of it (volume, env, links, image) reaches a pod only when it is made, so pass recreate=true to apply it now (that makes a new pod: spends, approved_by (only when the named-yes setting is on)). dry_run is never settable.",
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
      inputSchema: obj({ patch: O('Fields to change, as get_configuration shows them: folders {key: path}, network_volume_id, data_center_id, mount_path, image, registry_auth_id, idle_stop_minutes, apply_by_default, env {NAME: value}, links, custom, required, sync_shared, pull_shared, pull_any_card, default_gpu (the card a new pod gets when none is named: a table key or auto), mcp_http ...') }, ['patch']),
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
    { name: 'set_settings', description: `Set or remove the pod manager's own keys and settings: ${SETTING_FIELDS.join(', ')}. A string sets it, null removes it (agent_named_yes_required is true or false: whether a spending tool asks for approved_by, off by default; agent_spend_cap_usd is a number of dollars advertised to agents, 0 or null for none; agent_shell_guard true installs a Bash hook into this OS user's Claude Code settings that refuses shell routes around the pod manager, false removes only that hook). Values are never returned (get_settings shows the last four characters). A key typed here is in this conversation's transcript: prefer entering it in the app if that matters. The no-spend switch is not a setting here.`,
      inputSchema: obj({ values: { type: 'object', description: 'field -> value or null', properties: Object.fromEntries(SETTING_FIELDS.map((f) => [f, { type: f === 'agent_named_yes_required' || f === 'agent_shell_guard' ? ['boolean', 'null'] : f === 'agent_spend_cap_usd' ? ['number', 'null'] : ['string', 'null'] }])), additionalProperties: false } }, ['values']),
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
    { name: 'resize_volume', description: `Grow a network volume (RunPod only grows them; billed monthly, USD 0.07 per GB). Spends money. approved_by is needed only when the named-yes setting is on. Create one in a chosen datacenter with create_volume`,
      inputSchema: obj({ approved_by: approved.properties.approved_by, volume_id: S('Volume ID (list_volumes)'), size_gb: N('The new size in GB, larger than now') }, ['volume_id', 'size_gb']),
      run: async (args) => {
        const refusal = yes(args, 'resize_volume'); if (refusal) return text(refusal, true)
        const v = await volumes.resize(args.volume_id, Number(args.size_gb))
        console.error(`resize_volume ${v.id} to ${v.size_gb} GB approved by ${String(args.approved_by).trim()}`)
        return json({ ...v, approved_by: String(args.approved_by).trim() })
      } },

    { name: 'volume_files', description: 'Explore a network volume: its folders to depth 3 with sizes (read-only). In a datacenter with the RunPod S3 API and with S3 keys set it goes through the S3 API from this PC (no pod, no cost); otherwise a short-lived pod of the cheapest card or your own pod on it does it (a few cents). Starts a job: poll it with volume_job. volume_plan says where it would run and what it costs. Spends a little: approved_by (only when the named-yes setting is on)',
      inputSchema: obj({ approved_by: approved.properties.approved_by, volume_id: S('Volume ID (list_volumes)'), path: S('A folder to list inside (default /workspace, the whole volume); folders deeper than three levels are listed by asking for them') }, ['volume_id']),
      run: async (args) => { const refusal = yes(args, 'volume_files'); if (refusal) return text(refusal, true); try { return json(await volumes_job.browse(args.volume_id, args.path)) } catch (e) { return text(e.message, true) } } },
    { name: 'volume_erase', description: `Empty chosen folders of a network volume (the volume and the folders stay; contents are deleted, not reversible). what: any of ${Object.keys(podpull.ERASABLE).join(', ')} (models is not in any default). Ask the user first: approved_by only when the named-yes setting is on, and confirm_name (the volume's exact name, typed back). Runs on a short-lived pod or your pod on it; refused while another job runs on the volume. Poll with volume_job; a volume_files listing first shows sizes`,
      inputSchema: obj({ approved_by: approved.properties.approved_by, volume_id: S('Volume ID (list_volumes)'), what: { type: 'array', items: { type: 'string' }, description: 'Folders to empty, from the list above' }, confirm_name: S("The volume's exact name") }, ['volume_id', 'what', 'confirm_name']),
      run: async (args) => { const refusal = yes(args, 'volume_erase'); if (refusal) return text(refusal, true); try { console.error(`volume_erase ${args.volume_id} [${(args.what || []).join(',')}] approved by ${String(args.approved_by).trim()}`); return json(await volumes_job.erase(args.volume_id, args.what || [], { approved_by: args.approved_by, confirm_name: args.confirm_name })) } catch (e) { return text(e.message, true) } } },
    { name: 'volume_clone', description: "Copy a network volume's files to another volume in another datacenter: to an existing volume (to_volume_id) or a new one (new_volume: name, size_gb, datacenter). RunPod to RunPod by default, no S3 needed: a short pod on each volume, and the target pod rsyncs from the source pod over SSH with a one-off key (removed afterwards); both pods are deleted at the end. With RunPod S3 keys in Default Configuration and an S3 datacenter on one side, one pod does it through the S3 API instead. The source is never changed; input/ is left out unless include_input. Spends (a new volume bills monthly, the pods hourly): approved_by (only when the named-yes setting is on). Poll with volume_job",
      inputSchema: obj({ approved_by: approved.properties.approved_by, volume_id: S('The source volume ID (list_volumes)'), to_volume_id: S('An existing volume to copy into'), new_volume: { type: 'object', properties: { name: S('Name'), size_gb: N('Size in GB'), datacenter: S('Datacenter id (list_datacenters)') }, description: 'Or make a new volume to copy into' }, include_input: { type: 'boolean', description: 'Also copy input/ (default no)' } }, ['volume_id']),
      run: async (args) => { const refusal = yes(args, 'volume_clone'); if (refusal) return text(refusal, true); try { console.error(`volume_clone ${args.volume_id} approved by ${String(args.approved_by).trim()}`); return json(await podpull.cloneVolume(args.volume_id, { approved_by: args.approved_by, to_volume_id: args.to_volume_id, new_volume: args.new_volume, include_input: !!args.include_input })) } catch (e) { return text(e.message, true) } } },
    { name: 'volume_job', description: 'A volume_files, volume_erase, volume_clone or models_fetch job: its state, the pod, the listing (folders and bytes) or what an erase freed from each folder. action cancel stops it (the pod is deleted)', inputSchema: obj({ job_id: S('The job id the call returned'), action: S('status (default) | cancel'), plan_volume_id: S('Instead of a job: a volume ID whose job plan (where it would run, the card and price) to show') }, []),
      run: async (a) => { try { if (a.plan_volume_id) return json(await podpull.volumePlan(a.plan_volume_id)); if (!a.job_id) return text('Give job_id (or plan_volume_id)', true); const j = a.action === 'cancel' ? podpull.cancel(a.job_id) : podpull.job(a.job_id); return j ? json(j) : text(`No such job: ${a.job_id}`, true) } catch (e) { return text(e.message, true) } } },

    { name: 'volume_jobs', description: 'The jobs that work on a volume (a models_fetch / models_load_wanted download with its progress: file i of n, bytes done of total, rate, ETA; volume_files, erase, clone, models_delete), newest first, and the temporary pods of volume jobs this app lost when it was restarted (`interrupted`: they keep billing; delete one with action drop and its name, or delete_pod with its pod_id; a download is detached on its pod, so one the app lost, or could not reach for ten minutes, may still be downloading: action reattach and its name follows it again, rebuilding the progress from the pod\'s log). Read-only unless action is drop or reattach', inputSchema: obj({ action: S('list (default) | drop | reattach'), name: S('drop, reattach: the interrupted pod name from the list (ComfyUI-Pull-vol-...)') }),
      run: async (a) => { try { if (a.action === 'reattach') { if (!a.name) return text('Give name (the interrupted pod from the list)', true); return json(await podpull.reattach(a.name)) } if (a.action === 'drop') { if (!a.name) return text('Give name (the interrupted pod from the list)', true); return json(await podpull.dropInterrupted(a.name)) } return json(podpull.volumeJobs()) } catch (e) { return text(e.message, true) } } },

    { name: 'rate_limit_status', description: "Whether RunPod is limiting this app's requests (its API allows so many a minute and an hour): limited, the window (minute or hour), when the app tries again (retry_at), and how old the answer is that the lists are showing from the cache (stale_age_s). Local state: it makes no request to RunPod. While limited, list_pods, list_volumes, get_volume_info and the stock tools answer from the last good answer; object answers carry `rate_limited`", inputSchema: { type: 'object', properties: {} },
      run: async () => json(core.ratelimit.status()) },
    { name: 'agent_guard_status', description: 'The agent shell guard: enabled (the setting), installed (the hook entry is in this OS user Claude Code settings and its script exists and is executable), the settings file and the script path. Read-only; switch it with set_settings agent_shell_guard', inputSchema: obj(),
      run: async () => { try { return json(core.agentguard.status()) } catch (e) { return text(e.message, true) } } },
    // ---------- Models (ADR-042): Hugging Face onto the Shared volume ----------
    { name: 'models_search', description: 'Search Hugging Face for model repos (public API, no key): id, downloads, likes, last update, whether gated. Read-only', inputSchema: obj({ query: S('What to search for, at least two characters') }, ['query']),
      run: async ({ query }) => { try { return json(await hf.search(query)) } catch (e) { return text(e.message, true) } } },
    { name: 'models_files', description: `A Hugging Face repo's weight files (${hf.EXTENSIONS.join(', ')}) with exact size, sha256 and the models folder each probably belongs in (${hf.FOLDERS.join(', ')}). Read-only`, inputSchema: obj({ repo: S('owner/name'), revision: S('Branch or tag, default main') }, ['repo']),
      run: async ({ repo, revision }) => { try { return json(await hf.files(repo, revision || 'main')) } catch (e) { return text(e.message, true) } } },
    { name: 'models_fetch', description: 'Load weight files from Hugging Face onto the Shared volume (set_shared_volume; else the Default Configuration volume) into comfy-shared/models/<folder>/: a short pod, or your own pod on that volume, downloads them (resumable, sha256 checked, a file already there at the right size is skipped) and the pod is deleted at the end. Repo and path are looked up on Hugging Face again, only safetensors, gguf and pth files, at most 20 at a time. Spends the pod minutes (cents); no approval needed. Starts a job: poll it with volume_job', inputSchema: obj({ volume_id: S('A volume ID (default: the Shared volume)'), items: { type: 'array', items: { type: 'object', properties: { repo: S('owner/name'), path: S('File path in the repo, from models_files'), revision: S('Branch or tag, default main'), folder: S(`Destination under models/: ${hf.FOLDERS.join(', ')}`) }, required: ['repo', 'path', 'folder'] }, description: 'The files to load' } }, ['items']),
      run: async ({ volume_id, items }) => { try { const cfg = mounts.load(); const vol = volume_id || cfg.shared_volume_id || cfg.network_volume_id; if (!vol) return text('No volume: pass volume_id, or choose the Shared volume or a default volume', true); console.error(`models_fetch ${vol} ${(items || []).length} file(s)`); return json(await podpull.fetchModels(vol, items || [], {})) } catch (e) { return text(e.message, true) } } },
    { name: 'models_status', description: 'What the Shared volume (or the volume given) holds under comfy-shared/models/, as a list of folder, name and bytes. Over the RunPod S3 API from this PC (no pod, no cost); null when the volume has no S3 API or no S3 keys are set. Read-only', inputSchema: obj({ volume_id: S('A volume ID (default: the Shared volume)') }, []),
      run: async ({ volume_id }) => { try { const cfg = mounts.load(); const vol = volume_id || cfg.shared_volume_id || cfg.network_volume_id; if (!vol) return text('No volume: pass volume_id, or choose the Shared volume or a default volume', true); return json({ volume_id: vol, shared: vol === cfg.shared_volume_id, models: await podpull.modelsOnVolume(vol) }) } catch (e) { return text(e.message, true) } } },
    { name: 'models_delete', description: "Delete model files from the Shared volume (or volume_id): each item is {folder, name} as models_status lists them (folder directly under comfy-shared/models/, name under it, sub-folders allowed). Exact files only: no folder, no pattern, never the _canalv2_pull bookkeeping folder. Not reversible, so confirmed must be true (the window asks first). Over the RunPod S3 API when the volume has it (no pod, no cost), else a short pod. Refused while another job runs on the volume. A deleted file stays in the wanted-models list and shows as missing. Follow the job with volume_job. approved_by only when the named-yes setting is on", inputSchema: obj({ volume_id: S('A volume ID (default: the Shared volume)'), items: { type: 'array', items: obj({ folder: S('Folder under models/, e.g. vae'), name: S('File name under it, e.g. seedvr2_ema_vae_fp16.safetensors') }, ['folder', 'name']), description: 'Files to delete, at most 200' }, confirmed: B('Must be true: this cannot be undone'), approved_by: approved.properties.approved_by }, ['items', 'confirmed']),
      run: async (args) => { const refusal = yes(args, 'models_delete'); if (refusal) return text(refusal, true); try { const cfg = mounts.load(); const vol = args.volume_id || cfg.shared_volume_id || cfg.network_volume_id; if (!vol) return text('No volume: pass volume_id, or choose the Shared volume or a default volume', true); console.error(`models_delete ${vol} ${(args.items || []).length} file(s)`); return json(await podpull.deleteModels(vol, args.items || [], { confirmed: args.confirmed === true }, {})) } catch (e) { return text(e.message, true) } } },
    { name: 'models_wanted', description: "The wanted-models list (ADR-042 section 12): the model files wanted on a Shared volume, as Hugging Face coordinates (repo, path), the models folder and the size. It travels in config_export / config_import_apply (section wanted_models) and is tied to no volume. With volume_id (or a Shared / default volume with the S3 API) each row says whether it is on that volume (present, missing, unknown) and the totals say how much is missing and whether the volume is too small. Read-only, no cost", inputSchema: obj({ volume_id: S('A volume ID; omitted: the Shared volume, else the default one; pass none to get the plain list'), plain: B('true: only the list, no comparison with a volume') }, []),
      run: async ({ volume_id, plain }) => { try { if (plain) return json({ models: wantedmodels.list() }); try { return json(await wantedmodels.status(volume_id || '')) } catch (e) { return json({ models: wantedmodels.list(), note: `Not compared with a volume: ${e.message}` }) } } catch (e) { return text(e.message, true) } } },
    { name: 'models_wanted_add', description: "Add to the wanted-models list: items (each {folder, repo, path, bytes, sha256?, revision?, note?}; folder is one of the models folders with at most one sub-folder), or csv (Binc's pull list text: pipeline,install_to,file,hf_repo,hf_path,bytes,notes), or from: 'binc_list' (the window's Install Defaults: reads comfy-shared/models/_canalv2_pull/MODELS_PULL_v003.csv off the volume over S3) or 'installed' (the window's Saved List: records the weight files the volume holds; the repo of one already in the list is kept, else it has none). Merged by repo, path and folder. Our side only, no spend", inputSchema: obj({ items: { type: 'array', items: { type: 'object' }, description: 'Entries to add' }, csv: S("Binc's pull list as CSV text"), from: S('binc_list or installed', { enum: ['binc_list', 'installed'] }), volume_id: S('The volume to read for from (default: the Shared volume)') }, []),
      run: async ({ items, csv, from, volume_id }) => { try { if (csv) return json(await wantedmodels.addPullList({ csv })); if (from === 'binc_list') return json(await wantedmodels.addPullList({ volume_id })); if (from === 'installed') return json(await wantedmodels.saveInstalled(volume_id || '')); return json(wantedmodels.add(items || [])) } catch (e) { return text(e.message, true) } } },
    { name: 'models_wanted_remove', description: 'Remove entries from the wanted-models list by key (the key in models_wanted rows: repo|path|folder), or all of them. Our side only, no spend', inputSchema: obj({ keys: { type: 'array', items: { type: 'string' }, description: 'Row keys' }, all: B('Remove every entry') }, []),
      run: async ({ keys, all }) => { try { return json(wantedmodels.remove(keys || [], !!all)) } catch (e) { return text(e.message, true) } } },
    { name: 'models_load_wanted', description: 'Load the wanted models the volume lacks onto it (the Shared volume, else the default one, or volume_id; any datacenter): the same Hugging Face fetch as models_fetch, in jobs of at most 20 files one after another (the first is returned; follow it with volume_job; the rest start as each finishes). Entries with no repo cannot be loaded; gated repos are refused. Spends short-pod minutes and writes the volume; the answer says how many GB and warns when the volume is too small (resize_volume first)', inputSchema: obj({ ...approved.properties, volume_id: S('A volume ID (default: the Shared volume)') }, []),
      run: async (args) => { const refusal = yes(args, 'models_load_wanted'); if (refusal) return text(refusal, true); try { console.error(`models_load_wanted ${args.volume_id || '(shared)'}`); return json(await wantedmodels.loadMissing(args.volume_id || '', { approved_by: args.approved_by })) } catch (e) { return text(e.message, true) } } },
    { name: 'set_shared_volume', description: 'Choose the volume that holds the shared models: it is marked Shared in the Volumes list and cannot be deleted (delete_volume refuses it). An empty volume_id clears it. Our side only, no spend', inputSchema: obj({ volume_id: S('A volume ID (list_volumes); empty clears') }, []),
      run: async ({ volume_id }) => { try { return json(await volumes.setShared(volume_id || '')) } catch (e) { return text(e.message, true) } } },

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
    { name: 'panama_stage', description: "Stage a round from this PC (what a drop on the Import Round(s) window does): a folder or files are copied, a .zip is extracted, into a new folder under the staging folder, then it is a staged round like a downloaded one. Nothing is overwritten and nothing leaves this PC; no spend", inputSchema: obj({ paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of folders, .zip files or files' } }, ['paths']), run: async ({ paths }) => json(panama.stageDrop(paths)) },
    { name: 'panama_round_size', description: 'Files and bytes in one round (a listing; a big round takes a few seconds)', inputSchema: obj({ round: S('Round name') }, ['round']), run: async ({ round }) => json(panama.size(round)) },
    { name: 'panama_pod_plan', description: 'What a pod download of a round would do before it does it: use a pod of yours or start a short-lived one, its card and price, the volume, the size, the ceiling in minutes', inputSchema: obj({ round: S('Round name'), route: S("'current' (your pod on the volume, started first if it is off) or 'temporary' (a sync-agent pod of the cheapest card). Default: your pod if it runs, else temporary") }, ['round']), run: async ({ round, route }) => json(await podpull.plan(round, route ? { route } : {})) },
    { name: 'panama_pull', description: 'Download a round: to this PC (aws s3 sync, resumable, never deletes) or onto the network volume by a pod. Returns a job; follow it with panama_job. A pod download may start a pod: approved_by (only when the named-yes setting is on)',
      inputSchema: obj({ round: S('Round name'), target, route: S("Pod downloads: 'current' (your pod, started first if off) or 'temporary' (sync-agent pod, cheapest card)"), approved_by: approved.properties.approved_by, shots: { type: 'array', items: { type: 'string' }, description: 'Pod downloads: only these shots (and the round\'s shared files); the other shot folders stay in the bucket. Omitted: the whole round' } }, ['round']),
      run: async (args) => {
        if (args.target === 'pod') { const refusal = yes(args, 'panama_pull on a pod'); if (refusal) return text(refusal, true); console.error(`panama_pull ${args.round} on a pod approved by ${String(args.approved_by).trim()}`) }
        return json(args.target === 'pod' ? await podpull.pull(args.round, { ...(args.route ? { route: args.route } : {}), ...(args.shots?.length ? { shots: args.shots } : {}) }) : panama.pull(args.round))
      } },
    { name: 'panama_job', description: 'Where a download (or delete) is: state, files, bytes done of total, rate, the latest files', inputSchema: obj({ id: S('Job id from panama_pull'), target }, ['id']),
      run: async (args) => { const j = pickPanama(args).job(args.id); return j ? json(j) : text(`No such job: ${args.id}`, true) } },
    { name: 'panama_cancel', description: 'Stop a download; what is already there stays and a later pull resumes', inputSchema: obj({ id: S('Job id'), target }, ['id']), run: async (args) => json(pickPanama(args).cancel(args.id)) },
    { name: 'panama_remove', description: "Delete a round's staged copy: on this PC, or on the volume by a pod (approved_by (only when the named-yes setting is on): it uses a pod). The bucket is read-only and never touched", inputSchema: obj({ round: S('Round name'), target, approved_by: approved.properties.approved_by }, ['round']),
      run: async (args) => {
        if (args.target === 'pod') { const refusal = yes(args, 'panama_remove on a pod'); if (refusal) return text(refusal, true); return json(await podpull.remove(args.round)) }
        return json(panama.remove(args.round))
      } },
    { name: 'plan_round_import', description: "What importing a round would do and cost before it does anything (ADR-038): its shots, the pod price, the estimate, the pod limit and the dollar cap (the Default Configuration's import_max_pods / import_cost_cap_usd, unless import_cap_enabled is off)", inputSchema: obj({ round: S('Round name'), shots: { type: 'array', items: { type: 'string' }, description: 'Only these shots (default: all)' }, run_workflows: B('Also run each shot\'s workflows (default true)'), cards: { type: 'object', description: 'shot -> GPU card key (see list_gpus); a shot with a card gets a pod of its own with that card, one without takes the pool', additionalProperties: { type: 'string' } }, max_pods: { type: 'number', description: 'Pods at once' }, cost_cap_usd: { type: 'number', description: 'Dollar cap on the estimate' } }, ['round']), run: async ({ round, ...o }) => json(await queue.planImport(round, o)) },
    { name: 'import_rounds', description: "Import SEVERAL rounds on one approval (what the Import Round(s) window does): each is its own import in the queue; cost_cap_usd is the TOTAL and is split evenly between them. Every round is planned first, so a bad round or card queues nothing. Per round: shots (default all) and cards ({ shot: card key }); max_pods is per round. Spends money: approved_by (only when the named-yes setting is on). Follow with queue_list", inputSchema: obj({ rounds: { type: 'array', description: 'The rounds', items: { type: 'object', properties: { round: S('Round name'), shots: { type: 'array', items: { type: 'string' } }, cards: { type: 'object', additionalProperties: { type: 'string' } }, max_pods: { type: 'number' } }, required: ['round'] } }, run_workflows: B('Also run each shot\'s workflows (default true)'), volume_id: S('The network volume the pods and pulls use (list_volumes); it becomes the default volume. Default: the current default, which must exist'), cost_cap_usd: { type: 'number', description: 'Dollar cap, total for all rounds' }, approved_by: approved.properties.approved_by }, ['rounds']),
      run: async (args) => { const refusal = yes(args, 'import_rounds'); if (refusal) return text(refusal, true); console.error(`import_rounds ${(args.rounds || []).map((r) => r.round).join(',')} approved by ${String(args.approved_by).trim()}`); const { approved_by, rounds, ...o } = args; return json(await queue.importRounds(rounds || [], { ...o, approved_by: String(approved_by).trim() })) } },
    { name: 'import_round', description: "Import a round (ADR-038): queue one pull (which also places the round) and one run-workflows task per shot; pods of the pool take them, restarted or created within the pod limit and the dollar cap. One approval covers the whole import. Spends money: approved_by (only when the named-yes setting is on). Follow it with queue_list", inputSchema: obj({ round: S('Round name'), shots: { type: 'array', items: { type: 'string' }, description: 'Only these shots (default: all)' }, run_workflows: B('Also run each shot\'s workflows (default true)'), volume_id: S('The network volume the pods and pulls use (list_volumes); it becomes the default volume'), cards: { type: 'object', description: 'shot -> GPU card key (see list_gpus); a shot with a card gets a pod of its own with that card, one without takes the pool', additionalProperties: { type: 'string' } }, max_pods: { type: 'number', description: 'Pods at once' }, cost_cap_usd: { type: 'number', description: 'Dollar cap on the estimate' }, approved_by: approved.properties.approved_by }, ['round']),
      run: async (args) => { const refusal = yes(args, 'import_round'); if (refusal) return text(refusal, true); console.error(`import_round ${args.round} approved by ${String(args.approved_by).trim()}`); const { approved_by, round, ...o } = args; return json(await queue.importRound(round, { ...o, approved_by: String(approved_by).trim() })) } },
    { name: 'queue_list', description: "The queue (ADR-038): every import with its limits, spent estimate and task counts, and every task (pull or run per shot) with its state (waiting, running, done, failed, held, cancelled, interrupted), pod and error", inputSchema: obj({}), run: async () => json(queue.list()) },
    { name: 'queue_task', description: "Act on the queue: cancel or retry a task, cancel a whole import, purge finished imports from the queue (purge: ask the user first, then confirmed: true; id optional = one import; older_than_days optional), or change an import's limits (set_limits, then retry its held tasks). Retrying a task that spends is covered by the import's original approval", inputSchema: obj({ action: S('cancel | retry | cancel_import | set_limits | purge'), id: S('Task id (cancel, retry) or import id (cancel_import, set_limits, purge) from queue_list'), confirmed: { type: 'boolean', description: 'purge: true only after the user said yes' }, older_than_days: { type: 'number', description: 'purge: only imports finished this many days ago or more' }, max_pods: { type: ['number', 'null'], description: 'set_limits: pods at once (null = no limit)' }, cost_cap_usd: { type: ['number', 'null'], description: 'set_limits: dollar cap (null = no cap)' } }, ['action', 'id']),
      run: async ({ action, id, max_pods, cost_cap_usd, confirmed, older_than_days }) => { try { if (action === 'purge') return json(queue.purge({ confirmed, ...(id ? { import_id: id } : {}), ...(older_than_days !== undefined ? { older_than_days } : {}) })); if (action === 'cancel') return json(queue.cancelTask(id)); if (action === 'retry') return json(queue.retryTask(id)); if (action === 'cancel_import') return json(queue.cancelImport(id)); if (action === 'set_limits') return json(queue.setImportLimits(id, { ...(max_pods !== undefined ? { max_pods } : {}), ...(cost_cap_usd !== undefined ? { cost_cap_usd } : {}) })); return text(`Unknown action ${action}`, true) } catch (e) { return text(e.message, true) } } },
    { name: 'list_pod_workflows', description: "The graphs in a running pod's Workflows panel (its comfy-shared/workflows), grouped by folder (a shot or a round). What the Run workflows window lists (ADR-037)", inputSchema: obj({ pod_id: S('A running pod') }, ['pod_id']), run: async ({ pod_id }) => json(await runflows.list(pod_id)) },
    { name: 'run_pod_workflows', description: "Run chosen graphs from a pod's Workflows panel on that pod, one after another (ADR-037). Each UI graph is converted with ComfyUI's own frontend (on the pod if its image has it, else Chrome on this PC), queued and waited for; locked shots are refused. Every outcome and error is written to the History. Returns a job: follow it with run_workflows_job. Runs on a pod that is already billing: approved_by (only when the named-yes setting is on)", inputSchema: obj({ pod_id: S('A running pod'), paths: { type: 'array', items: { type: 'string' }, description: 'Panel paths from list_pod_workflows, e.g. rounds/<round>/<shot>/graph.json' }, approved_by: approved.properties.approved_by }, ['pod_id', 'paths']),
      run: async (args) => { const refusal = yes(args, 'run_pod_workflows'); if (refusal) return text(refusal, true); console.error(`run_pod_workflows on ${args.pod_id} (${(args.paths || []).length} graphs) approved by ${String(args.approved_by).trim()}`); return json(await runflows.run(args.pod_id, args.paths || [], { approvedBy: String(args.approved_by).trim() })) } },
    { name: 'pod_models', description: "Which VAE and diffusion model a pod's workflows use (ADR-042), and the files its ComfyUI offers for each (models/vae, models/diffusion_models on its volume; needs the pod running to list them). Give vae and/or diffusion_model to choose (an empty string clears it: the graph keeps its own); run_pod_workflows then puts the choice into each graph that has exactly one such loader, and names what it left alone. Our side only, no spend", inputSchema: obj({ pod_id: S('A pod'), vae: S('VAE file name, empty to clear'), diffusion_model: S('Diffusion model file name, empty to clear') }, ['pod_id']),
      run: async ({ pod_id, vae, diffusion_model }) => { try { if (vae !== undefined || diffusion_model !== undefined) runflows.setModels(pod_id, { ...(vae !== undefined ? { vae } : {}), ...(diffusion_model !== undefined ? { diffusion_model } : {}) }); return json(await runflows.models(pod_id)) } catch (e) { return text(e.message, true) } } },
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
    // ---------- chunked runs (docs/CHUNKING.md) ----------
    { name: 'chunk_plan', description: "Split a frame range into chunks (docs/CHUNKING.md): a long shot loaded whole can fill a container's RAM and be OOM-killed (exit 137). Returns the ranges; with write_jobs, also writes one job file per chunk into queue/<project>/in/ (never queue/canalv2/). A graph with BincSeqToImage takes frame NUMBERS (the file names); one with only BH_ReadSequence takes INDEXES. No spend",
      inputSchema: obj({ first: N('First frame'), last: N('Last frame'), chunk: N(`Frames per chunk (default ${chunking.DEFAULT_CHUNK}; about 50 for 4K with SeedVR2 or LTX)`), write_jobs: obj({ project: S('queue/<project>/ folder, not canalv2'), shot: S('Shot name for the job files'), graph_path: S('The panel path the jobs run'), pod_id: S('A pod to name in the jobs') }, ['project', 'shot']) }, ['first', 'last']),
      run: async ({ first, last, chunk, write_jobs }) => {
        try {
          const chunks = chunking.plan(first, last, chunk ?? chunking.DEFAULT_CHUNK)
          if (!write_jobs) return json({ count: chunks.length, chunks })
          const w = chunking.writeJobFiles({ ...write_jobs, first, last, chunk })
          return json({ count: chunks.length, chunks, dir: w.dir, files: w.files })
        } catch (e) { return text(e.message, true) }
      } },
    { name: 'run_shot_chunked', description: "Run a shot's graph on a running pod as consecutive frame ranges (docs/CHUNKING.md), so RAM never holds the whole sequence: each chunk sets BincSeqToImage first_frame/last_frame (or BH_ReadSequence first_index/count), runs, then ComfyUI is told to free memory. The RAM guard reads the pod's container memory over SSH while it runs: past ram_guard_pct (default 85) the chunk is interrupted and the job stops with the chunk and frames to resume from. Give the graph (API format) or a panel path. Locked shots are refused. Returns a job: follow it with chunked_job. Runs on a pod already billing: approved_by (only when the named-yes setting is on)",
      inputSchema: obj({ pod_id: S('A running pod'), path: S('Panel path from list_pod_workflows (a UI graph, converted like run_pod_workflows)'), graph: O('Or an API-format graph'), first: N('First frame (a frame number with BincSeqToImage, an index with BH_ReadSequence only)'), last: N('Last frame'), chunk: N(`Frames per chunk (default ${chunking.DEFAULT_CHUNK})`), ram_guard_pct: N(`Stop when the container passes this share of its RAM (default ${chunking.DEFAULT_RAM_GUARD_PCT})`), approved_by: approved.properties.approved_by }, ['pod_id', 'first', 'last']),
      run: async (args) => {
        const refusal = yes(args, 'run_shot_chunked'); if (refusal) return text(refusal, true)
        try {
          console.error(`run_shot_chunked on ${args.pod_id} frames ${args.first}-${args.last} approved by ${String(args.approved_by).trim()}`)
          return json(await chunking.run(args.pod_id, { path: args.path, graph: args.graph, first: args.first, last: args.last, chunk: args.chunk, ramGuardPct: args.ram_guard_pct, approvedBy: String(args.approved_by).trim() }))
        } catch (e) { return text(e.message, true) }
      } },
    { name: 'chunked_job', description: 'Where a run_shot_chunked job is: each chunk waiting, running, done or failed, the RAM now and its peak, and why it stopped (the RAM guard names the chunk and the frame to resume from); cancel: true interrupts the running chunk and skips the rest', inputSchema: obj({ id: S('Job id from run_shot_chunked'), cancel: B('Stop the job') }, ['id']),
      run: async ({ id, cancel }) => { try { const j = cancel ? chunking.cancel(id) : chunking.job(id); return j ? json(j) : text(`No such chunked run: ${id}`, true) } catch (e) { return text(e.message, true) } } },
    { name: 'pod_ram', description: "A pod's container memory right now, from its cgroup over SSH (the host's figure that ComfyUI's own /system_stats gives is not the container's limit): used, limit, percent, and whether it is over the guard's limit. null when the pod has no memory limit or cannot be reached. Read-only, no spend", inputSchema: obj({ pod_id: S('A running pod'), ram_guard_pct: N(`The limit to compare with (default ${chunking.DEFAULT_RAM_GUARD_PCT})`) }, ['pod_id']),
      run: async ({ pod_id, ram_guard_pct }) => { const r = await chunking.readRam(pod_id); const lim = ram_guard_pct ?? chunking.DEFAULT_RAM_GUARD_PCT; return json(r ? { ...r, used_gib: chunking.gib(r.used), limit_gib: chunking.gib(r.limit), ram_guard_pct: lim, over: chunking.overLimit(r, lim) } : { ram: null, note: 'No container memory limit found, or the pod could not be reached over SSH.' }) } },
    // ---------- retry later (ADR-042 section 19) ----------
    { name: 'pod_watch', description: "The Retry Later watches: what is waiting for RunPod to have a free card, started by resume_pod or create_pod with retry_until_free (or the window's Retry Later). action list (default): every watch with its kind (resume | create), state (waiting, done, stopped, expired, cancelled), tries, next try, last answer, give-up time and the pod it made; action cancel: stop one (id from the list, or the pod_id of a resume watch). Cancelling nothing deletes or resumes anything; a create cancelled while a try was in flight says to check the pod list. No spend",
      inputSchema: obj({ action: S('list (default) | cancel'), id: S('cancel: the watch id'), pod_id: S('cancel: the pod whose resume watch to stop') }),
      run: async ({ action, id, pod_id }) => {
        try {
          if (action === 'cancel') { const w = pods.cancelWatch(String(id || pod_id || '')); return json({ cancelled: w.id, watch: w }) }
          if (action != null && action !== 'list') return text("action must be 'list' or 'cancel'", true)
          const all = pods.watches()
          return json({ waiting: all.filter((w) => w.state === 'waiting').length, watches: all })
        } catch (e) { return text(e.message, true) }
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
