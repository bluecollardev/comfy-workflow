// The application's own log: everything the main process prints (console.log/info/warn/error), what the window's page reports as a warning or an error,
// unhandled errors and the crash of a process, written to <config folder>/app-logs/<day>.log, one line each: `2026-11-20T15:48:12.345Z ERROR text`.
// Never throws and never gets in the way of the app. Secrets are cut out of every line before it is written (keys, bearer tokens, a signed link's signature).
// Nothing here deletes a log: the person purges them (the `app_logs` MCP tool, with a yes).
const fs = require('node:fs')
const path = require('node:path')

const MAX_LINE = 4000, MAX_DAY_BYTES = 50 * 1024 * 1024
const SECRETS = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [secret]'],
  [/\b(rpa_|sk-ant-|xox[abp]-|hf_|ghp_|github_pat_)[A-Za-z0-9_-]{8,}/g, '$1[secret]'],
  [/\bAKIA[0-9A-Z]{12,}\b/g, '[access key]'],
  [/(X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s"']+/gi, '$1[secret]'],
  [/(api[_-]?key|secret|token|password|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}&]{6,}/gi, '$1$2[secret]'],
  [/(https:\/\/hooks\.slack\.com\/services\/)[A-Za-z0-9/]+/g, '$1[secret]'],
]
const redact = (s) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), String(s))
const text = (args) => args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.name}: ${a.message}\n${a.stack || ''}` : (() => { try { return JSON.stringify(a) } catch { return String(a) } })())).join(' ')

function createAppLog(opts = {}) {
  const { dir, now = () => new Date(), fsImpl = fs } = opts
  const sizes = new Map()
  function write(level, msg) {
    if (!dir) return
    try {
      const t = now(), day = t.toISOString().slice(0, 10), file = path.join(dir, `${day}.log`)
      fsImpl.mkdirSync(dir, { recursive: true })
      let n = sizes.get(day); if (n === undefined) { try { n = fsImpl.statSync(file).size } catch { n = 0 } }
      if (n > MAX_DAY_BYTES) return   // a runaway log stops here for the day; the file keeps what it has
      const clean = redact(msg).replace(/\r?\n/g, '\n  ').slice(0, MAX_LINE), line = `${t.toISOString()} ${level.toUpperCase()} ${clean}\n`
      fsImpl.appendFileSync(file, line); sizes.set(day, n + Buffer.byteLength(line))
    } catch { /* the log never gets in the way */ }
  }
  /** Tee the process's console into the log, keep it printing, and log what would otherwise vanish. */
  function install(proc = process, con = console) {
    for (const [name, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
      const orig = con[name].bind(con)
      con[name] = (...args) => { write(level, text(args)); orig(...args) }
    }
    proc.on('uncaughtException', (e) => write('error', `uncaught exception: ${text([e])}`))
    proc.on('unhandledRejection', (e) => write('error', `unhandled rejection: ${text([e])}`))
    write('info', `app log started (pid ${proc.pid}, node ${proc.versions?.node}, electron ${proc.versions?.electron})`)
  }
  /** The window's page: its console warnings and errors, a page that failed to load, a renderer that died. */
  function watchWindow(webContents) {
    webContents.on('console-message', (e, level, message, line, source) => {
      const d = e && typeof e === 'object' && 'level' in e ? e : { level, message, lineNumber: line, sourceId: source }   // Electron 44 passes one details object
      const lv = typeof d.level === 'string' ? d.level : ['verbose', 'info', 'warning', 'error'][d.level] || 'info'
      if (lv === 'warning' || lv === 'error') write(lv === 'error' ? 'error' : 'warn', `page ${d.sourceId ? path.basename(String(d.sourceId)) : ''}:${d.lineNumber ?? ''} ${d.message ?? ''}`.trim())
    })
    webContents.on('render-process-gone', (_e, details) => write('error', `the page process is gone: ${details?.reason} (exit ${details?.exitCode})`))
    webContents.on('did-fail-load', (_e, code, desc, url) => write('error', `the page failed to load: ${desc} (${code}) ${String(url).replace(/\?.*$/, '')}`))
    webContents.on('unresponsive', () => write('warn', 'the page stopped responding'))
    webContents.on('responsive', () => write('info', 'the page responds again'))
  }
  return { write, install, watchWindow, redact }
}
module.exports = { createAppLog, redact }
