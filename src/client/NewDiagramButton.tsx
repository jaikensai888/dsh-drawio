import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
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

/**
 * Sizing taken from the official footer entry this button sits next to.
 *
 * The 设置 row (`ui-settings-general`'s `.trigger`) is **42px high and full
 * width in the expanded column, and a 36x36 circle in the rail**, with a 16x16
 * glyph when expanded and 18x18 when collapsed (`IconSettingsOutline16` /
 * `IconSettingsOutline14`), and it drops its label text in the rail. The slot
 * owner hands us exactly that state as the `wide` prop, so we mirror it rather
 * than pick our own numbers.
 */
const RAIL_ROW_HEIGHT_PX = 42
const RAIL_BUTTON_PX = 36
const RAIL_ICON_PX_WIDE = 16
const RAIL_ICON_PX_NARROW = 18

/** Visible only in the expanded column, like the settings row's own label. */
const RAIL_LABEL = '画布'

/**
 * Hover state needs a real CSS rule: inline styles outrank class selectors, so
 * the base background has to live in the same sheet as the `:hover` one.
 */
const RAIL_STYLE_ID = 'dsh-drawio-rail-entry'
const RAIL_STYLE_RULES = [
  '.dsh-drawio-rail-entry{background:transparent}',
  '.dsh-drawio-rail-entry:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
].join('')

function ensureRailStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(RAIL_STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = RAIL_STYLE_ID
  style.textContent = RAIL_STYLE_RULES
  document.head.append(style)
}

function activeScope(ctx: Context): SessionScope | undefined {
  try {
    const snapshot = ctx.betterSidebar.getSnapshot() as { sessionId?: unknown }
    const sessionId = snapshot.sessionId
    return typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : undefined
  } catch {
    return undefined
  }
}

/**
 * Icon-only glyph, drawn in the rail's own 16-unit viewBox and sized to match
 * whatever the settings icon currently uses.
 */
function NewDiagramIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      // The slot's container is a flex row: without this the glyph gets
      // squeezed horizontally (measured 7x16 before this was pinned).
      style={{ flex: '0 0 auto', display: 'block' }}
    >
      <rect x="1.75" y="1.75" width="6" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8.25" y="9.75" width="6" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4.75 6.25v3.5a1 1 0 0 0 1 1h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function NewDiagramButton({ ctx, wide = true }: { ctx: Context, wide?: boolean }): JSX.Element {
  const [scope, setScope] = useState<SessionScope | undefined>(() => activeScope(ctx))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The slot is root-scoped, so follow the sidebar's active session live.
  useEffect(() => {
    ensureRailStyles()
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
    ? '新建图纸：当前没有活跃会话，无法确定工作区'
    : error !== null
      ? `新建图纸失败：${error}`
      : `新建图纸：在当前工作区新建一张空白图纸`

  // Mirrors the settings row: icon + label in the expanded column, a bare circle
  // in the rail. The tooltip still spells out what clicking actually does.
  const wideStyle: CSSProperties = {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 'none',
    width: 'calc(100% + 4px)',
    height: RAIL_ROW_HEIGHT_PX,
    margin: '4px -2px',
    padding: '0 10px 0 8px',
    border: 'none',
    borderRadius: 12,
    overflow: 'hidden',
    color: error !== null ? '#e5534b' : 'var(--dsw-alias-label-primary, inherit)',
    fontFamily: 'inherit',
    fontSize: 14,
    lineHeight: '22px',
    fontWeight: 400,
    textAlign: 'left',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  }
  const narrowStyle: CSSProperties = {
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 'none',
    width: RAIL_BUTTON_PX,
    height: RAIL_BUTTON_PX,
    margin: '8px 0 10px',
    padding: 0,
    border: 'none',
    borderRadius: '50%',
    color: error !== null ? '#e5534b' : 'var(--dsw-alias-label-primary, inherit)',
    font: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  }

  return (
    <button
      type="button"
      className="dsh-drawio-rail-entry"
      onClick={() => {
        void create()
      }}
      disabled={disabled}
      title={title}
      aria-label="新建图纸"
      aria-busy={busy}
      style={wide ? wideStyle : narrowStyle}
    >
      <NewDiagramIcon size={wide ? RAIL_ICON_PX_WIDE : RAIL_ICON_PX_NARROW} />
      {wide ? (
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{RAIL_LABEL}</span>
      ) : null}
    </button>
  )
}
