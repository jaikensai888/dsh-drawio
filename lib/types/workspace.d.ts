/**
 * Workspace identity for one session.
 *
 * DSH's "workspace" is a persisted registry of *named directories*, not a
 * permission boundary: membership is exact equality between a session's cwd and
 * a registered `workspace.path`, and sub-directories are not members
 * (GROUND-TRUTH §5.2). The scope key therefore falls back to the canonical cwd
 * whenever the registry is absent or the directory was never registered — which
 * is the common case.
 */
/** The slice of `ctx.workspaceRegistry` this plugin uses. */
export interface WorkspaceRegistryLike {
    resolveByPath(path: string): Promise<{
        id: string;
        path: string;
        title?: string;
    } | undefined>;
}
export interface WorkspaceScopeInfo {
    sessionId: string;
    /** Authoritative working directory from the session header. */
    cwd: string;
    /** Canonical identity used to scope diagrams: `workspace.path ?? realpath(cwd)`. */
    scopeKey: string;
    workspaceId?: string;
    workspaceTitle?: string;
    /** Whether `cwd` is a *registered* workspace, as opposed to a bare directory. */
    registered: boolean;
}
/**
 * Canonicalize a directory path.
 *
 * `realpath` collapses junctions, symlinks and 8.3 short names and normalizes
 * case on Windows, so two spellings of one directory produce one scope key. A
 * missing directory throws in `realpath` — we fall back to the resolved path
 * rather than failing, because "the workspace directory is gone" is a state the
 * caller can still report usefully.
 */
export declare function canonicalizePath(path: string): Promise<string>;
/** Resolve the workspace identity for a session, tolerating a missing registry. */
export declare function resolveWorkspaceInfo(options: {
    sessionId: string;
    cwd: string;
    registry?: WorkspaceRegistryLike | undefined;
}): Promise<WorkspaceScopeInfo>;
//# sourceMappingURL=workspace.d.ts.map