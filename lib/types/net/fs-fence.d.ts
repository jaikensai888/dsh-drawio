/**
 * Whether `target` is `base` itself or lives underneath it.
 *
 * Case-insensitive on Windows; tolerates mixed separators so a forward-slash
 * request path still matches a backslash `resolve()` result.
 */
export declare function isWithin(base: string, target: string, platform?: string): boolean;
/**
 * Validate a caller-supplied path is absolute and normalize it.
 *
 * `path.isAbsolute` already rejects drive-relative forms like `C:foo`, which
 * `resolve()` would otherwise silently anchor to the process cwd.
 */
export declare function requireAbsolute(value: unknown, label?: string): string;
/** Per-call containment policy. */
export interface FenceOptions {
    /**
     * Deployment opt-in (`allowOutsideWorkspace`) that drops the containment
     * requirement entirely. Off by default; when on, `cwd` is still the base a
     * relative request resolves against — it just stops being a boundary.
     */
    allowOutside?: boolean;
}
/**
 * Resolve a caller path under `base`, refusing anything that escapes it.
 *
 * ★ The containment test MUST use `path.sep` (via {@link isWithin}), not a
 * hard-coded `/`: on Windows `resolve()` yields backslashes, so comparing
 * against `${base}/` would reject every legitimate sub-path.
 */
export declare function resolveWithinBase(base: string, candidate: string, label?: string, options?: FenceOptions): string;
/**
 * Resolve a request path (absolute, or relative to the workspace) under `base`.
 * Both forms are accepted because better-sidebar hands the editor a path it
 * built from its own tree, and the host must not assume which one it chose.
 */
export declare function resolveRequestPath(base: string, raw: unknown, label?: string, options?: FenceOptions): string;
/** Path relative to the workspace root, for display; falls back to the absolute path. */
export declare function relativeToBase(base: string, target: string): string;
/** Exported for tests: the separator the containment check is built on. */
export declare const COMPARE_SEPARATOR: "/" | "\\";
//# sourceMappingURL=fs-fence.d.ts.map