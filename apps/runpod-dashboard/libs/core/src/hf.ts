/**
 * Hugging Face as a source of model files for the shared volume (ADR-042). Search and file lists are read from huggingface.co's public API;
 * a download is never built from what the caller sends: the repo and path are looked up again here (size and sha256 come from Hugging Face),
 * only weight files are allowed, and the destination is one of a fixed list of ComfyUI model folders.
 */
import { bad, CoreError } from './errors.js'

export const HF = 'https://huggingface.co'
/** Where a file may be put: the folders of `models/` that hold weights. */
export const FOLDERS = ['diffusion_models', 'vae', 'checkpoints', 'loras', 'text_encoders', 'clip', 'clip_vision', 'controlnet', 'upscale_models', 'embeddings'] as const
export type Folder = typeof FOLDERS[number]
/** Weight files only: no scripts, no archives. (.pth is what the upscalers ship; ComfyUI loads it with weights_only.) */
export const EXTENSIONS = ['safetensors', 'gguf', 'pth'] as const
const extOf = (p: string) => (p.split('.').pop() || '').toLowerCase()

export interface HfRepo { id: string; downloads: number; likes: number; updated: string | null; gated: boolean }
export interface HfFile { path: string; bytes: number; sha256: string; folder: Folder }

const REPO = /^[A-Za-z0-9][\w.-]{0,95}\/[A-Za-z0-9][\w.-]{0,95}$/
export const assertRepo = (repo: string) => { if (!REPO.test(repo)) throw bad(`Not a Hugging Face repo (owner/name): ${repo}`); return repo }
export const assertRevision = (rev: string) => { if (!/^[\w.-]{1,80}$/.test(rev)) throw bad(`Not a revision: ${rev}`); return rev }
export const safePath = (p: string) => { if (!p || p.startsWith('/') || p.split('/').some((s) => s === '..' || s === '' || s === '.') || /[\0\\]/.test(p)) throw bad(`Not a file path: ${p}`); return p }

/** The folder a file most likely belongs in, from its path and name. A guess the user can change. */
export function guessFolder(path: string): Folder {
  const s = path.toLowerCase()
  if (/(^|\/|[_-])vae([_.\/-]|$)/.test(s)) return 'vae'
  if (/lora/.test(s)) return 'loras'
  if (/controlnet/.test(s)) return 'controlnet'
  if (/upscal|esrgan|swinir|realesr/.test(s) || extOf(path) === 'pth') return 'upscale_models'
  if (/clip[_-]?vision|siglip|vision_tower/.test(s)) return 'clip_vision'
  if (/text_encoder|t5|umt5|llama|qwen|gemma/.test(s)) return 'text_encoders'
  if (/(^|\/|[_-])clip([_.\/-]|$)/.test(s)) return 'clip'
  if (/embedding|textual/.test(s)) return 'embeddings'
  if (/checkpoint|ckpt|sd_xl|sdxl_base|v1-5/.test(s)) return 'checkpoints'
  return 'diffusion_models'
}

const getJson = async (fetchFn: typeof fetch, url: string): Promise<unknown> => {
  const r = await fetchFn(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  if (r.status === 404) throw new CoreError(404, 'Hugging Face has no such repo.')
  if (r.status === 401 || r.status === 403) throw new CoreError(403, 'That repo is gated or private: Hugging Face wants a login and an accepted licence, which a pod cannot give.')
  if (r.status !== 200) throw new CoreError(502, `Hugging Face answered HTTP ${r.status}.`)
  return r.json()
}

export async function search(query: string, fetchFn: typeof fetch = fetch): Promise<HfRepo[]> {
  const qs = String(query ?? '').trim().slice(0, 100)
  if (qs.length < 2) throw bad('Type at least two characters to search.')
  const j = (await getJson(fetchFn, `${HF}/api/models?search=${encodeURIComponent(qs)}&limit=25&sort=downloads&direction=-1`)) as { id?: string; modelId?: string; downloads?: number; likes?: number; lastModified?: string; gated?: boolean | string }[]
  return (Array.isArray(j) ? j : []).map((m) => ({ id: String(m.id || m.modelId || ''), downloads: Number(m.downloads) || 0, likes: Number(m.likes) || 0, updated: m.lastModified ? String(m.lastModified).slice(0, 10) : null, gated: !!m.gated })).filter((m) => REPO.test(m.id))
}

/** A repo's weight files with exact sizes and sha256 (Hugging Face's LFS ids), the biggest last. */
export async function files(repo: string, revision = 'main', fetchFn: typeof fetch = fetch): Promise<HfFile[]> {
  assertRepo(repo); assertRevision(revision)
  const j = (await getJson(fetchFn, `${HF}/api/models/${repo}/tree/${revision}?recursive=true`)) as { type?: string; path?: string; size?: number; lfs?: { oid?: string; size?: number } }[]
  return (Array.isArray(j) ? j : [])
    .filter((f) => f.type === 'file' && typeof f.path === 'string' && (EXTENSIONS as readonly string[]).includes(extOf(f.path)) && f.lfs?.oid && /^[0-9a-f]{64}$/.test(f.lfs.oid))
    .map((f) => ({ path: f.path!, bytes: Number(f.lfs?.size ?? f.size) || 0, sha256: f.lfs!.oid!, folder: guessFolder(f.path!) }))
    .sort((a, b) => a.bytes - b.bytes)
}

export interface FetchItem { repo: string; path: string; revision?: string; folder: string }
export interface Resolved { repo: string; revision: string; path: string; name: string; folder: Folder; bytes: number; sha256: string; url: string }

/** What a download request really is: every item looked up on Hugging Face again (so the URL, size and hash are Hugging Face's, not the caller's) and held to the allowed folders and file types. */
export async function resolve(items: FetchItem[], fetchFn: typeof fetch = fetch): Promise<Resolved[]> {
  if (!Array.isArray(items) || !items.length) throw bad('Choose at least one file.')
  if (items.length > 20) throw bad('At most 20 files at a time.')
  const cache = new Map<string, HfFile[]>(), out: Resolved[] = []
  for (const it of items) {
    const repo = assertRepo(String(it.repo)), revision = assertRevision(String(it.revision || 'main')), path = safePath(String(it.path))
    if (!(FOLDERS as readonly string[]).includes(it.folder)) throw bad(`Not a models folder: ${it.folder} (one of ${FOLDERS.join(', ')}).`)
    const key = `${repo}@${revision}`
    if (!cache.has(key)) cache.set(key, await files(repo, revision, fetchFn))
    const f = cache.get(key)!.find((x) => x.path === path)
    if (!f) throw bad(`${repo} has no weight file ${path} (only ${EXTENSIONS.join(', ')} files are fetched).`)
    const name = path.split('/').pop()!
    if (!/^[\w.+\- ]{1,200}$/.test(name)) throw bad(`Unsafe file name: ${name}`)
    out.push({ repo, revision, path, name, folder: it.folder as Folder, bytes: f.bytes, sha256: f.sha256, url: `${HF}/${repo}/resolve/${revision}/${path.split('/').map(encodeURIComponent).join('/')}` })
  }
  return out
}
