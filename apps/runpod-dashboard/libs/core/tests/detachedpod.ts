import type * as podpull from '../src/podpull.js'

/**
 * A pod that speaks the detached protocol (ADR-042 section 17) without a pod: the app starts a script once (detachScript), then follows its log
 * with short calls (followScript). This fake keeps the log as lines, serves it from the byte offset the follow call asks for, and says whether the
 * script has ended, the way followScript does on a pod. `run` is the script's behaviour: it gets the script text and a `push` for the lines it prints.
 */
export interface DetachedPod {
  ssh: podpull.SshRunner
  calls: podpull.SshJob[]
  /** the log, as the pod holds it */ log: string[]
  /** how many times the script was started / how many kill calls came */ started: number; kills: number
  /** the next n ssh calls of any kind fail the way a dropped connection does (exit 255) */ drop: number
  /** every call fails from now on */ down: boolean
  exit: number | null
  /** the script text the app sent to start the run */ script: string
}
export function detachedPod(run: (script: string, push: (line: string) => void, pod: DetachedPod) => Promise<number | void>, opts: { perCall?: boolean } = {}): DetachedPod {
  const pod: DetachedPod = { calls: [], log: [], started: 0, kills: 0, drop: 0, down: false, exit: null, script: '', ssh: async (job) => {
    pod.calls.push(job)
    if (pod.down) return { code: 255 }
    if (pod.drop > 0) { pod.drop--; return { code: 255 } }
    const sc = job.script
    if (sc.includes('setsid nohup')) {   // detachScript
      if (pod.started === 0) {
        const m = /<<'(PODSCRIPT_[A-Z0-9]+)'\n([\s\S]*?)\n\1\n/.exec(sc)
        pod.script = m ? m[2] : ''
        pod.started++
        void Promise.resolve(run(pod.script, (l) => { pod.log.push(l) }, pod)).then((c) => { pod.exit = typeof c === 'number' ? c : 0 }, () => { pod.exit = 1 })
        job.onLine('DETACHED')
      } else job.onLine('DETACHED already running')
      return { code: 0 }
    }
    if (sc.includes('FOLLOW-AT')) {   // followScript
      const off = Number(/OFF=(\d+)/.exec(sc)![1])
      const buf = Buffer.from(pod.log.length ? pod.log.join('\n') + '\n' : '')
      if (buf.length < off) { job.onLine('FOLLOW-RESET'); return { code: 0 } }
      let chunk = buf.subarray(off).toString()
      if (opts.perCall) { const k = chunk.indexOf('\n'); if (k >= 0) chunk = chunk.slice(0, k + 1) }
      const lines = chunk.split('\n'); if (lines[lines.length - 1] === '') lines.pop()
      for (const l of lines) job.onLine(l)
      job.onLine(`FOLLOW-AT ${Buffer.byteLength(chunk)}`)
      const all = off + Buffer.byteLength(chunk) >= buf.length
      if (pod.exit !== null && all) job.onLine(`FOLLOW-EXIT ${pod.exit}`)
      else if (!all) job.onLine('FOLLOW-MORE')
      else job.onLine('FOLLOW-RUNNING')
      return { code: 0 }
    }
    if (sc.includes('kill -TERM --')) { pod.kills++; return { code: 0 } }
    return { code: 0 }
  } }
  return pod
}
