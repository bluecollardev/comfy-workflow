// A hook the Electron main process sets (electron/stall-monitor.cjs) so the core's timers can be named in stalls.log.
// Without a hook a tick is just the function. The hook times the synchronous part only and records the name, nothing else.
type Hook = (name: string, fn: () => unknown) => unknown
let hook: Hook | null = null
export const setTickHook = (h: Hook | null): void => { hook = h }
/** Run `fn` as the named timer tick. */
export const timedTick = <T>(name: string, fn: () => T): T => (hook ? (hook(name, fn) as T) : fn())
