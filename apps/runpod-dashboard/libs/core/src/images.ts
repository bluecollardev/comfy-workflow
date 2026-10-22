/**
 * Container image lookups for the pod form's "load environment defaults":
 *   source=dockerfile  ENV and ARG instructions from the repo's apps/comfy-app/Dockerfile (DOCKERFILE_PATH overrides)
 *   source=image       ENV from `docker image inspect <ref>` on this PC, minus base-image and toolchain variables
 * Same response keys as the Python route: {source, image, env: [{key, value}], build_args: [{key, value}], skipped, build_source}.
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { CoreError, bad } from './errors.js'
import { dockerfilePath } from './paths.js'
import { PREBUILT_IMAGE } from './pods.js'

export interface KV { key: string; value: string }
export interface ImageEnv { source: string; image: string; env: KV[]; build_args: KV[]; skipped: number; build_source: string | null }
/** `docker image inspect` reduced to the config we read; injected by the tests. */
export type Inspector = (image: string) => Promise<{ Env?: string[] | null; Labels?: Record<string, string> | null }>

/** Images whose config carries no org.opencontainers.image.source label. */
export const KNOWN_SOURCES: Record<string, string> = {
  'ashleykza/comfyui': 'https://github.com/ashleykleynhans/comfyui-docker',
  'ashleykza/runpod-worker-comfyui': 'https://github.com/ashleykleynhans/runpod-worker-comfyui',
}

/** Base-image and toolchain variables nobody sets on a pod. */
export const SYSTEM_ENV = /^(PATH|HOME|SHELL|LANG|LC_ALL|DEBIAN_FRONTEND|PYTHONUNBUFFERED|PYTHONDONTWRITEBYTECODE|GPG_KEY|PYTHON_VERSION|PYTHON_SHA256|NVARCH|NV_.*|NVIDIA_.*|CUDA_VERSION|NCCL_VERSION|LD_LIBRARY_PATH|LIBRARY_PATH)$/

// ----- Dockerfile parsing -----

/** A shell-style split (Python's shlex.split, POSIX mode): quotes group words, backslash escapes outside single quotes. */
export function shellSplit(text: string): string[] {
  const out: string[] = []
  let cur = '', inWord = false, q: '"' | "'" | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q === "'") { if (ch === "'") q = null; else cur += ch }
    else if (q === '"') {
      if (ch === '"') q = null
      else if (ch === '\\' && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1])) cur += text[++i]
      else cur += ch
    }
    else if (ch === '"' || ch === "'") { q = ch; inWord = true }
    else if (ch === '\\' && i + 1 < text.length) { cur += text[++i]; inWord = true }
    else if (/\s/.test(ch)) { if (inWord) out.push(cur); cur = ''; inWord = false }
    else { cur += ch; inWord = true }
  }
  if (inWord) out.push(cur)
  return out
}

/** ENV and ARG instructions; later definitions win (ENV) or the first default is kept (ARG), and an ARG default may be empty. */
export function parseDockerfile(text: string): { env: KV[]; build_args: KV[] } {
  const env = new Map<string, string>(), args = new Map<string, string>()
  for (const raw of text.replace(/\\\s*\n/g, ' ').split('\n')) {
    const line = raw.trim()
    const m = /^(\S+)\s*(.*)$/.exec(line)
    if (!m) continue
    const instr = m[1].toUpperCase(), body = m[2].trim()
    if (instr === 'ENV') {
      const first = body.split(/\s+/, 1)[0]
      if (first.includes('=')) for (const tok of shellSplit(body)) { const i = tok.indexOf('='); env.set(i < 0 ? tok : tok.slice(0, i), i < 0 ? '' : tok.slice(i + 1)) }
      else { const i = body.indexOf(' '); env.set(i < 0 ? body : body.slice(0, i), i < 0 ? '' : body.slice(i + 1).trim().replace(/^"+|"+$/g, '')) }   // ENV KEY the rest of the line
    } else if (instr === 'ARG') {
      for (const tok of shellSplit(body)) { const i = tok.indexOf('='); const k = i < 0 ? tok : tok.slice(0, i); if (!args.has(k)) args.set(k, i < 0 ? '' : tok.slice(i + 1)) }
    }
  }
  const kv = (m: Map<string, string>) => [...m].map(([key, value]) => ({ key, value }))
  return { env: kv(env), build_args: kv(args) }
}

export function envFromDockerfile(): ImageEnv {
  const file = dockerfilePath()
  if (!existsSync(file) || !statSync(file).isFile()) throw new CoreError(404, `No Dockerfile at ${file}`)
  const { env, build_args } = parseDockerfile(readFileSync(file, 'utf8'))
  return { source: 'dockerfile', image: file, env, build_args, skipped: 0, build_source: file }
}

// ----- docker image inspect -----

/** The image's config from the local docker daemon. The image must be pulled; nothing reaches a registry. */
export const dockerInspect: Inspector = (image) =>
  new Promise((resolve, reject) => {
    execFile('docker', ['image', 'inspect', '--format', '{{json .Config}}', '--', image], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException
        if (e.code === 'ENOENT') return reject(new CoreError(500, 'docker is not installed or not on PATH'))
        if (/No such (image|object)/i.test(stderr || '')) return reject(new CoreError(404, `${image}: not pulled on this PC (docker pull ${image} first)`))
        return reject(new CoreError(502, (stderr || err.message).trim().split('\n').pop() || 'docker image inspect failed'))
      }
      try { resolve(JSON.parse(stdout) || {}) } catch { reject(new CoreError(502, `docker image inspect gave no config for ${image}`)) }
    })
  })

/** 'ashleykza/comfyui:latest' → 'ashleykza/comfyui', the key KNOWN_SOURCES uses (registry host and tag dropped). */
export function repoOf(image: string): string {
  let name = image.trim().split('@')[0]
  const [first, ...rest] = name.split('/')
  if (rest.length && (first.includes('.') || first.includes(':') || first === 'localhost')) name = rest.join('/')
  const last = name.split('/').pop() || ''
  if (last.includes(':')) name = name.slice(0, name.lastIndexOf(':'))
  return name.includes('/') ? name : `library/${name}`
}

export async function envFromImage(image: string, inspect: Inspector = dockerInspect): Promise<ImageEnv> {
  const ref = (image === 'prebuilt' ? PREBUILT_IMAGE : image).trim()
  if (!ref) throw bad('No image given')
  const config = await inspect(ref)
  const all = (config.Env || []).map((e) => { const i = e.indexOf('='); return i < 0 ? { key: e, value: '' } : { key: e.slice(0, i), value: e.slice(i + 1) } })
  const env = all.filter((e) => !SYSTEM_ENV.test(e.key))
  const labels = config.Labels || {}
  const buildSource = labels['org.opencontainers.image.source'] || KNOWN_SOURCES[repoOf(ref)] || null
  return { source: 'image', image: ref, env, build_args: [], skipped: all.length - env.length, build_source: buildSource }
}

/** GET /images/env as the page calls it: `source` is 'image' (default) or 'dockerfile'; `image` a reference or 'prebuilt'. */
export async function env(params: { source?: string; image?: string } = {}, inspect: Inspector = dockerInspect): Promise<ImageEnv> {
  const source = params.source || 'image'
  if (source === 'dockerfile') return envFromDockerfile()
  if (source !== 'image') throw bad("source must be 'image' or 'dockerfile'")
  return envFromImage(params.image || 'prebuilt', inspect)
}

// ----- the Dockerfile of an image, for the "Dockerfile" modal -----
export interface ImageConfig {
  created?: string | null
  config?: { Env?: string[] | null; ExposedPorts?: Record<string, unknown> | null; Entrypoint?: string[] | null; Cmd?: string[] | null; Labels?: Record<string, string> | null; WorkingDir?: string; User?: string }
  history?: { created_by?: string; empty_layer?: boolean }[] | null
}
export type Registry = (image: string) => Promise<ImageConfig>
export interface DockerfileView {
  image: string; created: string | null; labels: Record<string, string>
  env: string[]; ports: string[]; entrypoint: string[]; cmd: string[]; workdir: string
  built: string | null        // reconstructed from the image's build history: what ran, not the source file
  source: string | null; source_path: string | null   // the Dockerfile's text and where it came from (a path here, or a URL)
  source_kind: 'repo' | 'github' | null; source_url: string | null   // ours (this repo), or fetched from the image's source repository
  source_note: string | null   // why there is no source
  error: string | null
}

const run = (cmd: string, args: string[]) => new Promise<string>((resolve, reject) =>
  execFile(cmd, args, { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).toString().trim().split('\n').pop() || 'failed')) : resolve(stdout.toString()))))

/** The image's config and history straight from the registry (no pull): `docker buildx imagetools inspect`, then the local daemon. */
export const registryConfig: Registry = async (image) => {
  try {
    const d = JSON.parse(await run('docker', ['buildx', 'imagetools', 'inspect', image, '--format', '{{json .Image}}']))
    return (d.config ? d : d['linux/amd64'] || Object.values(d)[0]) as ImageConfig
  } catch (remote) {
    try {
      const d = JSON.parse(await run('docker', ['image', 'inspect', '--format', '{{json .}}', '--', image]))
      const hist = (await run('docker', ['history', '--no-trunc', '--format', '{{.CreatedBy}}', '--', image])).split('\n').filter(Boolean).reverse().map((created_by) => ({ created_by }))
      return { created: d.Created, config: d.Config, history: hist }
    } catch { throw remote }
  }
}

/** One build-history line back into a Dockerfile instruction. */
export function instructionOf(createdBy: string): string | null {
  let c = (createdBy || '').replace(/\s+# buildkit\s*$/, '').trim()
  if (!c) return null
  c = c.replace(/^\/bin\/sh -c #\(nop\)\s*/, '')
  const arg = c.match(/^(RUN|CMD) \|(\d+) ((?:[A-Za-z_][A-Za-z0-9_]*=\S* ?)*)\/bin\/sh -c (.*)$/s)
  if (arg) return `${arg[3].trim() ? '# build args: ' + arg[3].trim() + '\n' : ''}RUN ${arg[4].trim()}`
  if (c.startsWith('/bin/sh -c ')) return `RUN ${c.slice('/bin/sh -c '.length).trim()}`
  return c
}

/** Where an image's source repository is: its own label, else a known one. Only GitHub is read. */
export function sourceRepoOf(image: string, labels: Record<string, string>): string | null {
  const url = labels['org.opencontainers.image.source'] || KNOWN_SOURCES[repoOf(image)] || ''
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.#]+)/)
  return m ? `https://github.com/${m[1]}/${m[2]}` : null
}
const OURS = (image: string, labels: Record<string, string>) => !!labels['dev.bluecollar.comfy-node-packs'] || /(^|\/)comfy-app(:|$)/.test(image)
export type Fetcher = (url: string) => Promise<string | null>
const fetchText: Fetcher = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(15_000) }); return r.ok ? await r.text() : null } catch { return null } }
const DOCKERFILE_PATHS = ['Dockerfile', 'docker/Dockerfile', 'build/Dockerfile', 'Dockerfile.cuda']

export async function dockerfile(params: { image?: string } = {}, registry: Registry = registryConfig, get: Fetcher = fetchText): Promise<DockerfileView> {
  const image = (params.image || '').trim()
  const out: DockerfileView = { image, created: null, labels: {}, env: [], ports: [], entrypoint: [], cmd: [], workdir: '', built: null, source: null, source_path: null, source_kind: null, source_url: null, source_note: null, error: null }
  if (!image) { out.error = 'No image'; return out }
  try {
    const d = await registry(image)
    const c = d.config || {}
    out.created = d.created || null; out.labels = c.Labels || {}; out.env = c.Env || []; out.ports = Object.keys(c.ExposedPorts || {})
    out.entrypoint = c.Entrypoint || []; out.cmd = c.Cmd || []; out.workdir = c.WorkingDir || ''
    const steps = (d.history || []).map((h) => instructionOf(h.created_by || '')).filter(Boolean) as string[]
    out.built = steps.length ? `# Reconstructed from ${image}'s build history: what ran, in order. Not the source file.\n` + steps.join('\n') + '\n' : null
  } catch (e) { out.error = (e as Error).message }
  // The source: ours is this repo's Dockerfile; any other image's is read from its source repository.
  if (OURS(image, out.labels)) {
    const file = dockerfilePath()
    if (existsSync(file)) { out.source = readFileSync(file, 'utf8'); out.source_path = file; out.source_kind = 'repo' }
    else out.source_note = 'This repo\'s Dockerfile is not on this machine.'
  } else {
    const repo = sourceRepoOf(image, out.labels)
    if (!repo) out.source_note = 'No source repository is known for this image: it has no org.opencontainers.image.source label and is not in the known list.'
    else {
      const [owner, name] = repo.replace('https://github.com/', '').split('/')
      for (const path of DOCKERFILE_PATHS) {
        const url = `https://raw.githubusercontent.com/${owner}/${name}/HEAD/${path}`
        const text = await get(url)
        if (text) { out.source = text; out.source_path = `${repo}/blob/HEAD/${path}`; out.source_kind = 'github'; out.source_url = repo; break }
      }
      if (!out.source) { out.source_url = repo; out.source_note = `No Dockerfile found at the root of ${repo}; open the repository to look.` }
    }
  }
  return out
}
