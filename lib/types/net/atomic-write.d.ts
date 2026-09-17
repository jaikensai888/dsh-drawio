/**
 * Atomic file replacement, mirroring `@deepseek-ai/dsh-atomic-write`'s
 * `writeFileAtomic`.
 *
 * Why this is vendored instead of imported: the version DSH Desktop ships
 * (`0.1.2-alpha.1`) is **not published** on npm — the registry has alpha.2+
 * only — so pinning it would make a clean install impossible, and tracking a
 * moving alpha would make the plugin's behaviour depend on DSH's release
 * cadence. Same reasoning as the trust fence: a third-party plugin copies the
 * ~40 lines it needs rather than reaching into DSH internals.
 *
 * The contract that matters is unchanged from the original:
 * - the content is written to a random-suffix sibling opened with exclusive
 *   create (`wx`), which refuses to follow a symlink planted at the temp path;
 * - the fresh inode carries `options.mode` through the rename, so replacing a
 *   wider-permission file narrows it without a chmod race;
 * - `rename` replaces a symlinked *target* itself instead of writing through
 *   to its referent;
 * - the sibling lives in the same directory, keeping the rename on one
 *   filesystem;
 * - any failure removes the temp file and rethrows.
 *
 * Crash durability (fsync) is deliberately out of scope, exactly as upstream.
 */
export interface AtomicWriteOptions {
    /** Permission bits for the replacement inode. Required: permissions stay visible at every call site. */
    mode: number;
    /** Optional permission bits for directories created on the way. */
    dirMode?: number;
}
/** Replace `filename` with `content` in one atomic step, creating parent directories. */
export declare function writeFileAtomic(filename: string, content: string, options: AtomicWriteOptions): Promise<void>;
//# sourceMappingURL=atomic-write.d.ts.map