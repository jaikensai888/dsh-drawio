/**
 * Client-side access to the plugin's own host routes.
 *
 * Every `/drawio/api/*` response uses the `{ ok, value | error }` envelope, so
 * the unwrapping lives here once instead of at each call site.
 */
export type WebappPhase = 'missing' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error';
export interface WebappStatus {
    phase: WebappPhase;
    ready: boolean;
    version: string;
    received: number;
    total: number;
    webappRoot: string;
    message?: string;
    installedAt?: string;
}
/** Readiness + download progress of the self-hosted editor. */
export declare function fetchWebappStatus(): Promise<WebappStatus>;
/** Start (or join) the one-time editor download and report progress. */
export declare function startWebappInstall(): Promise<WebappStatus>;
//# sourceMappingURL=api.d.ts.map