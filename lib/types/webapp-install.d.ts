/**
 * Pinned drawio release. The tag AND the archive digest are frozen in code on
 * purpose — never resolve `latest` at runtime, or a compromised/rewritten
 * upstream release would silently become our editor.
 *
 * Verified 2026-09-17 against
 * https://github.com/jgraph/drawio/releases/tag/v31.4.6
 */
export declare const DRAWIO_RELEASE_TAG = "v31.4.6";
export declare const DRAWIO_WAR_URL = "https://github.com/jgraph/drawio/releases/download/v31.4.6/draw.war";
export declare const DRAWIO_WAR_SHA256 = "f7798104da17d7e9494ab348c3ba9b2a65640096bd54f704d7a0fa2fab283938";
export declare const DRAWIO_WAR_BYTES = 53762297;
/** `<dshHome>/storages/dsh-drawio` — the harness home, not the workspace. */
export declare function resolveDshHome(env?: NodeJS.ProcessEnv): string;
export type WebappPhase = 'missing' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error';
/** Progress snapshot handed to the viewer while the editor is not usable yet. */
export interface WebappStatus {
    phase: WebappPhase;
    ready: boolean;
    version: string;
    /** Bytes received so far (only meaningful while `phase === 'downloading'`). */
    received: number;
    /** Expected archive size in bytes. */
    total: number;
    webappRoot: string;
    /** Human-readable (Chinese) explanation for `error`, or a short hint otherwise. */
    message?: string;
    installedAt?: string;
}
/** Which archive to install, and what it must hash to. */
export interface WebappSource {
    version: string;
    sha256: string;
    url: string;
    /** Expected archive size, used as the progress denominator before headers arrive. */
    expectedBytes: number;
}
/** Build the archive descriptor for a pinned release tag. */
export declare function webappSourceFor(version: string, sha256: string, expectedBytes?: number): WebappSource;
export declare const DEFAULT_WEBAPP_SOURCE: WebappSource;
/**
 * Downloads and unpacks the drawio webapp into `<dshHome>/storages/dsh-drawio/webapp`.
 *
 * Only one install runs at a time; every caller observes the same progress
 * snapshot, so N open viewers do not start N downloads. The unpacked tree is
 * built in a `.extract-<nonce>` sibling and swapped in with a rename, so an
 * interrupted install never leaves a half-populated webapp behind.
 */
export declare class WebappInstaller {
    #private;
    readonly root: string;
    readonly webappRoot: string;
    constructor(options?: {
        root?: string;
        source?: WebappSource;
    });
    /** Current progress; probes the marker file once per process. */
    status(): Promise<WebappStatus>;
    /**
     * Start (or join) an install when the editor is not ready yet. Returns
     * immediately with the current snapshot — callers poll {@link status}.
     */
    ensure(): Promise<WebappStatus>;
}
/**
 * Unpack the editor out of `draw.war`.
 *
 * The archive layout is discovered rather than assumed: `.war` files in the
 * wild put the webapp either at the zip root (what jgraph ships today) or under
 * a `webapp/` directory, so the resource root is derived from the shallowest
 * `index.html` entry and every entry is rebased onto it.
 */
export declare function extractWebapp(warPath: string, targetDir: string): Promise<{
    files: number;
    bytes: number;
    rootPrefix: string;
}>;
//# sourceMappingURL=webapp-install.d.ts.map