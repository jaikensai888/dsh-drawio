import type { IncomingMessage, ServerResponse } from 'node:http'
import { createWebappAssetHandler } from './assets.js'
import {
  createDiagram,
  diagramExists,
  listDiagrams,
  readDiagram,
  writeDiagram,
  type CreateDiagramOptions,
} from './diagrams.js'
import { DrawioError, readJsonBody, writeError, writeOk } from './net/http.js'
import { isTrustedApiRequest } from './net/trust-fence.js'
import type { WebappInstaller } from './webapp-install.js'

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

export interface DrawioRouteDeps {
  installer: WebappInstaller
  /** Live non-loopback authorities this deployment serves (from `webRuntime`). */
  trustedHosts: () => readonly string[]
  /**
   * Authoritative workspace cwd for a session. `header.cwd` wins; the client's
   * cwd is only a hydration fallback, and `process.cwd()` the last resort.
   */
  resolveSessionCwd: (sessionId: string, clientCwd?: string) => string
}

/** Build the dispatch table for the single `/drawio` prefix route. */
export function createDrawioRouteHandler(deps: DrawioRouteDeps): (
  request: IncomingMessage,
  response: ServerResponse,
) => void {
  const exact = new Map<string, SubRouteHandler>([
    ['/ping', handlePing],
    ['/api/webapp-status', (request, response) => handleWebappStatus(request, response, deps.installer)],
    ['/api/read', (request, response) => handleRead(request, response, deps)],
    ['/api/write', (request, response) => handleWrite(request, response, deps)],
    ['/api/create', (request, response) => handleCreate(request, response, deps)],
    ['/api/list', (request, response) => handleList(request, response, deps)],
    ['/api/exists', (request, response) => handleExists(request, response, deps)],
  ])

  // Longest prefix first; every entry owns its own path parsing.
  const prefixed: ReadonlyArray<readonly [string, SubRouteHandler]> = [
    ['/webapp', createWebappAssetHandler({
      resolveRoot: async () => {
        const status = await deps.installer.status()
        return status.ready ? deps.installer.webappRoot : undefined
      },
    })],
  ]

  return (request, response) => {
    void dispatch(request, response, exact, prefixed, deps)
  }
}

async function dispatch(
  request: IncomingMessage,
  response: ServerResponse,
  exact: ReadonlyMap<string, SubRouteHandler>,
  prefixed: ReadonlyArray<readonly [string, SubRouteHandler]>,
  deps: DrawioRouteDeps,
): Promise<void> {
  try {
    // Every /drawio route sits behind the same fence, including the static
    // webapp: an unauthenticated route that is reachable from a rebound
    // hostname would hand the whole editor to a hostile page.
    if (!isTrustedApiRequest(request, deps.trustedHosts())) {
      throw new DrawioError('forbidden', '请求未通过 dsh-drawio 信任围栏', 403)
    }

    const pathname = resolvePathname(request.url)
    const subPath = stripPrefix(pathname)

    const exactHandler = exact.get(subPath)
    if (exactHandler !== undefined) {
      await exactHandler(request, response, pathname)
      return
    }
    for (const [prefix, handler] of prefixed) {
      if (subPath === prefix || subPath.startsWith(`${prefix}/`)) {
        await handler(request, response, pathname)
        return
      }
    }
    throw new DrawioError('not-found', `未知的 dsh-drawio 路由：${pathname}`, 404)
  } catch (error) {
    // Never let a handler error escape: webServer would answer 400/500 and
    // log a warning, but we want our own envelope and status codes.
    writeError(response, error)
  }
}

/**
 * Liveness probe. Reaching this endpoint at all proves the host half mounted
 * *and* that the single prefix route registered without colliding with an
 * existing `(kind, path)` — a collision aborts plugin-tree startup, in which
 * case this handler would never be reachable.
 */
function handlePing(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new DrawioError('method-not-allowed', 'GET /drawio/ping 只接受 GET/HEAD 请求', 405)
  }
  writeOk(response, {
    plugin: 'dsh-drawio',
    routePrefix: DRAWIO_ROUTE_PREFIX,
    pid: process.pid,
    now: new Date().toISOString(),
  })
}

/**
 * Editor asset readiness. `GET` reports progress; `POST` starts (or joins) the
 * one-time download. The viewer polls `GET` while `ready` is false, which is
 * what keeps a first run from being a blank white rectangle.
 */
async function handleWebappStatus(
  request: IncomingMessage,
  response: ServerResponse,
  installer: WebappInstaller,
): Promise<void> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    writeOk(response, await installer.status())
    return
  }
  if (request.method === 'POST') {
    writeOk(response, await installer.ensure())
    return
  }
  throw new DrawioError('method-not-allowed', 'GET /drawio/api/webapp-status 只接受 GET/POST', 405)
}

/** Slice the route prefix off a pathname, returning `/` for the bare prefix. */
function stripPrefix(pathname: string): string {
  if (!pathname.startsWith(DRAWIO_ROUTE_PREFIX)) {
    throw new DrawioError('not-found', `dsh-drawio 只服务 ${DRAWIO_ROUTE_PREFIX} 前缀：${pathname}`, 404)
  }
  const rest = pathname.slice(DRAWIO_ROUTE_PREFIX.length)
  return rest === '' ? '/' : rest
}

// ---------------------------------------------------------------------------
// Diagram API
//
// Every one of these resolves the workspace cwd from the session id (never
// trusting the client's copy) and then fences the path against it. The fence is
// applied inside diagrams.ts on read / write / create / list / exists — there
// is no entry point that skips it.
// ---------------------------------------------------------------------------

function requirePostBody(request: IncomingMessage, route: string): Promise<Record<string, unknown>> {
  if (request.method !== 'POST') {
    throw new DrawioError('method-not-allowed', `${route} 只接受 POST 请求`, 405)
  }
  return readJsonBody(request)
}

function requireSessionId(body: Record<string, unknown>): string {
  const value = body['sessionId']
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DrawioError('bad-request', 'sessionId 必须是非空字符串')
  }
  return value.trim()
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DrawioError('bad-request', `${key} 必须是非空字符串`)
  }
  return value.trim()
}

function optionalNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DrawioError('bad-request', `${key} 必须是有限数字`)
  }
  return value
}

/** Session → authoritative cwd, with the client value as hydration fallback only. */
function cwdFor(deps: DrawioRouteDeps, body: Record<string, unknown>): string {
  return deps.resolveSessionCwd(requireSessionId(body), optionalString(body, 'cwd'))
}

async function handleRead(
  request: IncomingMessage,
  response: ServerResponse,
  deps: DrawioRouteDeps,
): Promise<void> {
  const body = await requirePostBody(request, 'POST /drawio/api/read')
  const path = optionalString(body, 'path')
  if (path === undefined) throw new DrawioError('bad-request', '缺少 path')
  writeOk(response, await readDiagram({ cwd: cwdFor(deps, body), path }))
}

async function handleWrite(
  request: IncomingMessage,
  response: ServerResponse,
  deps: DrawioRouteDeps,
): Promise<void> {
  const body = await requirePostBody(request, 'POST /drawio/api/write')
  const path = optionalString(body, 'path')
  if (path === undefined) throw new DrawioError('bad-request', '缺少 path')
  const xml = body['xml']
  if (typeof xml !== 'string') throw new DrawioError('bad-request', 'xml 必须是字符串')

  writeOk(response, await writeDiagram({
    cwd: cwdFor(deps, body),
    path,
    xml,
    ifMtimeMs: optionalNumber(body, 'ifMtimeMs'),
  }))
}

async function handleCreate(
  request: IncomingMessage,
  response: ServerResponse,
  deps: DrawioRouteDeps,
): Promise<void> {
  const body = await requirePostBody(request, 'POST /drawio/api/create')
  const options: CreateDiagramOptions = { cwd: cwdFor(deps, body) }
  const directory = optionalString(body, 'directory')
  if (directory !== undefined) options.directory = directory
  const name = optionalString(body, 'name')
  if (name !== undefined) options.name = name
  writeOk(response, await createDiagram(options))
}

async function handleList(
  request: IncomingMessage,
  response: ServerResponse,
  deps: DrawioRouteDeps,
): Promise<void> {
  const body = await requirePostBody(request, 'POST /drawio/api/list')
  const directory = optionalString(body, 'directory')
  writeOk(response, await listDiagrams({ cwd: cwdFor(deps, body), ...(directory === undefined ? {} : { directory }) }))
}

async function handleExists(
  request: IncomingMessage,
  response: ServerResponse,
  deps: DrawioRouteDeps,
): Promise<void> {
  const body = await requirePostBody(request, 'POST /drawio/api/exists')
  const path = optionalString(body, 'path')
  if (path === undefined) throw new DrawioError('bad-request', '缺少 path')
  writeOk(response, await diagramExists({ cwd: cwdFor(deps, body), path }))
}

/** Parse a request URL down to its pathname (never throws on junk input). */
function resolvePathname(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname
  } catch {
    throw new DrawioError('bad-request', `无法解析请求路径：${String(rawUrl)}`)
  }
}
