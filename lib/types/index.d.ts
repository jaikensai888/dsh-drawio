import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.js';
export { Config };
/** Host-half plugin name. Must equal the package name. */
export declare const name = "dsh-drawio";
/**
 * Hard dependencies. `webServer` serves the `/drawio` routes (and, from P1,
 * the self-hosted drawio webapp); `sessions` is what turns a session id into
 * the authoritative workspace cwd that fences every diagram read/write.
 */
export declare const inject: readonly ["webServer", "sessions"];
type WebRoute = {
    kind: 'prefix';
    path: string;
    handler: (request: IncomingMessage, response: ServerResponse) => void;
};
type WebServer = {
    register(route: WebRoute): () => void;
};
type Sessions = {
    get(sessionId: string): {
        header: {
            cwd?: string;
        };
    } | undefined;
};
/** Host context with the services declared in {@link inject}. */
export type DrawioHostContext = Context & {
    webServer: WebServer;
    sessions: Sessions;
};
/**
 * Resolve the workspace directory a session's diagrams are scoped to.
 *
 * `header.cwd` is authoritative — the session store validated it as an
 * absolute path at construction. The client's copy is a hydration fallback
 * (useful before a session is materialised) and the process cwd the last
 * resort. `ctx.sessions.list()` only returns live sessions, so nothing here
 * tries to look up historical working directories.
 */
export declare function sessionCwdOf(ctx: Sessions, sessionId: string, clientCwd?: string): string;
/**
 * Host half: register exactly one prefix route and let `routes.ts` dispatch.
 *
 * The self-hosted drawio webapp is fetched lazily — nothing touches the
 * network until a viewer asks for it, and `/drawio/ping` stays a pure
 * no-side-effect probe.
 */
export declare function apply(ctx: DrawioHostContext, config?: unknown): void;
//# sourceMappingURL=index.d.ts.map