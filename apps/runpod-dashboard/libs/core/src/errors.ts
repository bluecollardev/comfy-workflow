/** An error with an HTTP-ish status, so an adapter (IPC or HTTP) can report it as the Python API did. */
export class CoreError extends Error {
  /** A machine-readable reason a caller can act on without parsing the text: `host_full` (a stopped pod's host has no free GPU), `no_card` (a create found no card in stock). */
  /** `hint` is a sentence for the person that says what to do about it (a folder the OS will not let the app read: where to allow it). */
  constructor(public status: number, message: string, public code?: string, public hint?: string) {
    super(message)
    this.name = 'CoreError'
  }
}
export const bad = (message: string) => new CoreError(400, message)
