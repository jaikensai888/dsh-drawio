import type { IncomingMessage, ServerResponse } from 'node:http'

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
 *
 * `details` is an optional machine-readable side-channel for errors the client
 * must act on — a 409 carries the current on-disk mtime so the conflict UI can
 * offer "reload / overwrite" without another round trip.
 */
export class DrawioError extends Error {
  readonly code: DrawioErrorCode
  readonly status: number
  readonly details: Record<string, unknown> | undefined

  constructor(code: DrawioErrorCode, message: string, status = 400, details?: Record<string, unknown>) {
    super(message)
    this.name = 'DrawioError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** The response shape shared by every `/drawio/**` JSON route. */
export type DrawioEnvelope<T> =
  | { ok: true, value: T }
  | {
    ok: false
    error: { code: DrawioErrorCode | 'internal', message: string, details?: Record<string, unknown> }
  }

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

/** Write a failure envelope, deriving status/code/details from the thrown value. */
export function writeError(response: ServerResponse, error: unknown): void {
  const { status, code, message, details } = toDrawioHttpError(error)
  writeJson(response, status, {
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  } satisfies DrawioEnvelope<never>)
}

/** Normalise any thrown value into `{ status, code, message, details }`. */
export function toDrawioHttpError(error: unknown): {
  status: number
  code: DrawioErrorCode | 'internal'
  message: string
  details?: Record<string, unknown>
} {
  if (error instanceof DrawioError) {
    return error.details === undefined
      ? { status: error.status, code: error.code, message: error.message }
      : { status: error.status, code: error.code, message: error.message, details: error.details }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { status: 500, code: 'internal', message }
}

/** Largest JSON request body we accept (a diagram plus envelope). */
const MAX_JSON_BODY_BYTES = 80 * 1024 * 1024

/**
 * Read and parse a JSON request body.
 *
 * `webServer` hands us raw `node:http` requests — there is no body helper — so
 * this owns the stream lifecycle: it destroys the socket on an oversized body
 * rather than buffering it.
 */
export async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += buffer.byteLength
    if (total > MAX_JSON_BODY_BYTES) {
      request.destroy()
      throw new DrawioError('bad-request', '请求体过大')
    }
    chunks.push(buffer)
  }

  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new DrawioError('bad-request', '请求体不是合法 JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DrawioError('bad-request', '请求体必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}
