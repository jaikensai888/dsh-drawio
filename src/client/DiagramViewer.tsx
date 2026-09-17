import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { FileViewerProps, SessionScope } from 'dsh-better-sidebar/client/service'
import {
  DrawioApiError,
  clientConfig,
  createDiagram,
  fetchWebappStatus,
  readDiagram,
  startWebappInstall,
  writeDiagram,
  type DiagramReadResult,
  type DrawioClientConfig,
  type WebappStatus,
} from './api.js'
import { drawioConfig, drawioEmbedUrl, createDrawioEmbedChannel } from './embed-protocol.js'

const POLL_INTERVAL_MS = 700
/** Below this the editor collapses its own side panels, which the user should know about. */
const NARROW_PANE_PX = 760

const FONT = '13px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
const BUTTON_STYLE: React.CSSProperties = { font: 'inherit', padding: '2px 8px', cursor: 'pointer' }

type Phase = 'config' | 'probing' | 'installing' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/** What the descriptor's `load()` hands back through `customData`. */
export type DiagramLoadPayload =
  | { kind: 'ready', diagram: DiagramReadResult }
  | { kind: 'missing', path: string }

function asLoadPayload(value: unknown): DiagramLoadPayload | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as { kind?: unknown, diagram?: unknown, path?: unknown }
  if (candidate.kind === 'missing' && typeof candidate.path === 'string') {
    return { kind: 'missing', path: candidate.path }
  }
  if (candidate.kind === 'ready' && typeof candidate.diagram === 'object' && candidate.diagram !== null) {
    return { kind: 'ready', diagram: candidate.diagram as DiagramReadResult }
  }
  return null
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB'] as const
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function progressText(status: WebappStatus | null): string {
  if (status === null) return '正在检查编辑器资源…'
  switch (status.phase) {
    case 'missing':
      return '正在准备下载 draw.io 编辑器…'
    case 'downloading':
      return `正在下载 draw.io 编辑器（${formatBytes(status.received)} / ${formatBytes(status.total)}）`
    case 'verifying':
      return '正在校验资源包完整性…'
    case 'extracting':
      return '正在解压编辑器资源（约 147 MB）…'
    default:
      return '正在检查编辑器资源…'
  }
}

function Panel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ padding: 16, font: FONT, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
  )
}

/** Last-resort error surface with a retry, used by every failed phase. */
function FailurePanel(props: {
  title: string
  message: string
  hint?: string
  onRetry: () => void
}): JSX.Element {
  return (
    <Panel>
      <strong>{props.title}</strong>
      <div style={{ opacity: 0.8, wordBreak: 'break-word' }}>{props.message}</div>
      {props.hint === undefined ? null : <div style={{ opacity: 0.6, fontSize: 12 }}>{props.hint}</div>}
      <div>
        <button type="button" onClick={props.onRetry} style={BUTTON_STYLE}>重试</button>
      </div>
    </Panel>
  )
}

/**
 * `.drawio` previewer backed by the self-hosted draw.io webapp.
 *
 * The editor runs in a plain same-origin iframe created by THIS component.
 *
 * ★ Do not add a `sandbox` attribute. drawio dies silently inside any sandbox
 * without `allow-same-origin` (its `localStorage` access throws on an opaque
 * origin and initialisation aborts without ever posting `init`). For the same
 * reason this viewer must never be hosted inside better-sidebar's browser/HTML
 * preview tabs, which are sandboxed frames.
 */
export function DiagramViewer(props: FileViewerProps): JSX.Element {
  const payload = asLoadPayload(props.customData)

  if (payload === null) {
    return (
      <Panel>
        <strong>无法加载图纸</strong>
        <div style={{ opacity: 0.8 }}>视图没有拿到文件内容，请关闭该标签页后重新打开。</div>
      </Panel>
    )
  }
  if (payload.kind === 'missing') {
    return (
      <MissingDiagram
        ctx={props.ctx}
        scope={props.scope}
        path={payload.path}
        title={props.title}
      />
    )
  }

  return (
    <EditorPane
      ctx={props.ctx}
      scope={props.scope}
      path={props.path}
      title={props.title}
      initial={payload.diagram}
    />
  )
}

/**
 * Cold start entry (B): the path the user opened does not exist.
 *
 * The sidebar reports this through our own `load()` rather than as an error, so
 * here it becomes an offer to create the file — which is what makes "type a new
 * path into the editor tab" a usable creation flow.
 */
function MissingDiagram(props: {
  ctx: Context
  scope: SessionScope
  path: string
  title: string
}): JSX.Element {
  const { ctx, scope, path, title } = props
  const [created, setCreated] = useState<DiagramReadResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // Create exactly at the path the user opened, then render it here — no
      // tab churn, and the file is on disk before the first autosave.
      setCreated(await createDiagram(scope, { path }))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [path, scope])

  if (created !== null) {
    return <EditorPane ctx={ctx} scope={scope} path={created.path} title={title} initial={created} />
  }

  return (
    <Panel>
      <strong>此文件不存在</strong>
      <div style={{ opacity: 0.8, wordBreak: 'break-all' }}>{path}</div>
      <div style={{ opacity: 0.7 }}>可以在这里把它创建为一张空白图纸，之后照常编辑并自动保存。</div>
      <div>
        <button type="button" onClick={() => void create()} disabled={busy} style={BUTTON_STYLE}>
          {busy ? '创建中…' : '创建为空白图纸'}
        </button>
      </div>
      {error === null ? null : <div style={{ color: '#e5534b' }}>⚠ {error}</div>}
    </Panel>
  )
}

function EditorPane(props: {
  ctx: Context
  scope: SessionScope
  path: string
  title: string
  initial: DiagramReadResult
}): JSX.Element {
  const { ctx, scope, path, title, initial } = props

  const [config, setConfig] = useState<DrawioClientConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configAttempt, setConfigAttempt] = useState(0)

  const [phase, setPhase] = useState<Phase>('config')
  const [status, setStatus] = useState<WebappStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [installAttempt, setInstallAttempt] = useState(0)

  const [doc, setDoc] = useState<DiagramReadResult>(initial)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ message: string, currentMtimeMs: number | null } | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')
  const [narrow, setNarrow] = useState(false)

  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const docRef = useRef<DiagramReadResult>(initial)
  const configRef = useRef<DrawioClientConfig | null>(null)
  const baselineRef = useRef({ mtimeMs: initial.mtimeMs, size: initial.size })
  const pendingRef = useRef<string | null>(null)
  const timerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const savingRef = useRef(false)
  /** Set while an unresolved conflict holds writes back. */
  const pausedRef = useRef(false)
  const dirtyRef = useRef(false)

  useEffect(() => {
    docRef.current = doc
  }, [doc])

  // --- deployment configuration ---------------------------------------------
  useEffect(() => {
    let cancelled = false
    setConfigError(null)
    clientConfig().then((value) => {
      if (cancelled) return
      configRef.current = value
      setConfig(value)
    }).catch((caught: unknown) => {
      if (cancelled) return
      setConfigError(caught instanceof Error ? caught.message : String(caught))
      setPhase('error')
    })
    return () => {
      cancelled = true
    }
  }, [configAttempt])

  // The sidebar pane is ~537px wide by default; below NARROW_PANE_PX drawio
  // collapses its own shape and format panels, so say how to get the room back.
  useEffect(() => {
    const element = rootRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      setNarrow(element.getBoundingClientRect().width < NARROW_PANE_PX)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const applyDocument = useCallback((next: DiagramReadResult): void => {
    docRef.current = next
    baselineRef.current = { mtimeMs: next.mtimeMs, size: next.size }
    pendingRef.current = null
    pausedRef.current = false
    dirtyRef.current = false
    setDoc(next)
    setDirty(false)
    setSaveState('idle')
    setSaveError(null)
    setConflict(null)
    // A fresh iframe re-runs configure -> init -> load, discarding local edits.
    setEditorKey((value) => value + 1)
  }, [])

  // --- write pipeline --------------------------------------------------------
  const flush = useCallback(async (options: { force?: boolean } = {}): Promise<void> => {
    if (timerRef.current !== null) {
      globalThis.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (savingRef.current) return
    const xml = pendingRef.current
    if (xml === null) return
    if (pausedRef.current && options.force !== true) return

    pendingRef.current = null
    savingRef.current = true
    setSaveState('saving')
    setSaveError(null)

    try {
      const result = await writeDiagram(
        scope,
        path,
        xml,
        options.force === true ? undefined : baselineRef.current.mtimeMs,
      )
      baselineRef.current = { mtimeMs: result.mtimeMs, size: result.size }
      pausedRef.current = false
      setConflict(null)
      setSaveState('saved')
      if (pendingRef.current === null) {
        dirtyRef.current = false
        setDirty(false)
      }
    } catch (caught) {
      if (caught instanceof DrawioApiError && caught.isConflict) {
        const current = caught.details?.['currentMtimeMs']
        setConflict({ message: caught.message, currentMtimeMs: typeof current === 'number' ? current : null })
        pausedRef.current = true
        // Leave 'saving' behind: the write did not land and will not retry until
        // the user resolves the conflict.
        setSaveState('failed')
      } else {
        setSaveError(caught instanceof Error ? caught.message : String(caught))
        setSaveState('failed')
      }
      // Keep the payload: a retry after the conflict is resolved must still land.
      if (pendingRef.current === null) pendingRef.current = xml
    } finally {
      savingRef.current = false
    }

    if (pendingRef.current !== null && !pausedRef.current) void flush()
  }, [scope, path])

  const scheduleSave = useCallback((xml: string): void => {
    pendingRef.current = xml
    dirtyRef.current = true
    setDirty(true)
    if (timerRef.current !== null) globalThis.clearTimeout(timerRef.current)
    timerRef.current = globalThis.setTimeout(() => {
      timerRef.current = null
      void flush()
    }, configRef.current?.writeDebounceMs ?? 1500)
  }, [flush])

  // Flush anything still pending when the viewer unmounts (tab close, HMR).
  //
  // Deliberately NOT forced: with an unresolved conflict on screen, silently
  // overwriting the file here would be exactly the clobber the 409 exists to
  // prevent. `flush()` already returns early while `pausedRef` is set, so a
  // closed tab leaves the external change intact and the local edit discarded —
  // the outcome the user was warned about.
  useEffect(() => () => {
    if (timerRef.current !== null) globalThis.clearTimeout(timerRef.current)
    if (pendingRef.current !== null && !pausedRef.current) void flush()
  }, [flush])

  // Last-resort guard for a browser reload / window close with unsaved work.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    globalThis.addEventListener('beforeunload', handler)
    return () => globalThis.removeEventListener('beforeunload', handler)
  }, [])

  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden' && pendingRef.current !== null && !pausedRef.current) {
        void flush()
      }
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [flush])

  // --- editor asset readiness ------------------------------------------------
  useEffect(() => {
    // An `editorUrl` escape hatch means we are not serving the editor at all,
    // so there is nothing to install or wait for.
    if (config === null) return undefined
    if (config.editorUrl !== '') {
      setPhase('ready')
      return undefined
    }

    const controller = new AbortController()
    let cancelled = false
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined
    let started = false

    const tick = async (): Promise<void> => {
      try {
        const snapshot = started
          ? await fetchWebappStatus(controller.signal)
          : await startWebappInstall(controller.signal)
        if (cancelled) return
        started = true
        setStatus(snapshot)
        if (snapshot.ready) {
          setError(null)
          setPhase('ready')
          return
        }
        if (snapshot.phase === 'error') {
          setError(snapshot.message ?? '编辑器资源安装失败')
          setPhase('error')
          return
        }
        setPhase('installing')
        timer = globalThis.setTimeout(() => {
          void tick()
        }, POLL_INTERVAL_MS)
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : String(caught))
        setPhase('error')
      }
    }

    setPhase('probing')
    setError(null)
    void tick()

    return () => {
      cancelled = true
      controller.abort()
      if (timer !== undefined) globalThis.clearTimeout(timer)
    }
  }, [config, installAttempt])

  // --- embed protocol --------------------------------------------------------
  useEffect(() => {
    if (phase !== 'ready') return undefined

    const channel = createDrawioEmbedChannel({
      getFrame: () => frameRef.current,
      onEvent: (event, payload) => {
        if (event === 'configure') {
          // drawio waits for this reply before it initialises, and the reply has
          // to reflect THIS file's storage style.
          channel.post('configure', {
            config: drawioConfig({
              compressed: docRef.current.compressed,
              autosaveDelayMs: configRef.current?.autosaveDelayMs ?? 1500,
            }),
          })
          return
        }
        if (event === 'init') {
          channel.post('load', {
            xml: docRef.current.xml,
            autosave: 1,
            title: title === '' ? '未命名图纸' : title,
          })
          return
        }
        if (event === 'autosave' || event === 'save') {
          const xml = payload['xml']
          if (typeof xml !== 'string' || xml === '') return
          scheduleSave(xml)
          // drawio's own Save (Ctrl+S / the toolbar check) is authoritative:
          // land it now instead of waiting out the debounce.
          if (event === 'save') void flush()
          return
        }
        // `exit` is deliberately not wired to closeTab: FileViewerProps carries
        // no tab id, and the data-safety half of it (flush before leaving) is
        // already covered by the pending-write pipeline above.
      },
    })

    return () => channel.dispose()
  }, [phase, title, scheduleSave, flush])

  // --- conflict + save-as + new actions --------------------------------------
  const reloadFromDisk = useCallback(async (): Promise<void> => {
    try {
      applyDocument(await readDiagram(scope, path))
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
      setSaveState('failed')
    }
  }, [applyDocument, scope, path])

  const saveAs = useCallback(async (): Promise<void> => {
    const name = saveAsName.trim().replace(/\.drawio$/iu, '')
    if (name === '') return
    const directory = configRef.current?.diagramsDir ?? 'docs/diagrams'
    try {
      await writeDiagram(scope, `${directory}/${name}.drawio`, docRef.current.xml)
      setSaveAsOpen(false)
      setSaveAsName('')
      ctx.betterSidebar.openFile(scope, `${directory}/${name}.drawio`)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
      setSaveState('failed')
    }
  }, [ctx, scope, saveAsName])

  const newDiagram = useCallback(async (): Promise<void> => {
    try {
      const created = await createDiagram(scope)
      ctx.betterSidebar.openFile(scope, created.relativePath)
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : String(caught))
      setSaveState('failed')
    }
  }, [ctx, scope])

  // --- render ----------------------------------------------------------------
  if (configError !== null) {
    return (
      <FailurePanel
        title="无法读取插件配置"
        message={configError}
        hint="dsh-drawio 的主机接口没有应答。请确认插件已挂载，然后重试。"
        onRetry={() => setConfigAttempt((value) => value + 1)}
      />
    )
  }

  if (phase !== 'ready') {
    if (phase === 'error') {
      return (
        <FailurePanel
          title="编辑器资源不可用"
          message={error ?? '未知错误'}
          hint="首次使用需要从 GitHub 下载 draw.io 资源包（约 51 MB）并解压到本机 DSH 存储目录。请检查网络后重试。"
          onRetry={() => setInstallAttempt((value) => value + 1)}
        />
      )
    }
    const ratio = status !== null && status.total > 0 ? Math.min(1, status.received / status.total) : 0
    return (
      <Panel>
        <strong>{phase === 'config' || phase === 'probing' ? '正在准备图表编辑器' : '首次使用：正在准备图表编辑器'}</strong>
        <div style={{ opacity: 0.85 }}>{phase === 'config' ? '正在读取插件配置…' : progressText(status)}</div>
        <div style={{ height: 6, borderRadius: 3, background: 'rgba(127,127,127,0.25)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${String(Math.round(ratio * 100))}%`,
              background: 'currentColor',
              opacity: 0.55,
              transition: 'width 200ms linear',
            }}
          />
        </div>
        <div style={{ opacity: 0.55, fontSize: 12 }}>
          draw.io 资源包只下载一次，之后完全离线。图纸始终以 `.drawio` 文件保存在当前工作区。
        </div>
      </Panel>
    )
  }

  const saveLabel = conflict !== null
    ? '有冲突'
    : saveState === 'saving'
      ? '保存中…'
      : saveState === 'saved'
        ? '已保存'
        : saveState === 'failed'
          ? '保存失败'
          : dirty
            ? '未保存'
            : '已同步'

  const diagramsDir = config?.diagramsDir ?? 'docs/diagrams'

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          fontSize: 12,
          borderBottom: '1px solid rgba(127,127,127,0.25)',
        }}
      >
        <span style={{ fontWeight: 600 }}>图表编辑器</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.path}>
          {doc.relativePath === '' ? doc.path : doc.relativePath}
        </span>
        {doc.compressed ? <span style={{ opacity: 0.55 }}>压缩存储</span> : null}
        <span style={{ opacity: saveState === 'failed' ? 1 : 0.7 }}>{saveLabel}</span>
        <button type="button" onClick={() => void newDiagram()} style={BUTTON_STYLE}>新建</button>
        <button type="button" onClick={() => void flush()} style={BUTTON_STYLE}>保存</button>
        <button type="button" onClick={() => setSaveAsOpen((value) => !value)} style={BUTTON_STYLE}>另存为</button>
        <button type="button" onClick={() => void reloadFromDisk()} style={BUTTON_STYLE}>重新加载</button>
      </div>

      {narrow ? (
        <div style={{ padding: '3px 8px', fontSize: 11, opacity: 0.6, borderBottom: '1px solid rgba(127,127,127,0.18)' }}>
          侧边栏较窄时 draw.io 会收起形状/格式面板 —— 把本标签页拖到主会话区域即可变成可缩放的悬浮窗口。
        </div>
      ) : null}

      {conflict !== null ? (
        <div
          style={{
            padding: '6px 8px',
            fontSize: 12,
            background: 'rgba(229,83,75,0.14)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          {/* The host message already ends in a path, so it needs its own
              separator — otherwise it reads as "demo.drawio本地改动…". */}
          <span style={{ flex: 1 }}>⚠ {conflict.message}；本地改动尚未写入磁盘。</span>
          <button type="button" onClick={() => void reloadFromDisk()} style={BUTTON_STYLE}>
            放弃本地改动，读磁盘
          </button>
          <button type="button" onClick={() => void flush({ force: true })} style={BUTTON_STYLE}>
            用我的版本覆盖
          </button>
        </div>
      ) : null}

      {saveAsOpen ? (
        <div
          style={{
            padding: '6px 8px',
            fontSize: 12,
            background: 'rgba(127,127,127,0.12)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <span>另存到 {diagramsDir}/</span>
          <input
            value={saveAsName}
            onChange={(event) => setSaveAsName(event.target.value)}
            placeholder="文件名"
            style={{ font: 'inherit', padding: '2px 6px', flex: 1, minWidth: 80 }}
          />
          <span>.drawio</span>
          <button type="button" onClick={() => void saveAs()} disabled={saveAsName.trim() === ''} style={BUTTON_STYLE}>
            确定
          </button>
          <button type="button" onClick={() => setSaveAsOpen(false)} style={BUTTON_STYLE}>
            取消
          </button>
        </div>
      ) : null}

      {saveError !== null ? (
        <div style={{ padding: '6px 8px', fontSize: 12, background: 'rgba(229,83,75,0.14)' }}>⚠ {saveError}</div>
      ) : null}

      {/* No `sandbox` — see the component doc comment. */}
      <iframe
        key={editorKey}
        ref={frameRef}
        src={config?.editorUrl !== undefined && config.editorUrl !== ''
          ? config.editorUrl
          : drawioEmbedUrl({
            uiTheme: config?.uiTheme ?? 'kennedy',
            language: config?.language ?? 'zh',
          })}
        title={`图表编辑器：${title}`}
        style={{ flex: 1, width: '100%', minHeight: 0, border: 0, background: '#ffffff' }}
      />
    </div>
  )
}
