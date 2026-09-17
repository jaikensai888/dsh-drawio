import { useEffect, useRef, useState } from 'react'
import type { FileViewerProps } from 'dsh-better-sidebar/client/service'
import { fetchWebappStatus, startWebappInstall, type WebappStatus } from './api.js'
import {
  DRAWIO_CONFIG,
  DRAWIO_EMBED_URL,
  EMPTY_DIAGRAM_XML,
  createDrawioEmbedChannel,
  type DrawioEmbedChannel,
} from './embed-protocol.js'

const POLL_INTERVAL_MS = 700

type Phase = 'probing' | 'installing' | 'ready' | 'error'

const FONT = '13px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'

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
export function DiagramViewer({ path, title }: FileViewerProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('probing')
  const [status, setStatus] = useState<WebappStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const channelRef = useRef<DrawioEmbedChannel | null>(null)

  // --- editor asset readiness ------------------------------------------------
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined
    let started = false

    const schedule = (): void => {
      timer = globalThis.setTimeout(() => {
        void tick()
      }, POLL_INTERVAL_MS)
    }

    const tick = async (): Promise<void> => {
      try {
        const snapshot = started ? await fetchWebappStatus() : await startWebappInstall()
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
        schedule()
      } catch (caught) {
        if (cancelled) return
        setError(caught instanceof Error ? caught.message : String(caught))
        setPhase('error')
      }
    }

    setPhase('probing')
    setError(null)
    void tick()

    return () => {
      cancelled = true
      if (timer !== undefined) globalThis.clearTimeout(timer)
    }
  }, [reloadKey])

  // --- embed protocol --------------------------------------------------------
  useEffect(() => {
    if (phase !== 'ready') return undefined

    const channel = createDrawioEmbedChannel({
      getFrame: () => frameRef.current,
      onEvent: (event, _payload) => {
        if (event === 'configure') {
          // drawio waits for this reply before it initialises.
          channel.post('configure', { config: DRAWIO_CONFIG })
          return
        }
        if (event === 'init') {
          // P1 loads a hardcoded blank document; P2 replaces this with the
          // file read and starts persisting autosave/save payloads.
          channel.post('load', {
            xml: EMPTY_DIAGRAM_XML,
            autosave: 1,
            title: title === '' ? '未命名图纸' : title,
          })
        }
      },
    })
    channelRef.current = channel

    return () => {
      channel.dispose()
      channelRef.current = null
    }
  }, [phase, title])

  if (phase === 'ready') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 8px',
            fontSize: 12,
            opacity: 0.75,
            borderBottom: '1px solid rgba(127,127,127,0.25)',
          }}
        >
          <span style={{ fontWeight: 600 }}>图表编辑器</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={path}>
            {path}
          </span>
          <button
            type="button"
            onClick={() => {
              setReloadKey((value) => value + 1)
            }}
            style={{ font: 'inherit', padding: '2px 8px', cursor: 'pointer' }}
          >
            重新加载
          </button>
        </div>
        {/* No `sandbox` — see the component doc comment. */}
        <iframe
          ref={frameRef}
          src={DRAWIO_EMBED_URL}
          title={`图表编辑器：${title}`}
          style={{ flex: 1, width: '100%', minHeight: 0, border: 0, background: '#ffffff' }}
        />
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={{ padding: 16, font: FONT, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>编辑器资源不可用</div>
        <div style={{ opacity: 0.8, wordBreak: 'break-word' }}>{error ?? '未知错误'}</div>
        <div style={{ opacity: 0.6, fontSize: 12 }}>
          首次使用需要从 GitHub 下载 draw.io 资源包（约 51 MB），并解压到本机 DSH 存储目录。请检查网络后重试。
        </div>
        <div>
          <button
            type="button"
            onClick={() => {
              setReloadKey((value) => value + 1)
            }}
            style={{ font: 'inherit', padding: '4px 10px', cursor: 'pointer' }}
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  const ratio = status !== null && status.total > 0 ? Math.min(1, status.received / status.total) : 0
  return (
    <div style={{ padding: 16, font: FONT, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>首次使用：正在准备图表编辑器</div>
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
    </div>
  )
}
