import { readFileSync } from 'node:fs'
import * as mounts from '../src/mounts.js'
import * as journal from '../src/journal.js'
import type * as podpull from '../src/podpull.js'

export const VOL = 'a3upg9ey48'
/** The S3 keys and a configuration whose volume is in an S3 datacenter: what a test needs for the journal to have somewhere to write. */
export function s3Env() {
  process.env.RUNPOD_S3_ACCESS_KEY = 'user_x'; process.env.RUNPOD_S3_SECRET_KEY = 'rps_y'
  const cfg = mounts.defaults(); cfg.dry_run = false; cfg.data_center_id = 'EU-RO-1'; cfg.shared_volume_id = VOL; cfg.network_volume_id = VOL; mounts.save(cfg)
  journal.forgetCache()
}
export const noS3Env = () => { delete process.env.RUNPOD_S3_ACCESS_KEY; delete process.env.RUNPOD_S3_SECRET_KEY }

/** An in-memory bucket behind a fake `aws`: s3api list-objects-v2 (prefix, start-after, max-items), s3 cp (up, down, to stdout), s3 rm, s3 ls (rows with a modified time). */
export function fakeBucket(initial: Record<string, string | { body?: string; size?: number; modified?: string }> = {}) {
  const store = new Map<string, { body: string; size: number; modified: string }>()
  const put = (k: string, v: string | { body?: string; size?: number; modified?: string }) => { const o = typeof v === 'string' ? { body: v } : v; store.set(k, { body: o.body ?? '', size: o.size ?? (o.body ?? '').length, modified: o.modified ?? '2026-11-18 10:00:00' }) }
  for (const [k, v] of Object.entries(initial)) put(k, v)
  const calls: string[][] = []
  const flag = (args: string[], f: string) => { const i = args.indexOf(f); return i < 0 ? undefined : args[i + 1] }
  const aws: podpull.AwsRunner = async (args) => {
    calls.push(args)
    if (args[0] === 's3api' && args[1] === 'list-objects-v2') {
      const prefix = flag(args, '--prefix') ?? '', after = flag(args, '--start-after') ?? '', max = Number(flag(args, '--max-items') ?? 1e9)
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix) && k > after).sort()
      const page = keys.slice(0, max)
      return { code: 0, stdout: page.length ? JSON.stringify({ Contents: page.map((Key) => ({ Key, Size: store.get(Key)!.size })), ...(keys.length > max ? { NextToken: 'x' } : {}) }) : '', stderr: '' }
    }
    if (args[0] === 's3' && args[1] === 'cp') {
      const [src, dst] = [args[2], args[3]]
      if (src.startsWith('s3://') && dst === '-') { const k = src.replace(/^s3:\/\/[^/]+\//, ''); const e = store.get(k); return e ? { code: 0, stdout: e.body, stderr: '' } : { code: 1, stdout: '', stderr: 'NoSuchKey' } }
      if (dst.startsWith('s3://')) { put(dst.replace(/^s3:\/\/[^/]+\//, ''), { body: readFileSync(src, 'utf8') }); return { code: 0, stdout: '', stderr: '' } }
    }
    if (args[0] === 's3' && args[1] === 'rm') { store.delete(args[2].replace(/^s3:\/\/[^/]+\//, '')); return { code: 0, stdout: '', stderr: '' } }
    if (args[0] === 's3' && args[1] === 'ls') {
      const url = args[2], prefix = url.replace(/^s3:\/\/[^/]+\//, ''), recursive = args.includes('--recursive')
      const lines: string[] = []; const seen = new Set<string>()
      for (const k of [...store.keys()].sort()) {
        if (!k.startsWith(prefix)) continue
        const rest = k.slice(prefix.length), e = store.get(k)!
        if (recursive) lines.push(`${e.modified} ${String(e.size).padStart(10)} ${k}`)
        else { const i = rest.indexOf('/'); if (i < 0) lines.push(`${e.modified} ${String(e.size).padStart(10)} ${rest}`); else if (!seen.has(rest.slice(0, i))) { seen.add(rest.slice(0, i)); lines.push(`                           PRE ${rest.slice(0, i)}/`) } }
      }
      return { code: 0, stdout: lines.join('\n'), stderr: '' }
    }
    return { code: 1, stdout: '', stderr: `unhandled ${args.join(' ')}` }
  }
  return { aws, store, put, calls, keys: () => [...store.keys()].sort() }
}
