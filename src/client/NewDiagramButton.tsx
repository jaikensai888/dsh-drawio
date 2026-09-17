import { useCallback, useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionScope } from 'dsh-better-sidebar/client/service'
import { createDiagram } from './api.js'

/**
 * Cold start entry (A): a 「新建图纸」 button in the **official** left sidebar's
 * footer slot.
 *
 * Without this a fresh workspace has no way in at all — the `.drawio` file
 * viewer only appears once a `.drawio` exists. `sidebar.footer.action` is a
 * `list`-kind slot declared by `@deepseek-ai/dsh-client-ui-sidebar`, and it is
 * the only additive seat the official sidebar offers.
 *
 * The active session comes from the sidebar service snapshot rather than from
 * slot props: the slot is `scope: 'root'`, so its owner props carry no session,
 * and `getSnapshot().sessionId` is exactly what better-sidebar itself uses.
 */

/** The slot this button occupies. */
export const FOOTER_ACTION_SLOT = 'sidebar.footer.action'

function activeScope(ctx: Context): SessionScope | undefined {
  try {
    const snapshot = ctx.betterSidebar.getSnapshot() as { sessionId?: unknown }
    const sessionId = snapshot.sessionId
    return typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : undefined
  } catch {
    return undefined
  }
}

function NewDiagramIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="1.75" y="1.75" width="6" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.25" y="9.75" width="6" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.75 6.25v3.5a1 1 0 0 0 1 1h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function NewDiagramButton({ ctx }: { ctx: Context }): JSX.Element {
  const [scope, setScope] = useState<SessionScope | undefined>(() => activeScope(ctx))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The slot is root-scoped, so follow the sidebar's active session live.
  useEffect(() => {
    const sync = (): void => {
      setScope(activeScope(ctx))
    }
    sync()
    return ctx.betterSidebar.subscribeState(sync)
  }, [ctx])

  const create = useCallback(async (): Promise<void> => {
    if (scope === undefined || busy) return
    setBusy(true)
    setError(null)
    try {
      const created = await createDiagram(scope)
      // Hand the new file to the sidebar, which matches our viewer and re-runs
      // load() for it — the tab opens straight into the editor.
      ctx.betterSidebar.openFile(scope, created.relativePath)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [busy, ctx, scope])

  const disabled = scope === undefined || busy
  const title = scope === undefined
    ? '当前没有活跃会话，无法确定工作区'
    : error !== null
      ? `新建图纸失败：${error}`
      : '在当前工作区的 docs/diagrams/ 下新建一张空白图纸'

  return (
    <button
      type="button"
      onClick={() => {
        void create()
      }}
      disabled={disabled}
      title={title}
      aria-label="新建图纸"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        font: 'inherit',
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        background: 'transparent',
        border: '1px solid rgba(127,127,127,0.35)',
        borderRadius: 4,
        color: 'inherit',
      }}
    >
      <NewDiagramIcon />
      <span>{busy ? '新建中…' : '新建图纸'}</span>
    </button>
  )
}
