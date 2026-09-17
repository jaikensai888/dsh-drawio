import { createReadStream } from 'node:fs'
import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, normalize, resolve, sep } from 'node:path'
import { DrawioError, writeError } from './net/http.js'
import { isDocumentType, mimeTypeForPath } from './net/mime.js'

/** URL prefix that maps onto the extracted webapp root. */
export const WEBAPP_MOUNT = '/drawio/webapp'

/**
 * The one network-level boundary this plugin owns.
 *
 * `connect-src 'self'` is the real gate: no matter what the editor tries to
 * reach, it cannot open a connection to another origin. `'unsafe-inline'` is
 * required by drawio's inline styles/scripts. `frame-src 'self'` (rather than
 * PLAN's `'none'`) still blocks every external frame while leaving drawio's own
 * same-origin sub-frames working.
 */
export const DRAWIO_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'self'",
].join('; ')

export interface AssetHandlerOptions {
  /** Absolute webapp root, or undefined while the editor is not installed yet. */
  resolveRoot: () => Promise<string | undefined>
  /** URL prefix mapped to that root; defaults to {@link WEBAPP_MOUNT}. */
  mountPath?: string
}

type AssetHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
) => Promise<void>

interface ByteRange {
  start: number
  end: number
}

/** Strict `bytes=` single-range parser; undefined means "send the whole file". */
export function parseRange(header: string | undefined, size: number): ByteRange | undefined | 'unsatisfiable' {
  if (header === undefined || !header.startsWith('bytes=')) return undefined
  const spec = header.slice('bytes='.length).trim()
  // Multi-range requests are legal but pointless for our static assets.
  if (spec.includes(',')) return 'unsatisfiable'
  const dash = spec.indexOf('-')
  if (dash === -1) return 'unsatisfiable'
  const rawStart = spec.slice(0, dash).trim()
  const rawEnd = spec.slice(dash + 1).trim()

  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isInteger(suffix) || suffix <= 0) return 'unsatisfiable'
    const start = Math.max(0, size - suffix)
    return { start, end: size - 1 }
  }
  const start = Number(rawStart)
  if (!Number.isInteger(start) || start < 0 || start >= size) return 'unsatisfiable'
  if (rawEnd === '') return { start, end: size - 1 }
  const end = Number(rawEnd)
  if (!Number.isInteger(end) || end < start) return 'unsatisfiable'
  return { start, end: Math.min(end, size - 1) }
}

/** Quote an fs stat as a weak-free entity tag (never hashes file content). */
export function etagFor(info: Pick<Stats, 'mtimeMs' | 'size'>): string {
  return `"${Math.floor(info.mtimeMs).toString(16)}-${info.size.toString(16)}"`
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/**
 * Turn a request pathname into a decoded, relative, slash-free-of-traversal
 * path below the mount point.
 */
export function relativeAssetPath(pathname: string, mount: string = WEBAPP_MOUNT): string {
  if (pathname !== mount && !pathname.startsWith(`${mount}/`)) {
    throw new DrawioError('not-found', `不是编辑器资源路径：${pathname}`, 404)
  }
  const rest = pathname.slice(mount.length)
  if (rest === '' || rest === '/') return 'index.html'
  let decoded: string
  try {
    decoded = decodeURIComponent(rest)
  } catch {
    throw new DrawioError('bad-request', `资源路径无法解码：${rest}`)
  }
  if (decoded.includes('\0')) throw new DrawioError('bad-request', '资源路径包含空字节')
  // A NUL-free, decoded path; the caller still re-checks containment on disk.
  return decoded.replace(/^\/+/u, '')
}

/**
 * Containment check for the webapp root.
 *
 * ★ The separator MUST come from `path.sep`, not a hard-coded `/`: on Windows
 * `resolve()` yields backslashes, so comparing against `${root}/` rejects every
 * legitimate sub-path.
 */
export function resolveWithinRoot(root: string, relative: string): string {
  const base = resolve(root)
  const target = resolve(normalize(join(base, relative)))
  if (target !== base && !target.startsWith(base + sep)) {
    throw new DrawioError('forbidden', `资源路径越界：${relative}`, 403)
  }
  return target
}

/** Stream `<webappRoot>/**` with ETag/304, Range and a document CSP. */
export function createWebappAssetHandler(options: AssetHandlerOptions): AssetHandler {
  const mount = options.mountPath ?? WEBAPP_MOUNT

  return async (request, response, pathname) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        throw new DrawioError('method-not-allowed', '编辑器静态资源只支持 GET/HEAD', 405)
      }
      const root = await options.resolveRoot()
      if (root === undefined) {
        throw new DrawioError('not-ready', 'draw.io 编辑器资源尚未就绪', 503)
      }

      let target = resolveWithinRoot(root, relativeAssetPath(pathname, mount))

      let info = await statFile(target)
      if (info === undefined) throw new DrawioError('not-found', `资源不存在：${pathname}`, 404)
      if (info.isDirectory()) {
        // Only the mount root is expected to be a directory.
        target = resolveWithinRoot(root, join(relativeAssetPath(pathname, mount), 'index.html'))
        info = await statFile(target)
        if (info === undefined) throw new DrawioError('not-found', `资源不存在：${pathname}`, 404)
      }
      if (!info.isFile()) throw new DrawioError('not-found', `资源不是普通文件：${pathname}`, 404)

      const mimeType = mimeTypeForPath(target)
      const etag = etagFor(info)
      const lastModified = new Date(info.mtimeMs).toUTCString()

      const headers: Record<string, string> = {
        'content-type': mimeType,
        'cache-control': 'no-cache',
        'etag': etag,
        'last-modified': lastModified,
        'accept-ranges': 'bytes',
        'x-content-type-options': 'nosniff',
      }
      if (isDocumentType(mimeType)) headers['content-security-policy'] = DRAWIO_CSP

      // Revalidation is the intended path: `no-cache` + a strong-ish ETag.
      if (headerValue(request.headers['if-none-match']) === etag) {
        response.writeHead(304, headers)
        response.end()
        return
      }

      const range = parseRange(headerValue(request.headers['range']), info.size)
      if (range === 'unsatisfiable') {
        response.writeHead(416, { ...headers, 'content-range': `bytes */${String(info.size)}` })
        response.end()
        return
      }

      if (range === undefined) {
        response.writeHead(200, { ...headers, 'content-length': String(info.size) })
        if (request.method === 'HEAD') {
          response.end()
          return
        }
        streamFile(target, response)
        return
      }

      const length = range.end - range.start + 1
      response.writeHead(206, {
        ...headers,
        'content-range': `bytes ${String(range.start)}-${String(range.end)}/${String(info.size)}`,
        'content-length': String(length),
      })
      if (request.method === 'HEAD') {
        response.end()
        return
      }
      streamFile(target, response, range)
    } catch (error) {
      writeError(response, error)
    }
  }
}

async function statFile(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw error
  }
}

/**
 * Pipe a file into the response and tear the stream down with the socket —
 * DSH had no streaming precedent before this, and a leaked read stream on a
 * 147 MB tree is how a sidebar ends up holding file handles.
 */
function streamFile(path: string, response: ServerResponse, range?: ByteRange): void {
  const stream = range === undefined
    ? createReadStream(path)
    : createReadStream(path, { start: range.start, end: range.end })

  response.on('close', () => {
    stream.destroy()
  })
  stream.on('error', () => {
    // Headers are already out; the only honest signal left is a broken socket.
    response.destroy()
  })
  stream.pipe(response)
}
