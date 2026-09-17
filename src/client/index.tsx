import { useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-better-sidebar'
import type { FileViewerDescriptor, FileViewerProps } from 'dsh-better-sidebar/client/service'

/**
 * Client-half plugin: register a `.drawio` file previewer on the
 * dsh-better-sidebar service. `inject` holds *cordis service names* — do not
 * confuse it with `dsh.client.inject` in package.json, which holds package
 * names and only controls client-bundle arrival order.
 */
export const inject = ['betterSidebar'] as const

/** Namespaced so it can never collide with a builtin viewer id. */
export const DIAGRAM_VIEWER_ID = 'dsh-drawio:diagram'

const VIEWER_TITLE = '图表编辑器'

/**
 * P0 placeholder: proves the viewer wins the `.drawio` file match. P1 replaces
 * the body with the real drawio iframe (which must NOT carry a `sandbox`
 * attribute — drawio dies silently without `allow-same-origin`).
 */
function DiagramViewer({ path, title, viewerId, scope }: FileViewerProps): JSX.Element {
  const [probe, setProbe] = useState<string>('未检查')

  const ping = async (): Promise<void> => {
    setProbe('检查中…')
    try {
      const response = await fetch('/drawio/ping', { headers: { accept: 'application/json' } })
      const body = await response.text()
      setProbe(`${response.status} ${body}`)
    } catch (error) {
      setProbe(`失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        height: '100%',
        boxSizing: 'border-box',
        overflow: 'auto',
        font: '13px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.65 }}>{VIEWER_TITLE} · dsh-drawio（P0 骨架）</div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: 1 }}>hello</div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 10px', opacity: 0.85 }}>
        <dt style={{ opacity: 0.6 }}>文件</dt>
        <dd style={{ margin: 0, wordBreak: 'break-all' }}>{path}</dd>
        <dt style={{ opacity: 0.6 }}>标题</dt>
        <dd style={{ margin: 0 }}>{title}</dd>
        <dt style={{ opacity: 0.6 }}>viewer</dt>
        <dd style={{ margin: 0 }}>{viewerId}</dd>
        <dt style={{ opacity: 0.6 }}>会话</dt>
        <dd style={{ margin: 0 }}>{scope.sessionId}</dd>
        <dt style={{ opacity: 0.6 }}>cwd</dt>
        <dd style={{ margin: 0, wordBreak: 'break-all' }}>{scope.cwd ?? '(未提供，以 host 侧为准)'}</dd>
      </dl>
      <div>
        <button type="button" onClick={() => void ping()} style={{ font: 'inherit', padding: '4px 10px', cursor: 'pointer' }}>
          检查 host 路由
        </button>
      </div>
      <pre style={{ margin: 0, padding: 8, borderRadius: 4, background: 'rgba(127,127,127,0.14)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {probe}
      </pre>
      <div style={{ fontSize: 12, opacity: 0.55 }}>
        P0 只验证管线：`dsh` 字段契约、`exports["./client"]`、`__ModuleLoader__` 包装、
        `dsh plugin add` 的 bundle reconcile、client 半能否拿到 `ctx.betterSidebar`。
      </div>
    </div>
  )
}

/** The descriptor handed to `ctx.betterSidebar.registerFileViewer`. */
export function createDiagramViewerDescriptor(): FileViewerDescriptor {
  return {
    id: DIAGRAM_VIEWER_ID,
    title: VIEWER_TITLE,
    // `.drawio` is currently unclaimed and would otherwise fall through to the
    // catch-all `code` viewer (priority -100); priority 0 wins outright.
    exts: ['drawio', 'dio'],
    priority: 0,
    fetchStrategy: 'none',
    component: (props: FileViewerProps) => <DiagramViewer {...props} />,
  }
}

export function apply(ctx: Context): void {
  // registerFileViewer returns the disposer; ctx.effect wires it to fiber
  // disposal so HMR / unmount never leaves a duplicate registration behind
  // (a duplicate id throws).
  ctx.effect(() => ctx.betterSidebar.registerFileViewer(createDiagramViewerDescriptor()))
}
