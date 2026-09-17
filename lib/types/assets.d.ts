import type { Stats } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
/** URL prefix that maps onto the extracted webapp root. */
export declare const WEBAPP_MOUNT = "/drawio/webapp";
/**
 * The one network-level boundary this plugin owns.
 *
 * `connect-src 'self'` is the real gate: no matter what the editor tries to
 * reach, it cannot open a connection to another origin. `'unsafe-inline'` is
 * required by drawio's inline styles/scripts. `frame-src 'self'` (rather than
 * PLAN's `'none'`) still blocks every external frame while leaving drawio's own
 * same-origin sub-frames working.
 */
export declare const DRAWIO_CSP: string;
export interface AssetHandlerOptions {
    /** Absolute webapp root, or undefined while the editor is not installed yet. */
    resolveRoot: () => Promise<string | undefined>;
    /** URL prefix mapped to that root; defaults to {@link WEBAPP_MOUNT}. */
    mountPath?: string;
}
type AssetHandler = (request: IncomingMessage, response: ServerResponse, pathname: string) => Promise<void>;
interface ByteRange {
    start: number;
    end: number;
}
/** Strict `bytes=` single-range parser; undefined means "send the whole file". */
export declare function parseRange(header: string | undefined, size: number): ByteRange | undefined | 'unsatisfiable';
/** Quote an fs stat as a weak-free entity tag (never hashes file content). */
export declare function etagFor(info: Pick<Stats, 'mtimeMs' | 'size'>): string;
/**
 * Turn a request pathname into a decoded, relative, slash-free-of-traversal
 * path below the mount point.
 */
export declare function relativeAssetPath(pathname: string, mount?: string): string;
/**
 * Containment check for the webapp root.
 *
 * ★ The separator MUST come from `path.sep`, not a hard-coded `/`: on Windows
 * `resolve()` yields backslashes, so comparing against `${root}/` rejects every
 * legitimate sub-path.
 */
export declare function resolveWithinRoot(root: string, relative: string): string;
/** Stream `<webappRoot>/**` with ETag/304, Range and a document CSP. */
export declare function createWebappAssetHandler(options: AssetHandlerOptions): AssetHandler;
export {};
//# sourceMappingURL=assets.d.ts.map