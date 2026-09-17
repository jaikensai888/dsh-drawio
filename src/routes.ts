import type { IncomingMessage, ServerResponse } from 'node:http'
import { DrawioError, writeError, writeOk } from './net/http.js'

/**
 * The one and only `webServer.register` call this plugin ever makes.
 *
 * `webServer.register` throws on a duplicate `(kind, path)` pair and that
 * failure takes the whole plugin tree down, so every `/drawio/**` endpoint
 * lives behind this single prefix route and is dispatched internally by
 * sub-path. Do not add a second registration anywhere in this package.
 */
export const DRAWIO_ROUTE_PREFIX = '/drawio'

type SubRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
) => void | Promise<void>

/** Sub-path (relative to {@link DRAWIO_ROUTE_PREFIX}) → handler. */
const ROUTES = new Map<string, SubRouteHandler>([
  ['/ping', handlePing],
])

/**
 * P0 liveness probe. Reaching this endpoint at all proves the host half
 * mounted *and* that the single prefix route registered without colliding
 * with an existing `(kind, path)` — a collision aborts plugin-tree startup,
 * in which case this handler would never be reachable.
 */
function handlePing(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new DrawioError('method-not-allowed', 'GET /drawio/ping 只接受 GET/HEAD 请求', 405)
  }
  writeOk(response, {
    plugin: 'dsh-drawio',
    phase: 'P0-skeleton',
    routePrefix: DRAWIO_ROUTE_PREFIX,
    pid: process.pid,
    now: new Date().toISOString(),
  })
}

/** The `webServer.register({ kind: 'prefix', path: '/drawio' })` handler. */
export function createDrawioRouteHandler(): (
  request: IncomingMessage,
  response: ServerResponse,
) => void {
  return (request, response) => {
    void dispatch(request, response)
  }
}

async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const pathname = resolvePathname(request.url)
    const subPath = stripPrefix(pathname)
    const handler = ROUTES.get(subPath)
    if (handler === undefined) {
      throw new DrawioError('not-found', `未知的 dsh-drawio 路由：${pathname}`, 404)
    }
    await handler(request, response, pathname)
  } catch (error) {
    // Never let a handler error escape: webServer would answer 400/500 and
    // log a warning, but we want our own envelope and status codes.
    writeError(response, error)
  }
}

/** Slice the route prefix off a pathname, returning `/` for the bare prefix. */
function stripPrefix(pathname: string): string {
  if (!pathname.startsWith(DRAWIO_ROUTE_PREFIX)) {
    throw new DrawioError('not-found', `dsh-drawio 只服务 ${DRAWIO_ROUTE_PREFIX} 前缀：${pathname}`, 404)
  }
  const rest = pathname.slice(DRAWIO_ROUTE_PREFIX.length)
  return rest === '' ? '/' : rest
}

/** Parse a request URL down to its pathname (never throws on junk input). */
function resolvePathname(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname
  } catch {
    throw new DrawioError('bad-request', `无法解析请求路径：${String(rawUrl)}`)
  }
}
