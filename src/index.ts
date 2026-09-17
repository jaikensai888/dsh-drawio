import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { Config, resolveDrawioConfig } from './config.js'
import { requireAbsolute } from './net/fs-fence.js'
import { DrawioError } from './net/http.js'
import { createDrawioRouteHandler, DRAWIO_ROUTE_PREFIX } from './routes.js'
import { WebappInstaller, webappSourceFor } from './webapp-install.js'
import { resolveWorkspaceInfo, type WorkspaceRegistryLike, type WorkspaceScopeInfo } from './workspace.js'

export { Config }

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
 * `config` arrives from the Loader (validated against {@link Config}, with the
 * deployment's `cordis.patch.yml` row as the base layer) and is then re-derived
 * by `resolveDrawioConfig` — schemastery is non-strict, so unknown keys would
 * otherwise reach the plugin and, from there, the browser.
 */
/** The slice of `workspaceRegistry` this plugin uses (read optionally). */
type WorkspaceRegistry = WorkspaceRegistryLike

/**
 * Host half: register exactly one prefix route and let `routes.ts` dispatch.
 *
 * The self-hosted drawio webapp is fetched lazily — nothing touches the
 * network until a viewer asks for it, and `/drawio/ping` stays a pure
 * no-side-effect probe.
 */
export function apply(ctx: DrawioHostContext, config?: unknown): void {
  // Deployment values are re-derived from scratch: schemastery is non-strict,
  // so unknown yaml keys would otherwise reach us (GROUND-TRUTH pitfall #9).
  const resolved = resolveDrawioConfig(config)
  const installer = new WebappInstaller({
    source: webappSourceFor(resolved.drawioVersion, resolved.drawioSha256),
  })

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

  // `workspaceRegistry` depends on the storage domain, so it may simply not
  // exist — read it optionally and let workspace.ts fall back to realpath(cwd).
  const registry = (): WorkspaceRegistry | undefined => {
    try {
      return ctx.get('workspaceRegistry', false) as WorkspaceRegistry | undefined
    } catch {
      return undefined
    }
  }

  const resolveWorkspace = async (sessionId: string, clientCwd?: string): Promise<WorkspaceScopeInfo> => {
    let cwd: string
    try {
      cwd = sessionCwdOf(ctx.sessions, sessionId, clientCwd)
    } catch (error) {
      if (error instanceof DrawioError) throw error
      throw new DrawioError('bad-request', `无法确定会话工作区：${(error as Error).message}`)
    }
    return resolveWorkspaceInfo({ sessionId, cwd, registry: registry() })
  }

  const handler = createDrawioRouteHandler({ installer, config: resolved, trustedHosts, resolveWorkspace })

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: DRAWIO_ROUTE_PREFIX,
      handler,
    })
    console.log(`[dsh-drawio] prefix route registered: ${DRAWIO_ROUTE_PREFIX} (webapp root ${installer.webappRoot}, diagrams ${resolved.diagramsDir})`)

    return () => {
      console.log(`[dsh-drawio] prefix route disposed: ${DRAWIO_ROUTE_PREFIX}`)
      disposeRoute()
    }
  })
}
