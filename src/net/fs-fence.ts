import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { DrawioError } from './http.js'

/**
 * Filesystem containment for the workspace fence.
 *
 * There is no framework guarantee here — the session cwd is the *scope* a
 * `.drawio` may be read from or written to, and every entry point has to
 * enforce it. The recipe follows GROUND-TRUTH §5.3, which dsh-better-sidebar
 * uses for its own media routes.
 *
 * Known limitation (shared with better-sidebar's routes): containment is a
 * string comparison on `resolve()`d paths, so a **symlink inside the workspace
 * pointing outside it** still resolves inside. Closing that would require a
 * realpath check that breaks legitimate junctioned workspaces, so it is left
 * to the platform sandbox.
 */

/** Normalize separators and drop a trailing slash so prefix tests are exact. */
function normalizeForCompare(value: string): string {
  return value.replace(/[\\/]+/gu, '/').replace(/\/$/u, '')
}

/**
 * Whether `target` is `base` itself or lives underneath it.
 *
 * Case-insensitive on Windows; tolerates mixed separators so a forward-slash
 * request path still matches a backslash `resolve()` result.
 */
export function isWithin(base: string, target: string, platform: string = process.platform): boolean {
  const b = normalizeForCompare(base)
  const t = normalizeForCompare(target)
  if (platform === 'win32') {
    const lb = b.toLowerCase()
    const lt = t.toLowerCase()
    return lt === lb || lt.startsWith(`${lb}/`)
  }
  return t === b || t.startsWith(`${b}/`)
}

/**
 * Validate a caller-supplied path is absolute and normalize it.
 *
 * `path.isAbsolute` already rejects drive-relative forms like `C:foo`, which
 * `resolve()` would otherwise silently anchor to the process cwd.
 */
export function requireAbsolute(value: unknown, label = 'path'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DrawioError('bad-request', `${label} 必须是非空字符串`)
  }
  const trimmed = value.trim()
  if (!isAbsolute(trimmed)) {
    throw new DrawioError('bad-request', `${label} 必须是绝对路径：${trimmed}`)
  }
  return resolve(trimmed)
}

/** Per-call containment policy. */
export interface FenceOptions {
  /**
   * Deployment opt-in (`allowOutsideWorkspace`) that drops the containment
   * requirement entirely. Off by default; when on, `cwd` is still the base a
   * relative request resolves against — it just stops being a boundary.
   */
  allowOutside?: boolean
}

/**
 * Resolve a caller path under `base`, refusing anything that escapes it.
 *
 * ★ The containment test MUST use `path.sep` (via {@link isWithin}), not a
 * hard-coded `/`: on Windows `resolve()` yields backslashes, so comparing
 * against `${base}/` would reject every legitimate sub-path.
 */
export function resolveWithinBase(
  base: string,
  candidate: string,
  label = 'path',
  options: FenceOptions = {},
): string {
  const normalizedBase = resolve(base)
  const target = resolve(normalize(candidate))
  if (options.allowOutside !== true && !isWithin(normalizedBase, target)) {
    throw new DrawioError('forbidden', `${label} 越出当前工作区：${candidate}`, 403)
  }
  return target
}

/**
 * Resolve a request path (absolute, or relative to the workspace) under `base`.
 * Both forms are accepted because better-sidebar hands the editor a path it
 * built from its own tree, and the host must not assume which one it chose.
 */
export function resolveRequestPath(
  base: string,
  raw: unknown,
  label = 'path',
  options: FenceOptions = {},
): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new DrawioError('bad-request', `${label} 必须是非空字符串`)
  }
  const value = raw.trim()
  const normalizedBase = resolve(base)
  const candidate = isAbsolute(value) ? resolve(value) : resolve(normalizedBase, value)
  if (options.allowOutside !== true && !isWithin(normalizedBase, candidate)) {
    throw new DrawioError('forbidden', `${label} 越出当前工作区：${value}`, 403)
  }
  return candidate
}

/** Path relative to the workspace root, for display; falls back to the absolute path. */
export function relativeToBase(base: string, target: string): string {
  const b = normalizeForCompare(resolve(base))
  const t = normalizeForCompare(resolve(target))
  const prefix = process.platform === 'win32' ? b.toLowerCase() : b
  const probe = process.platform === 'win32' ? t.toLowerCase() : t
  if (probe === prefix) return ''
  if (!probe.startsWith(`${prefix}/`)) return target
  return t.slice(b.length + 1)
}

/** Exported for tests: the separator the containment check is built on. */
export const COMPARE_SEPARATOR = sep
