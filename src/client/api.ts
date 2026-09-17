import type { SessionScope } from 'dsh-better-sidebar/client/service'

/**
 * Client-side access to the plugin's own host routes.
 *
 * Every `/drawio/api/*` response uses the `{ ok, value | error }` envelope, so
 * the unwrapping lives here once instead of at each call site. Failures carry
 * the HTTP status, the host error code and any `details` the UI needs — a 409
 * arrives with the current on-disk mtime so the conflict bar can act without
 * another round trip.
 */

export type WebappPhase = 'missing' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error'

export interface WebappStatus {
  phase: WebappPhase
  ready: boolean
  version: string
  received: number
  total: number
  webappRoot: string
  message?: string
  installedAt?: string
}

export interface DiagramReadResult {
  path: string
  relativePath: string
  xml: string
  compressed: boolean
  mtimeMs: number
  size: number
}

export interface DiagramWriteResult {
  path: string
  relativePath: string
  mtimeMs: number
  size: number
  compressed: boolean
}

export interface DiagramEntry {
  name: string
  path: string
  relativePath: string
  mtimeMs: number
  size: number
}

export interface DiagramExistsResult {
  exists: boolean
  isFile: boolean
  mtimeMs?: number
  size?: number
}

/** Deployment configuration the browser is allowed to see. */
export interface DrawioClientConfig {
  editorUrl: string
  diagramsDir: string
  autosaveDelayMs: number
  writeDebounceMs: number
  uiTheme: string
  language: string
  allowOutsideWorkspace: boolean
  webappVersion: string
}

/** Workspace identity for the active session. */
export interface WorkspaceInfo {
  sessionId: string
  cwd: string
  scopeKey: string
  workspaceId?: string
  workspaceTitle?: string
  registered: boolean
  diagramsDir: string
}

interface Envelope<T> {
  ok: boolean
  value?: T
  error?: { code: string, message: string, details?: Record<string, unknown> }
}

/** A host-reported failure, with enough structure for the UI to branch on. */
export class DrawioApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown> | undefined

  constructor(message: string, status: number, code: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'DrawioApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** True for the "file changed under us" answer the viewer resolves interactively. */
  get isConflict(): boolean {
    return this.status === 409
  }
}

async function request<T>(
  route: string,
  body: Record<string, unknown>,
  method: 'GET' | 'POST' = 'POST',
  signal?: AbortSignal,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(route, {
      method,
      headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error) {
    throw new DrawioApiError(
      `无法连接 dsh-drawio 主机接口：${error instanceof Error ? error.message : String(error)}`,
      0,
      'network',
    )
  }

  let envelope: Envelope<T>
  try {
    envelope = await response.json() as Envelope<T>
  } catch {
    throw new DrawioApiError(
      `接口 ${route} 返回的不是 JSON（HTTP ${String(response.status)}）`,
      response.status,
      'bad-response',
    )
  }

  if (envelope.ok !== true || envelope.value === undefined) {
    throw new DrawioApiError(
      envelope.error?.message ?? `接口 ${route} 失败（HTTP ${String(response.status)}）`,
      response.status,
      envelope.error?.code ?? 'internal',
      envelope.error?.details,
    )
  }
  return envelope.value
}

/** Readiness + download progress of the self-hosted editor. */
export function fetchWebappStatus(signal?: AbortSignal): Promise<WebappStatus> {
  return request<WebappStatus>('/drawio/api/webapp-status', {}, 'GET', signal)
}

/** Start (or join) the one-time editor download and report progress. */
export function startWebappInstall(signal?: AbortSignal): Promise<WebappStatus> {
  return request<WebappStatus>('/drawio/api/webapp-status', {}, 'POST', signal)
}

function scopeBody(scope: SessionScope): Record<string, unknown> {
  return scope.cwd === undefined || scope.cwd === ''
    ? { sessionId: scope.sessionId }
    : { sessionId: scope.sessionId, cwd: scope.cwd }
}

/** Read a diagram (decoded) plus the mtime the editor will save against. */
export function readDiagram(scope: SessionScope, path: string, signal?: AbortSignal): Promise<DiagramReadResult> {
  return request<DiagramReadResult>('/drawio/api/read', { ...scopeBody(scope), path }, 'POST', signal)
}

/**
 * Write a diagram. `ifMtimeMs` makes the write conditional: the host answers
 * 409 instead of clobbering a file that changed since that timestamp. Omit it
 * to overwrite deliberately.
 */
export function writeDiagram(
  scope: SessionScope,
  path: string,
  xml: string,
  ifMtimeMs?: number,
  signal?: AbortSignal,
): Promise<DiagramWriteResult> {
  return request<DiagramWriteResult>(
    '/drawio/api/write',
    { ...scopeBody(scope), path, xml, ...(ifMtimeMs === undefined ? {} : { ifMtimeMs }) },
    'POST',
    signal,
  )
}

/** Deployment configuration for this browser session. */
export function fetchConfig(signal?: AbortSignal): Promise<DrawioClientConfig> {
  return request<DrawioClientConfig>('/drawio/api/config', {}, 'GET', signal)
}

let cachedConfig: Promise<DrawioClientConfig> | undefined

/**
 * Process-wide memo of {@link fetchConfig}. The configuration is deployment
 * static (only a restart can change it), and every open editor tab would
 * otherwise re-request it. A failure clears the memo so a retry can succeed.
 */
export function clientConfig(): Promise<DrawioClientConfig> {
  cachedConfig ??= fetchConfig().catch((error: unknown) => {
    cachedConfig = undefined
    throw error
  })
  return cachedConfig
}

/** Workspace identity (cwd, scope key, registered name) for a session. */
export function fetchWorkspace(scope: SessionScope, signal?: AbortSignal): Promise<WorkspaceInfo> {
  return request<WorkspaceInfo>('/drawio/api/workspace', scopeBody(scope), 'POST', signal)
}

/**
 * Create a blank diagram — the next free `<name>-N.drawio` in the configured
 * diagrams directory, or exactly at `path` when one is given.
 */
export function createDiagram(
  scope: SessionScope,
  options: { directory?: string, name?: string, path?: string } = {},
): Promise<DiagramReadResult> {
  return request<DiagramReadResult>('/drawio/api/create', { ...scopeBody(scope), ...options })
}

/** List the diagrams in the workspace diagrams directory. */
export function listDiagrams(scope: SessionScope, directory?: string): Promise<DiagramEntry[]> {
  return request<DiagramEntry[]>('/drawio/api/list', {
    ...scopeBody(scope),
    ...(directory === undefined ? {} : { directory }),
  })
}

/** Whether a path exists inside the workspace. */
export function diagramExists(scope: SessionScope, path: string): Promise<DiagramExistsResult> {
  return request<DiagramExistsResult>('/drawio/api/exists', { ...scopeBody(scope), path })
}
