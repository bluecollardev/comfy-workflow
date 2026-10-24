#!/usr/bin/env node
// The pod manager's command line over the core (docs/ADR-005, step 5): `pod`, `sync`, `pull`, `import`.
//
// Replaces infra/scripts/create_pod.py and sync_volume.py with the same flags. Only wiring: argv
// in, the core's functions, child processes for rsync, the AWS CLI and nothing else. Nothing here
// decides anything the core does not; the plans and the commands it runs are built and tested in
// libs/core/src/sync.ts. Build the core first (`npm run core:build`); `npm run cli -- <args>`.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE = resolve(HERE, '..', 'libs', 'core', 'dist', 'index.js')

class Usage extends Error {}   // a mistake on the command line: the message, exit 2
class Help extends Usage {}    // --help: the usage text on stdout, exit 0
const fail = (msg) => { throw new Usage(msg) }

// ----- argv, the way argparse read it: --flag value, --flag=value, booleans, repeatable lists -----

/** spec: { name: { kind: 'str'|'int'|'bool'|'list', default, required, help } } */
function parse(argv, spec, what) {
  const out = {}
  for (const [k, s] of Object.entries(spec)) out[k] = s.kind === 'list' ? [] : s.kind === 'bool' ? false : s.default ?? null
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (a === '--help' || a === '-h') throw new Help(usage(spec, what))
    if (!a.startsWith('--')) fail(`${what}: unexpected argument ${a}\n${usage(spec, what)}`)
    let v = null
    const eq = a.indexOf('=')
    if (eq > 0) { v = a.slice(eq + 1); a = a.slice(0, eq) }
    const name = a.slice(2)
    const s = spec[name]
    if (!s) fail(`${what}: unknown option --${name}\n${usage(spec, what)}`)
    if (s.kind === 'bool') { if (v != null) fail(`--${name} takes no value`); out[name] = true; continue }
    if (v == null) { v = argv[++i]; if (v == null || v.startsWith('--')) fail(`--${name} needs a value`) }
    if (s.kind === 'int') { if (!/^-?\d+$/.test(v)) fail(`--${name} needs a whole number, not ${v}`); v = Number(v) }
    if (s.kind === 'list') out[name].push(v); else out[name] = v
  }
  for (const [k, s] of Object.entries(spec)) if (s.required && out[k] == null) fail(`${what}: --${k} is required\n${usage(spec, what)}`)
  return out
}

function usage(spec, what) {
  const lines = Object.entries(spec).map(([k, s]) => `  --${k}${s.kind === 'bool' ? '' : s.kind === 'list' ? ` ${s.meta || 'VALUE'} (repeatable)` : ` ${s.meta || 'VALUE'}`}${s.required ? ' (required)' : ''}\n      ${s.help}${s.default != null && s.default !== '' ? ` [${s.default}]` : ''}`)
  return `usage: ${what} [options]\n${lines.join('\n')}`
}

const csv = (s) => new Set((s || '').split(',').map((k) => k.trim()).filter(Boolean))
const quote = (c) => (/^[A-Za-z0-9_\/:=.,@%+-]+$/.test(c) ? c : `'${c.replace(/'/g, `'\\''`)}'`)

/** Run one command with the terminal attached; resolves with its exit code. */
function run(cmd, env = {}) {
  console.log('  ' + cmd.map(quote).join(' '))
  return new Promise((res) => {
    const p = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, ...env } })
    p.on('error', (e) => { console.error(`${cmd[0]}: ${e.message}`); res(127) })
    p.on('exit', (code, signal) => res(code ?? (signal ? 1 : 0)))
  })
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((res) => rl.question(question, res))
  rl.close()
  return answer.trim().toLowerCase() === 'yes'
}

// ----- the RunPod key: --api-key, the environment, then the app's settings file, as the core's settings.ts reads it -----

function loadKey(core, apiKey) {
  if (apiKey) process.env.RUNPOD_API_KEY = apiKey
  else if (!process.env.RUNPOD_API_KEY) { const k = core.settings.lookup('RUNPOD_API_KEY'); if (k) process.env.RUNPOD_API_KEY = k }
  // no-spend mode (dry_run in the configuration or RUNPOD_DRY_RUN=1) simulates pods: nothing reaches RunPod, so no key is needed
  if (!process.env.RUNPOD_API_KEY && !core.mounts.dryRun(core.mounts.load())) fail('RUNPOD_API_KEY not set: export it, pass --api-key, or save it in the app\'s Settings')
}

// ----- pod -----

const POD_ID = { 'pod-id': { kind: 'str', required: true, meta: 'ID', help: 'Pod ID' } }
const API_KEY = { 'api-key': { kind: 'str', meta: 'KEY', help: 'RunPod API key (else the environment or the app\'s settings file)' } }

const CREATE = {
  ...API_KEY,
  name: { kind: 'str', required: true, meta: 'NAME', help: 'Pod name' },
  gpu: { kind: 'str', meta: 'KEY', help: 'auto (cheapest card in stock) or a card from the small-card table' },
  volume: { kind: 'int', default: 0, meta: 'GB', help: 'Per-pod volume in GB; 0 when the network volume carries the data' },
  disk: { kind: 'int', default: 20, meta: 'GB', help: 'Container disk size in GB' },
  secure: { kind: 'bool', help: 'Secure cloud instead of the cheaper community cloud' },
  'idle-stop': { kind: 'int', meta: 'MINUTES', help: 'Stop after this many quiet minutes (default: the configuration\'s value; 0 = never)' },
  'network-volume': { kind: 'str', default: '', meta: 'ID', help: 'RunPod network volume id to attach (the configuration\'s value if omitted)' },
  'mount-path': { kind: 'str', default: '', meta: 'PATH', help: 'Where the network volume is mounted in the pod (default /workspace)' },
  link: { kind: 'list', meta: 'PATH=TARGET', help: 'Extra path to make resolve on the pod, onto TARGET on the volume; the three folders come from the configuration' },
  'no-mounts': { kind: 'bool', help: 'Do not apply the mounts configuration (~/.config/runpod-pod-manager/mounts.json)' },
  image: { kind: 'str', default: 'configured', meta: 'REF', help: 'configured (the image in Configuration, ours), prebuilt (ashleykza, no packs), or an image reference' },
}

async function podCreate(core, argv) {
  const o = parse(argv, CREATE, 'pod create')
  loadKey(core, o['api-key'])
  const gpu = o.gpu || core.gpus.DEFAULT_GPU
  if (gpu !== core.gpus.AUTO && !(gpu in core.gpus.GPUS)) fail(`unknown GPU ${gpu}; options: ${[core.gpus.AUTO, ...Object.keys(core.gpus.GPUS)].join(', ')}`)
  const req = {
    name: o.name, gpu, volume_gb: o.volume, disk_gb: o.disk, image: o.image, instance_type: o.secure ? 'on-demand' : 'spot',
    idle_stop_minutes: o['idle-stop'], apply_mounts: !o['no-mounts'],
  }
  if (o['network-volume'] || o['mount-path'] || o.link.length) {
    // The flags amend the Default Configuration for this pod only, the way the Python amended the loaded config.
    if (o['no-mounts']) fail('--network-volume, --mount-path and --link are part of the mounts configuration; drop --no-mounts to use them')
    const cfg = core.mounts.load()
    if (o['network-volume']) cfg.network_volume_id = o['network-volume']
    if (o['mount-path']) cfg.mount_path = o['mount-path']
    for (const pair of o.link) {
      const i = pair.indexOf('=')
      if (i <= 0) fail(`--link takes PATH=TARGET, not ${pair}`)
      cfg.links.push({ path: pair.slice(0, i), target: pair.slice(i + 1), required: true, mode: 'rw', what: 'command line', folder: '' })
    }
    req.config = cfg
  }
  const cfg = core.pods.effectiveConfig(req).cfg
  const { input } = core.pods.plan(req, cfg)
  console.log(`Creating pod: ${o.name}`)
  console.log(`  GPU: ${gpu === core.gpus.AUTO ? 'cheapest card in stock' : `${core.gpus.GPUS[gpu].name} (${core.gpus.GPUS[gpu].vram} GB VRAM)`}`)
  console.log(`  Volume: ${input.volumeInGb} GB per pod`)
  console.log(`  Container disk: ${input.containerDiskInGb} GB`)
  console.log(`  Image: ${input.imageName}`)
  console.log(`  Mounts: ${req.apply_mounts ? `${core.mounts.allLinks(cfg).length} link(s)` + (input.networkVolumeId ? `, network volume ${input.networkVolumeId} at ${input.volumeMountPath}` : ', no network volume (per-pod disk only)') : 'off'}`)
  const pod = await core.pods.create(req)
  if (pod.idle_stop_minutes > 0) console.log(`  Idle stop: after ${pod.idle_stop_minutes} quiet minutes (while the app runs)`)
  console.log(`\nPod created.\n  Pod ID: ${pod.id}\n  Status: ${pod.status}${pod.status_text ? ` (${pod.status_text})` : ''}`)
  console.log(`\n  Web UI: ${pod.web_ui_url || core.idle.proxyUrl(pod.id)}\n  SSH: ${pod.ssh_command}`)
}

const fmtUptime = (s) => (s == null ? '-' : s < 3600 ? `${Math.floor(s / 60)}m` : `${(s / 3600).toFixed(1)}h`)

async function podList(core, argv) {
  const o = parse(argv, API_KEY, 'pod list')
  loadKey(core, o['api-key'])
  const pods = await core.pods.list()
  if (!pods.length) { console.log('No pods found.'); return }
  console.log(`Found ${pods.length} pod(s):\n`)
  const rows = [['ID', 'NAME', 'STATUS', 'GPU', 'UPTIME'], ...pods.map((p) => [p.id, p.name, p.status, p.gpu, fmtUptime(p.uptime_seconds)])]
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)))
  for (const r of rows) console.log('  ' + r.map((c, i) => String(c).padEnd(w[i])).join('  ').trimEnd())
}

async function podStatus(core, argv) {
  const o = parse(argv, { ...API_KEY, ...POD_ID }, 'pod status')
  loadKey(core, o['api-key'])
  const p = await core.pods.get(o['pod-id'])
  let d = {}
  try { d = await core.pods.details(o['pod-id']) } catch { /* the REST record is extra; the GraphQL status is enough */ }
  console.log(`\nPod: ${p.name} (${p.id})`)
  for (const [k, v] of Object.entries({ ...p, ...d, name: undefined, id: undefined })) if (v != null && v !== '') console.log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
}

const simple = (what, call) => async (core, argv) => {
  const o = parse(argv, { ...API_KEY, ...POD_ID }, `pod ${what}`)
  loadKey(core, o['api-key'])
  const r = await core.pods[call](o['pod-id'])
  console.log(r.message)
}

async function podDelete(core, argv) {
  const o = parse(argv, { ...API_KEY, ...POD_ID, force: { kind: 'bool', help: 'Skip confirmation' } }, 'pod delete')
  loadKey(core, o['api-key'])
  if (!o.force && !(await confirm(`Delete pod ${o['pod-id']}? (yes/no): `))) { console.log('Cancelled'); return }
  console.log((await core.pods.remove(o['pod-id'])).message)
}

const POD = { create: podCreate, list: podList, status: podStatus, stop: simple('stop', 'stop'), resume: simple('resume', 'resume'), delete: podDelete }

// ----- sync and pull: the plan from the core, one process per folder, the first failure's code at the end -----

const TRANSPORT = {
  ...API_KEY,
  pod: { kind: 'str', meta: 'ID', help: 'pod id with the network volume attached, for rsync over SSH' },
  s3: { kind: 'bool', help: 'no pod: RunPod\'s S3 API straight onto the volume (S3 datacenters only; needs the AWS CLI and RUNPOD_S3_ACCESS_KEY / RUNPOD_S3_SECRET_KEY)' },
  volume: { kind: 'str', default: '', meta: 'ID', help: 'with --s3: the network volume (the configuration\'s value if omitted)' },
  'dry-run': { kind: 'bool', help: 'print the commands and run them without copying' },
}

/** Where the copies go: an rsync target from the pod's record, or the volume for the S3 API. Returns the per-step command builder. */
async function transport(core, o, cfg, direction) {
  if (o.s3 && o.pod) fail('--pod or --s3, not both')
  if (o.s3) {
    const vol = core.sync.assertS3(await core.pods.volumeInfo(o.volume || undefined))
    const env = core.sync.s3Env()
    const where = `s3://${vol.id} (${vol.datacenter})`
    const opts = { mountPath: cfg.mount_path, dryRun: o['dry-run'] }
    return { where, env, cmd: (s) => (direction === 'push' ? core.sync.s3Cmd(s.local, vol, s.remote, opts) : core.sync.s3PullCmd(vol, s.remote, s.local, opts)) }
  }
  if (!o.pod) fail('--pod <id> (rsync over SSH into a running pod) or --s3 (RunPod\'s S3 API, no pod)')
  const pod = await core.runpod.getPod(o.pod)
  if (!pod) fail(`pod ${o.pod} not found`)
  const { host, port } = core.sync.sshTarget(pod)
  const version = spawnSync('rsync', ['--version'], { encoding: 'utf8' }).stdout || ''
  const opts = { dryRun: o['dry-run'], progress: core.sync.progressFlag(version) }
  return { where: host, env: {}, cmd: (s) => (direction === 'push' ? core.sync.rsyncCmd(s.local, host, port, s.remote, opts) : core.sync.rsyncPullCmd(host, port, s.remote, s.local, opts)) }
}

async function runSteps(steps, t, direction) {
  let rc = 0
  for (const s of steps) {
    console.log(direction === 'push' ? `${s.key}: ${s.local} -> ${t.where}:${s.remote}` : `${s.key}: ${t.where}:${s.remote} -> ${s.local}`)
    const r = await run(t.cmd(s), t.env)
    rc = rc || r
  }
  return rc
}

const SYNC = {
  ...TRANSPORT,
  only: { kind: 'str', default: '', meta: 'KEYS', help: 'comma list of folder keys: project, plates, comfy-shared, workflows' },
  plates: { kind: 'bool', help: 'include the plates (client material)' },
  'approved-by': { kind: 'str', default: '', meta: 'NAME', help: 'who said yes to copying plates off this PC; required with --plates' },
}

/** Copy the mapped folders up. Never deletes anything on the volume. */
async function sync(core, argv) {
  const o = parse(argv, SYNC, 'sync')
  loadKey(core, o['api-key'])
  if (o.plates && !o['approved-by'].trim()) fail('--plates needs --approved-by <name>: plates leaving this PC need Binc\'s named yes (shared/governance/policy/agent-permissions.md)')
  const cfg = core.mounts.load()
  const steps = core.sync.plan(cfg, csv(o.only), o.plates, (m) => console.error(m))
  if (!steps.length) { console.error('nothing to copy'); return 1 }
  if (o.plates) console.log(`plates approved by ${o['approved-by'].trim()}`)
  return runSteps(steps, await transport(core, o, cfg, 'push'), 'push')
}

const PULL = {
  ...TRANSPORT,
  only: { kind: 'str', default: '', meta: 'KEYS', help: 'comma list of: output (ComfyUI-Shared/output), review (each shot\'s 06_REVIEW), deliver (07_DELIVER)' },
  shot: { kind: 'list', meta: 'NAME', help: 'only this shot (its folder name, e.g. corrosion-051)' },
}

/** Copy what the pod wrote back down: ComfyUI's output and each shot's renders and packages. Never deletes anything here. */
async function pull(core, argv) {
  const o = parse(argv, PULL, 'pull')
  loadKey(core, o['api-key'])
  const only = csv(o.only)
  for (const k of only) if (!core.sync.PULL_KEYS.includes(k)) fail(`--only: ${k} is not one of ${core.sync.PULL_KEYS.join(', ')}`)
  const cfg = core.mounts.load()
  let shots = cfg.folders.project ? core.sync.listShots(cfg.folders.project) : []
  if (o.shot.length) {
    shots = shots.filter((s) => o.shot.includes(s.split('/')[1]))
    for (const name of o.shot) if (!shots.some((s) => s.endsWith('/' + name))) fail(`no shot ${name} in ${cfg.folders.project || 'the project tree (not mapped)'}`)
  }
  const steps = core.sync.pullPlan(cfg, shots, only, (m) => console.error(m))
  if (!steps.length) { console.error('nothing to pull'); return 1 }
  return runSteps(steps, await transport(core, o, cfg, 'pull'), 'pull')
}

// ----- import (docs/ADR-008): a folder through an adapter into this PC's ComfyUI-Shared -----

const fmtBytes = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`)

async function importCmd(core, argv) {
  const folder = argv[0] && !argv[0].startsWith('--') ? argv.shift() : null
  const o = parse(argv, {
    adapter: { kind: 'str', meta: 'ID', help: 'the adapter to use (default: the best approved match)' },
    to: { kind: 'str', meta: 'DIR', help: 'the ComfyUI-Shared folder to fill (default: the mapped one)' },
    'dry-run': { kind: 'bool', help: 'show the plan and what would happen; write nothing' },
    overwrite: { kind: 'bool', help: 'replace files that exist and differ (default: leave them, report a conflict)' },
    'link-models': { kind: 'bool', help: 'comfy-shared adapter: link models instead of copying' },
    list: { kind: 'bool', help: 'list the adapters (built-in and yours) and exit' },
    approve: { kind: 'str', meta: 'ID', help: 'approve one of your adapters as it is now (read it first: --show)' },
    show: { kind: 'str', meta: 'ID', help: 'print an adapter\'s source' },
    json: { kind: 'bool', help: 'print the plan/result as JSON' },
  }, 'import <folder>')
  if (o.list) {
    for (const a of await core.imports.list()) console.log(`${a.id.padEnd(22)} ${a.builtin ? 'built-in' : a.approved ? 'approved ' : 'NOT APPROVED'}  ${a.name}${a.error ? `  [${a.error}]` : ''}`)
    return 0
  }
  if (o.show) { const s = core.imports.source(o.show); console.log(`// ${o.show}  sha256 ${s.sha256}\n${s.text}`); return 0 }
  if (o.approve) { const a = await core.imports.approve(o.approve); console.log(`approved ${a.id} (${a.sha256.slice(0, 12)}…)`); return 0 }
  if (!folder) fail('import: give the folder to import\n' + usage({}, 'import <folder>'))
  const plan = await core.imports.plan(resolve(folder), o.adapter || undefined, o['link-models'] ? { link: true } : {})
  const s = plan.summary
  if (!o.json) {
    console.log(`${plan.adapter.name} (${plan.adapter.id}) read ${plan.source}${plan.fenced ? '' : '   [NOT fenced: this Node has no --permission]'}`)
    for (const [k, v] of Object.entries(s.by_kind)) console.log(`  ${k.padEnd(10)} ${String(v.files).padStart(6)} files  ${fmtBytes(v.bytes)}`)
    console.log(`  ${s.notes} left in place; ${s.copies} to copy (${fmtBytes(s.bytes)}), ${s.links} to link`)
    for (const f of plan.findings) console.log(`  ${f.level.padEnd(7)} ${f.text}`)
  }
  const r = await core.imports.apply(plan, { dryRun: o['dry-run'], overwrite: o.overwrite, target: o.to || undefined })
  if (o.json) console.log(JSON.stringify({ plan: { ...plan, ops: undefined }, result: { ...r, results: undefined } }, null, 1))
  else {
    console.log(`${r.dry_run ? 'dry run' : 'imported'}: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing'}${r.record ? `\n  record ${r.record}` : ''}`)
    for (const x of r.results.filter((x) => ['conflict', 'hash-mismatch', 'error'].includes(x.status)).slice(0, 20)) console.log(`  ${x.status}: ${x.detail || plan.ops[x.i].to}`)
  }
  return r.ok ? 0 : 1
}

// ----- main -----

const HELP = `usage: npm run cli -- <command> [options]   (./start.sh pod|sync|pull)

  pod create --name NAME [--gpu KEY] [--image REF] [--network-volume ID] [--link PATH=TARGET]... [--no-mounts] ...
  pod list
  pod status|stop|resume|delete --pod-id ID [--force]
  sync --pod ID | --s3 [--volume ID]  [--only project,plates,comfy-shared,workflows] [--plates --approved-by NAME] [--dry-run]
  pull --pod ID | --s3 [--volume ID]  [--only output,review,deliver] [--shot NAME]... [--dry-run]
  import <folder> [--adapter ID] [--to DIR] [--dry-run] [--overwrite]   a package folder into ComfyUI-Shared; --list | --show ID | --approve ID

Each command takes --help. The RunPod key comes from --api-key, RUNPOD_API_KEY or the app's settings file.`

async function main(argv) {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '--help' || cmd === '-h') { console.log(HELP); return cmd ? 0 : 2 }
  if (!existsSync(CORE)) fail(`the core is not built (${CORE}): run npm run core:build`)
  const core = await import(pathToFileURL(CORE).href)
  if (cmd === 'pod') {
    const [sub, ...args] = rest
    if (!sub || sub === '--help' || sub === '-h') { console.log(HELP); return sub ? 0 : 2 }
    if (!POD[sub]) fail(`pod: unknown command ${sub}; one of ${Object.keys(POD).join(', ')}`)
    return (await POD[sub](core, args)) ?? 0
  }
  if (cmd === 'sync') return sync(core, rest)
  if (cmd === 'pull') return pull(core, rest)
  if (cmd === 'import') return importCmd(core, rest)
  fail(`unknown command ${cmd}\n${HELP}`)
}

main(process.argv.slice(2)).then((rc) => process.exit(rc || 0), (e) => {
  if (e instanceof Help) { console.log(e.message); process.exit(0) }
  if (e instanceof Usage) { console.error(e.message); process.exit(2) }
  console.error(`error: ${e.message || e}`)
  process.exit(1)
})
