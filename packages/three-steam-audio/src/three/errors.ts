export class SteamAudioError extends Error {
  readonly operation: string
  readonly status?: number

  constructor(operation: string, message: string, status?: number) {
    super(status === undefined ? `${operation}: ${message}` : `${operation} failed with status ${status}: ${message}`)
    this.name = 'SteamAudioError'
    this.operation = operation
    this.status = status
  }
}

export const assertNativeStatus = (operation: string, status: number): void => {
  if (status !== 0)
    throw new SteamAudioError(operation, 'Steam Audio rejected the operation', status)
}
