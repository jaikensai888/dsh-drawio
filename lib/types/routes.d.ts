import type { IncomingMessage, ServerResponse } from 'node:http';
import { type DrawioConfig } from './config.js';
import type { WebappInstaller } from './webapp-install.js';
import type { WorkspaceScopeInfo } from './workspace.js';
/**
 * The one and only `webServer.register` call this plugin ever makes.
 *
 * `webServer.register` throws on a duplicate `(kind, path)` pair and that
 * failure takes the whole plugin tree down, so every `/drawio/**` endpoint
 * lives behind this single prefix route and is dispatched internally by
 * sub-path. Do not add a second registration anywhere in this package.
 */
export declare const DRAWIO_ROUTE_PREFIX = "/drawio";
export interface DrawioRouteDeps {
    installer: WebappInstaller;
    /** Validated deployment configuration. */
    config: DrawioConfig;
    /** Live non-loopback authorities this deployment serves (from `webRuntime`). */
    trustedHosts: () => readonly string[];
    /**
     * Workspace identity for a session. `header.cwd` wins; the client's cwd is
     * only a hydration fallback, and `process.cwd()` the last resort. Re-resolved
     * on every request because sessions are live and cwd is not cached across
     * requests.
     */
    resolveWorkspace: (sessionId: string, clientCwd?: string) => Promise<WorkspaceScopeInfo>;
}
/** Build the dispatch table for the single `/drawio` prefix route. */
export declare function createDrawioRouteHandler(deps: DrawioRouteDeps): (request: IncomingMessage, response: ServerResponse) => void;
//# sourceMappingURL=routes.d.ts.map