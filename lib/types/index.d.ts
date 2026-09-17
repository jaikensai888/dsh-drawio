import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
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
/** Host context with the services declared in {@link inject}. */
export type DrawioHostContext = Context & {
    webServer: WebServer;
};
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
export declare function apply(ctx: DrawioHostContext): void;
export {};
//# sourceMappingURL=index.d.ts.map