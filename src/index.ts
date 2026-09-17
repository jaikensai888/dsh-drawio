import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { requireAbsolute } from './net/fs-fence.js'
import { DrawioError } from './net/http.js'
import { createDrawioRouteHandler, DRAWIO_ROUTE_PREFIX } from './routes.js'
import { WebappInstaller } from './webapp-install.js'

/** Host-half plugin name. Must equal the package name. */
export const name = 'dsh-drawio'

/**
 * Hard dependencies. `webServer` serves the `/drawio` routes (and, from P1,
 * the self-hosted drawio webapp); `sessions` is what turns a session id into
 * the authoritative workspace cwd that fences every diagram read/write.
 */
export const inject = ['webServer', 'sessions'] as const

type WebRoute = {
  kind: 'prefix'
  path: string
  handler: (request: IncomingMessage, response: ServerResponse) => void
}

type WebServer = {
  register(route: WebRoute): () => void
}

type Sessions = {
  get(sessionId: string): { header: { cwd?: string } } | undefined
}

/** Host context with the services declared in {@link inject}. */
export type DrawioHostContext = Context & {
  webServer: WebServer
  sessions: Sessions
}

/** The slice of `webRuntime` the trust fence needs (read optionally). */
type WebRuntime = {
  trustedHosts?: readonly string[]
}

/**
 * Resolve the workspace directory a session's diagrams are scoped to.
 *
 * `header.cwd` is authoritative — the session store validated it as an
 * absolute path at construction. The client's copy is a hydration fallback
 * (useful before a session is materialised) and the process cwd the last
 * resort. `ctx.sessions.list()` only returns live sessions, so nothing here
 * tries to look up historical working directories.
 */
export function sessionCwdOf(ctx: Sessions, sessionId: string, clientCwd?: string): string {
  const headerCwd = ctx.get(sessionId)?.header.cwd
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  if (clientCwd !== undefined && clientCwd !== '') return requireAbsolute(clientCwd, 'cwd')
  return process.cwd()
}

/**
 * Host half: register exactly one prefix route and let `routes.ts` dispatch.
 *
 * The self-hosted drawio webapp is fetched lazily — nothing touches the
 * network until a viewer asks for it, and `/drawio/ping` stays a pure
 * no-side-effect probe.
 *
 * There is intentionally no `Config` yet — P3 adds one together with the
 * `resolveDrawioConfig()` second-line-of-defence resolver (schemastery is
 * non-strict, so unknown yaml keys leak into the resolved config).
 */
export function apply(ctx: DrawioHostContext): void {
  const installer = new WebappInstaller()

  // `webRuntime` is read through ctx.get rather than injected: it is only a
  // trust-fence input, and a missing service must degrade to "loopback only"
  // instead of blocking the plugin from mounting. The value is read live on
  // every request because the runtime activates after this plugin does.
  const trustedHosts = (): readonly string[] => {
    try {
      const runtime = ctx.get('webRuntime', false) as WebRuntime | undefined
      const value = runtime?.trustedHosts
      return Array.isArray(value) ? value : []
    } catch {
      return []
    }
  }

  const resolveSessionCwd = (sessionId: string, clientCwd?: string): string => {
    try {
      return sessionCwdOf(ctx.sessions, sessionId, clientCwd)
    } catch (error) {
      if (error instanceof DrawioError) throw error
      throw new DrawioError('bad-request', `无法确定会话工作区：${(error as Error).message}`)
    }
  }

  const handler = createDrawioRouteHandler({ installer, trustedHosts, resolveSessionCwd })

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: DRAWIO_ROUTE_PREFIX,
      handler,
    })
    console.log(`[dsh-drawio] prefix route registered: ${DRAWIO_ROUTE_PREFIX} (webapp root ${installer.webappRoot})`)

    return () => {
      console.log(`[dsh-drawio] prefix route disposed: ${DRAWIO_ROUTE_PREFIX}`)
      disposeRoute()
    }
  })
}
