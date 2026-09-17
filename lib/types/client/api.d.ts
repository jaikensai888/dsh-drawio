import type { SessionScope } from 'dsh-better-sidebar/client/service';
/**
 * Client-side access to the plugin's own host routes.
 *
 * Every `/drawio/api/*` response uses the `{ ok, value | error }` envelope, so
 * the unwrapping lives here once instead of at each call site. Failures carry
 * the HTTP status, the host error code and any `details` the UI needs — a 409
 * arrives with the current on-disk mtime so the conflict bar can act without
 * another round trip.
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
export interface DiagramReadResult {
    path: string;
    relativePath: string;
    xml: string;
    compressed: boolean;
    mtimeMs: number;
    size: number;
}
export interface DiagramWriteResult {
    path: string;
    relativePath: string;
    mtimeMs: number;
    size: number;
    compressed: boolean;
}
export interface DiagramEntry {
    name: string;
    path: string;
    relativePath: string;
    mtimeMs: number;
    size: number;
}
export interface DiagramExistsResult {
    exists: boolean;
    isFile: boolean;
    mtimeMs?: number;
    size?: number;
}
/** A host-reported failure, with enough structure for the UI to branch on. */
export declare class DrawioApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly details: Record<string, unknown> | undefined;
    constructor(message: string, status: number, code: string, details?: Record<string, unknown>);
    /** True for the "file changed under us" answer the viewer resolves interactively. */
    get isConflict(): boolean;
}
/** Readiness + download progress of the self-hosted editor. */
export declare function fetchWebappStatus(signal?: AbortSignal): Promise<WebappStatus>;
/** Start (or join) the one-time editor download and report progress. */
export declare function startWebappInstall(signal?: AbortSignal): Promise<WebappStatus>;
/** Read a diagram (decoded) plus the mtime the editor will save against. */
export declare function readDiagram(scope: SessionScope, path: string, signal?: AbortSignal): Promise<DiagramReadResult>;
/**
 * Write a diagram. `ifMtimeMs` makes the write conditional: the host answers
 * 409 instead of clobbering a file that changed since that timestamp. Omit it
 * to overwrite deliberately.
 */
export declare function writeDiagram(scope: SessionScope, path: string, xml: string, ifMtimeMs?: number, signal?: AbortSignal): Promise<DiagramWriteResult>;
/** Create the next free `<name>-N.drawio` in the workspace diagrams directory. */
export declare function createDiagram(scope: SessionScope, options?: {
    directory?: string;
    name?: string;
}): Promise<DiagramReadResult>;
/** List the diagrams in the workspace diagrams directory. */
export declare function listDiagrams(scope: SessionScope, directory?: string): Promise<DiagramEntry[]>;
/** Whether a path exists inside the workspace. */
export declare function diagramExists(scope: SessionScope, path: string): Promise<DiagramExistsResult>;
//# sourceMappingURL=api.d.ts.map