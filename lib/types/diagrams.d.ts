/** Sub-directory new diagrams land in, relative to the workspace. */
export declare const DEFAULT_DIAGRAMS_DIR = "docs/diagrams";
/** Extensions this plugin claims (lowercase, no dot). */
export declare const DIAGRAM_EXTENSIONS: readonly string[];
/** What a brand-new diagram contains. */
export declare const BLANK_MXFILE: string;
export interface DiagramReadResult {
    path: string;
    relativePath: string;
    /** Uncompressed mxfile XML, ready for the editor's `load` action. */
    xml: string;
    /** Storage style of the bytes on disk; echoed back on write. */
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
/** The slice of deployment configuration every entry point needs. */
export interface WorkspaceOptions {
    /** Authoritative workspace root from the session header. */
    cwd: string;
    /** Directory for new diagrams, relative to `cwd`. Defaults to `docs/diagrams`. */
    diagramsDir?: string | undefined;
    /** Deployment opt-in that drops the containment requirement. Off by default. */
    allowOutsideWorkspace?: boolean | undefined;
}
/** Read a `.drawio` inside the workspace, decoding compressed storage. */
export declare function readDiagram(options: WorkspaceOptions & {
    path: string;
}): Promise<DiagramReadResult>;
export interface WriteDiagramOptions extends WorkspaceOptions {
    path: string;
    /** Plain mxfile XML from the editor. */
    xml: string;
    /** mtime the editor last saw. Omit to overwrite unconditionally. */
    ifMtimeMs?: number | undefined;
}
/**
 * Write a diagram atomically, refusing to clobber an external edit.
 *
 * The mtime check is the whole point: drawio autosaves on a debounce, so
 * without it a stale editor buffer would silently destroy a change made by
 * another tool. A mismatch is a 409 the viewer resolves interactively.
 *
 * The storage style is re-derived from the bytes currently on disk rather than
 * carried by the client: the client cannot get it stale, and a file another
 * tool re-compressed is followed rather than fought.
 */
export declare function writeDiagram(options: WriteDiagramOptions): Promise<DiagramWriteResult>;
export interface CreateDiagramOptions extends WorkspaceOptions {
    /** Directory relative to the workspace; defaults to the configured diagrams directory. */
    directory?: string | undefined;
    /** Base file name without extension; defaults to `untitled`. */
    name?: string | undefined;
    /**
     * Create exactly at this path (absolute or workspace-relative) instead of
     * picking the next free `untitled-N`. Backs the "this file does not exist —
     * create it?" prompt, where the user already chose the name by typing it.
     */
    path?: string | undefined;
}
/**
 * Create a blank diagram — either at a caller-chosen path, or as the next free
 * `<name>-N.drawio` in the workspace diagrams directory.
 */
export declare function createDiagram(options: CreateDiagramOptions): Promise<DiagramReadResult>;
/** List the diagrams in the workspace diagrams directory, name-sorted. */
export declare function listDiagrams(options: WorkspaceOptions & {
    directory?: string | undefined;
}): Promise<DiagramEntry[]>;
/** Whether a path exists inside the workspace (used by the "create it?" prompt). */
export declare function diagramExists(options: WorkspaceOptions & {
    path: string;
}): Promise<DiagramExistsResult>;
//# sourceMappingURL=diagrams.d.ts.map