import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { FileViewerProps, SessionScope } from 'dsh-better-sidebar/client/service'
import {
  DrawioApiError,
  fetchWebappStatus,
  readDiagram,
  startWebappInstall,
  writeDiagram,
  type DiagramReadResult,
  type WebappStatus,
} from './api.js'
import { drawioConfig, DRAWIO_EMBED_URL, createDrawioEmbedChannel } from './embed-protocol.js'

const POLL_INTERVAL_MS = 700
/** Idle delay before an autosave reaches disk; at or above drawio's own 1500ms autosaveDelay. */
const WRITE_DEBOUNCE_MS = 1500
/** Where "另存为" drops a copy, relative to the workspace. */
const DIAGRAMS_DIR = 'docs/diagrams'

const FONT = '13px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
const BUTTON_STYLE: React.CSSProperties = { font: 'inherit', padding: '2px 8px', cursor: 'pointer' }

type InstallPhase = 'probing' | 'installing' | 'ready' | 'error'
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
      <Panel>
        <strong>此文件不存在</strong>
        <div style={{ opacity: 0.8, wordBreak: 'break-all' }}>{payload.path}</div>
        <div style={{ opacity: 0.6, fontSize: 12 }}>
          确认路径是否正确。在编辑器标签页里直接敲一个不存在的 `docs/diagrams/x.drawio` 时，下一步会在这里提供创建按钮。
        </div>
      </Panel>
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

function EditorPane(props: {
  ctx: Context
  scope: SessionScope
  path: string
  title: string
  initial: DiagramReadResult
}): JSX.Element {
  const { ctx, scope, path, title, initial } = props

  const [installPhase, setInstallPhase] = useState<InstallPhase>('probing')
  const [status, setStatus] = useState<WebappStatus | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installAttempt, setInstallAttempt] = useState(0)

  const [doc, setDoc] = useState<DiagramReadResult>(initial)
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ message: string, currentMtimeMs: number | null } | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')

  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const docRef = useRef<DiagramReadResult>(initial)
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
    } catch (error) {
      if (error instanceof DrawioApiError && error.isConflict) {
        const current = error.details?.['currentMtimeMs']
        setConflict({ message: error.message, currentMtimeMs: typeof current === 'number' ? current : null })
        pausedRef.current = true
      } else {
        setSaveError(error instanceof Error ? error.message : String(error))
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
    }, WRITE_DEBOUNCE_MS)
  }, [flush])

  // Flush anything still pending when the viewer unmounts (tab close, HMR).
  useEffect(() => () => {
    if (timerRef.current !== null) globalThis.clearTimeout(timerRef.current)
    if (pendingRef.current !== null && !pausedRef.current) void flush({ force: true })
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
          setInstallError(null)
          setInstallPhase('ready')
          return
        }
        if (snapshot.phase === 'error') {
          setInstallError(snapshot.message ?? '编辑器资源安装失败')
          setInstallPhase('error')
          return
        }
        setInstallPhase('installing')
        timer = globalThis.setTimeout(() => {
          void tick()
        }, POLL_INTERVAL_MS)
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return
        setInstallError(caught instanceof Error ? caught.message : String(caught))
        setInstallPhase('error')
      }
    }

    setInstallPhase('probing')
    setInstallError(null)
    void tick()

    return () => {
      cancelled = true
      controller.abort()
      if (timer !== undefined) globalThis.clearTimeout(timer)
    }
  }, [installAttempt])

  // --- embed protocol --------------------------------------------------------
  useEffect(() => {
    if (installPhase !== 'ready') return undefined

    const channel = createDrawioEmbedChannel({
      getFrame: () => frameRef.current,
      onEvent: (event, payload) => {
        if (event === 'configure') {
          // drawio waits for this reply before it initialises, and the reply has
          // to reflect THIS file's storage style.
          channel.post('configure', { config: drawioConfig({ compressed: docRef.current.compressed }) })
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
  }, [installPhase, title, scheduleSave, flush])

  // --- conflict + save-as actions -------------------------------------------
  const reloadFromDisk = useCallback(async (): Promise<void> => {
    try {
      applyDocument(await readDiagram(scope, path))
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaveState('failed')
    }
  }, [applyDocument, scope, path])

  const saveAs = useCallback(async (): Promise<void> => {
    const name = saveAsName.trim().replace(/\.drawio$/iu, '')
    if (name === '') return
    try {
      const result = await writeDiagram(scope, `${DIAGRAMS_DIR}/${name}.drawio`, docRef.current.xml)
      setSaveAsOpen(false)
      setSaveAsName('')
      // Hand the new path to the sidebar, which re-runs our load() for it.
      ctx.betterSidebar.openFile(scope, result.path, `${name}.drawio`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
      setSaveState('failed')
    }
  }, [ctx, scope, saveAsName])

  // --- render ----------------------------------------------------------------
  if (installPhase !== 'ready') {
    if (installPhase === 'error') {
      return (
        <Panel>
          <strong>编辑器资源不可用</strong>
          <div style={{ opacity: 0.8, wordBreak: 'break-word' }}>{installError ?? '未知错误'}</div>
          <div style={{ opacity: 0.6, fontSize: 12 }}>
            首次使用需要从 GitHub 下载 draw.io 资源包（约 51 MB）并解压到本机 DSH 存储目录。请检查网络后重试。
          </div>
          <div>
            <button type="button" onClick={() => setInstallAttempt((value) => value + 1)} style={BUTTON_STYLE}>
              重试
            </button>
          </div>
        </Panel>
      )
    }
    const ratio = status !== null && status.total > 0 ? Math.min(1, status.received / status.total) : 0
    return (
      <Panel>
        <strong>首次使用：正在准备图表编辑器</strong>
        <div style={{ opacity: 0.85 }}>{progressText(status)}</div>
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

  const saveLabel = saveState === 'saving'
    ? '保存中…'
    : saveState === 'saved'
      ? '已保存'
      : saveState === 'failed'
        ? '保存失败'
        : dirty
          ? '未保存'
          : '已同步'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
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
        <button type="button" onClick={() => void flush()} style={BUTTON_STYLE}>
          保存
        </button>
        <button type="button" onClick={() => setSaveAsOpen((value) => !value)} style={BUTTON_STYLE}>
          另存为
        </button>
        <button type="button" onClick={() => void reloadFromDisk()} style={BUTTON_STYLE}>
          重新加载
        </button>
      </div>

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
          <span style={{ flex: 1 }}>⚠ {conflict.message}本地改动尚未写入磁盘。</span>
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
          <span>另存到 {DIAGRAMS_DIR}/</span>
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
        src={DRAWIO_EMBED_URL}
        title={`图表编辑器：${title}`}
        style={{ flex: 1, width: '100%', minHeight: 0, border: 0, background: '#ffffff' }}
      />
    </div>
  )
}
