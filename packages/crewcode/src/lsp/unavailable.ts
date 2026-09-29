export class UnavailableError extends Error {
  constructor(
    readonly serverID: string,
    message: string,
  ) {
    super(message)
    this.name = "LSPUnavailableError"
  }
}
