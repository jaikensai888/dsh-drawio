import { isAbsolute, normalize } from 'node:path'
import z from 'schemastery'
import { DRAWIO_RELEASE_TAG, DRAWIO_WAR_SHA256 } from './webapp-install.js'

/**
 * Deployment configuration, validated by the Loader and passed to `apply` as
 * its second argument.
 *
 * Note there is a SECOND line of defence: schemastery is non-strict, so unknown
 * keys from `cordis.patch.yml` are merged into the resolved object and would
 * otherwise reach the plugin (GROUND-TRUTH pitfall #9). {@link resolveDrawioConfig}
 * re-derives every field from scratch, which is also what makes it usable as
 * the settings `base` layer in P3's user-settings surface.
 */

/** drawio's `ui` parameter. `kennedy` is the full editor; `min` strips panels. */
export const DRAWIO_UI_THEMES = ['kennedy', 'min', 'atlas', 'dark', 'sketch', 'simple'] as const

export type DrawioUiTheme = typeof DRAWIO_UI_THEMES[number]

/** Where new diagrams are created when the workspace does not override it. */
export const DEFAULT_DIAGRAMS_DIR = 'docs/diagrams'

export interface DrawioConfig {
  /** Pinned drawio release tag. */
  drawioVersion: string
  /** sha256 of that release's `draw.war`. */
  drawioSha256: string
  /** Escape hatch: a non-empty URL bypasses the self-hosted editor entirely. */
  editorUrl: string
  /** Directory for new diagrams, relative to the workspace. */
  diagramsDir: string
  /** Passed to drawio as its debounce before it posts `autosave`. */
  autosaveDelayMs: number
  /** Our own idle delay before a pending payload reaches disk. */
  writeDebounceMs: number
  /** drawio `ui` parameter. */
  uiTheme: DrawioUiTheme
  /** drawio UI language. */
  language: string
  /** Allow read/write outside the session workspace. Off by default. */
  allowOutsideWorkspace: boolean
}

export const DEFAULT_DRAWIO_CONFIG: DrawioConfig = {
  drawioVersion: DRAWIO_RELEASE_TAG,
  drawioSha256: DRAWIO_WAR_SHA256,
  editorUrl: '',
  diagramsDir: DEFAULT_DIAGRAMS_DIR,
  autosaveDelayMs: 1500,
  writeDebounceMs: 1500,
  uiTheme: 'kennedy',
  language: 'zh',
  allowOutsideWorkspace: false,
}

/** The schema the Loader validates a `cordis.patch.yml` config against. */
export const Config = z.object({
  drawioVersion: z.string().default(DEFAULT_DRAWIO_CONFIG.drawioVersion),
  drawioSha256: z.string().default(DEFAULT_DRAWIO_CONFIG.drawioSha256),
  editorUrl: z.string().default(DEFAULT_DRAWIO_CONFIG.editorUrl),
  diagramsDir: z.string().default(DEFAULT_DRAWIO_CONFIG.diagramsDir),
  autosaveDelayMs: z.number().min(200).max(10_000).default(DEFAULT_DRAWIO_CONFIG.autosaveDelayMs),
  writeDebounceMs: z.number().min(0).max(10_000).default(DEFAULT_DRAWIO_CONFIG.writeDebounceMs),
  uiTheme: z.string().default(DEFAULT_DRAWIO_CONFIG.uiTheme),
  language: z.string().default(DEFAULT_DRAWIO_CONFIG.language),
  allowOutsideWorkspace: z.boolean().default(DEFAULT_DRAWIO_CONFIG.allowOutsideWorkspace),
})

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Keep `diagramsDir` a plain relative path inside the workspace.
 *
 * This is a deployment knob that ends up in `join(cwd, …)`, so `../` or an
 * absolute path would let a config value redirect every new diagram out of the
 * workspace. Junk falls back to the default rather than failing the boot.
 */
export function normalizeDiagramsDir(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_DIAGRAMS_DIR
  const trimmed = value.trim().replace(/^[.][\\/]/u, '')
  if (trimmed === '' || isAbsolute(trimmed) || /^[A-Za-z]:/u.test(trimmed)) return DEFAULT_DIAGRAMS_DIR
  const normalized = normalize(trimmed).replace(/\\/gu, '/')
  const segments = normalized.split('/')
  if (segments.some(segment => segment === '..' || segment === '')) return DEFAULT_DIAGRAMS_DIR
  return segments.join('/')
}

/**
 * Re-derive a complete, safe config from anything the composition layer handed
 * us. Never throws: a bad deployment value degrades to its default so a typo in
 * yaml cannot take the plugin tree down.
 */
export function resolveDrawioConfig(value?: unknown): DrawioConfig {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const theme = asString(record['uiTheme'], DEFAULT_DRAWIO_CONFIG.uiTheme)
  const language = asString(record['language'], DEFAULT_DRAWIO_CONFIG.language)

  return {
    drawioVersion: asString(record['drawioVersion'], DEFAULT_DRAWIO_CONFIG.drawioVersion),
    drawioSha256: asString(record['drawioSha256'], DEFAULT_DRAWIO_CONFIG.drawioSha256),
    editorUrl: typeof record['editorUrl'] === 'string' ? record['editorUrl'].trim() : '',
    diagramsDir: normalizeDiagramsDir(record['diagramsDir']),
    autosaveDelayMs: asNumber(record['autosaveDelayMs'], DEFAULT_DRAWIO_CONFIG.autosaveDelayMs, 200, 10_000),
    // 0 is meaningful: it means "write as soon as drawio posts autosave".
    writeDebounceMs: asNumber(record['writeDebounceMs'], DEFAULT_DRAWIO_CONFIG.writeDebounceMs, 0, 10_000),
    uiTheme: (DRAWIO_UI_THEMES as readonly string[]).includes(theme) ? theme as DrawioUiTheme : DEFAULT_DRAWIO_CONFIG.uiTheme,
    language: /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(language) ? language : DEFAULT_DRAWIO_CONFIG.language,
    allowOutsideWorkspace: asBoolean(record['allowOutsideWorkspace'], DEFAULT_DRAWIO_CONFIG.allowOutsideWorkspace),
  }
}

/** The subset of config the browser needs; the host stays authoritative for the rest. */
export interface DrawioClientConfig {
  editorUrl: string
  diagramsDir: string
  autosaveDelayMs: number
  writeDebounceMs: number
  uiTheme: DrawioUiTheme
  language: string
  allowOutsideWorkspace: boolean
  webappVersion: string
}

export function clientConfigOf(config: DrawioConfig): DrawioClientConfig {
  return {
    editorUrl: config.editorUrl,
    diagramsDir: config.diagramsDir,
    autosaveDelayMs: config.autosaveDelayMs,
    writeDebounceMs: config.writeDebounceMs,
    uiTheme: config.uiTheme,
    language: config.language,
    allowOutsideWorkspace: config.allowOutsideWorkspace,
    webappVersion: config.drawioVersion,
  }
}
