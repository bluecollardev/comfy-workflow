/** An error with an HTTP-ish status, so an adapter (IPC or HTTP) can report it as the Python API did. */
export class CoreError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'CoreError'
  }
}
export const bad = (message: string) => new CoreError(400, message)
