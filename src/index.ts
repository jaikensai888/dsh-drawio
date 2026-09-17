import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { createDrawioRouteHandler, DRAWIO_ROUTE_PREFIX } from './routes.js'

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

/** Host context with the services declared in {@link inject}. */
export type DrawioHostContext = Context & {
  webServer: WebServer
}

/**
 * Host half: register exactly one prefix route and let `routes.ts` dispatch.
 *
 * There is intentionally no `Config` yet — P1/P3 add one together with the
 * `resolveDrawioConfig()` second-line-of-defence resolver (schemastery is
 * non-strict, so unknown yaml keys leak into the resolved config).
 */
export function apply(ctx: DrawioHostContext): void {
  const handler = createDrawioRouteHandler()

  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: DRAWIO_ROUTE_PREFIX,
      handler,
    })
    console.log(`[dsh-drawio] prefix route registered: ${DRAWIO_ROUTE_PREFIX}`)

    return () => {
      console.log(`[dsh-drawio] prefix route disposed: ${DRAWIO_ROUTE_PREFIX}`)
      disposeRoute()
    }
  })
}
