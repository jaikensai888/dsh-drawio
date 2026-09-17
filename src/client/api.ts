/**
 * Client-side access to the plugin's own host routes.
 *
 * Every `/drawio/api/*` response uses the `{ ok, value | error }` envelope, so
 * the unwrapping lives here once instead of at each call site.
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

interface Envelope<T> {
  ok: boolean
  value?: T
  error?: { code: string, message: string }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
    ...init,
  })

  let body: Envelope<T>
  try {
    body = await response.json() as Envelope<T>
  } catch {
    throw new Error(`接口 ${path} 返回的不是 JSON（HTTP ${String(response.status)}）`)
  }

  if (body.ok !== true || body.value === undefined) {
    throw new Error(body.error?.message ?? `接口 ${path} 失败（HTTP ${String(response.status)}）`)
  }
  return body.value
}

/** Readiness + download progress of the self-hosted editor. */
export function fetchWebappStatus(): Promise<WebappStatus> {
  return request<WebappStatus>('/drawio/api/webapp-status')
}

/** Start (or join) the one-time editor download and report progress. */
export function startWebappInstall(): Promise<WebappStatus> {
  return request<WebappStatus>('/drawio/api/webapp-status', { method: 'POST' })
}
