/**
 * Browser-trust fence for the `/drawio` routes, behaviorally identical to the
 * /api gateway's fence in `@deepseek-ai/dsh-client-connection`
 * (`src/api-request-trust.ts` + `src/loopback-hostname.ts`, BSD-3-Clause) and
 * to the copy dsh-better-sidebar carries for the same reason: the package does
 * not export these helpers and a plugin must not depend on its internals.
 *
 * Host-header loopback or a configured trusted authority passes; cross-site
 * browser markers refuse. This is a DNS-rebinding / cross-site defense, NOT
 * authentication — our routes are reachable without the browser-session cookie,
 * which is exactly why every `/drawio` route must run through this.
 */
import type { IncomingHttpHeaders } from 'node:http';
/** The request facts the fence reads (structural subset of IncomingMessage). */
interface ApiTrustRequest {
    headers: IncomingHttpHeaders;
}
/** Whether a normalized URL hostname names the local loopback authority. */
export declare function isLoopbackHostname(hostname: string): boolean;
/**
 * Decide whether one `/drawio` request may reach the plugin routes.
 * @param request - node HTTP request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves.
 * @returns true when the Host is ours (loopback or trusted) and browser markers are same-origin.
 */
export declare function isTrustedApiRequest(request: ApiTrustRequest, trustedHosts: readonly string[]): boolean;
export {};
//# sourceMappingURL=trust-fence.d.ts.map