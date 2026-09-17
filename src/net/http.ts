import type { ServerResponse } from 'node:http'

/** Error codes carried in the `{ ok:false, error:{ code } }` envelope. */
export type DrawioErrorCode =
  | 'bad-request'
  | 'forbidden'
  | 'not-found'
  | 'method-not-allowed'
  | 'conflict'
  | 'fs-error'
  | 'not-ready'
  | 'unavailable'
  | 'internal'

/**
 * An error we deliberately translate into an HTTP status plus envelope.
 * Anything else that escapes a handler becomes a 500 `internal`.
 */
export class DrawioError extends Error {
  readonly code: DrawioErrorCode
  readonly status: number

  constructor(code: DrawioErrorCode, message: string, status = 400) {
    super(message)
    this.name = 'DrawioError'
    this.code = code
    this.status = status
  }
}

/** The response shape shared by every `/drawio/**` JSON route. */
export type DrawioEnvelope<T> =
  | { ok: true, value: T }
  | { ok: false, error: { code: DrawioErrorCode | 'internal', message: string } }

/** Write a JSON response. A response whose headers already went out is destroyed. */
export function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

/** Write a success envelope. */
export function writeOk<T>(response: ServerResponse, value: T, status = 200): void {
  writeJson(response, status, { ok: true, value } satisfies DrawioEnvelope<T>)
}

/** Write a failure envelope, deriving status/code from the thrown value. */
export function writeError(response: ServerResponse, error: unknown): void {
  const { status, code, message } = toDrawioHttpError(error)
  writeJson(response, status, {
    ok: false,
    error: { code, message },
  } satisfies DrawioEnvelope<never>)
}

/** Normalise any thrown value into `{ status, code, message }`. */
export function toDrawioHttpError(error: unknown): {
  status: number
  code: DrawioErrorCode | 'internal'
  message: string
} {
  if (error instanceof DrawioError) {
    return { status: error.status, code: error.code, message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { status: 500, code: 'internal', message }
}
