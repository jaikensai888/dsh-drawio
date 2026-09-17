import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import AdmZip from 'adm-zip'

/**
 * Pinned drawio release. The tag AND the archive digest are frozen in code on
 * purpose — never resolve `latest` at runtime, or a compromised/rewritten
 * upstream release would silently become our editor.
 *
 * Verified 2026-09-17 against
 * https://github.com/jgraph/drawio/releases/tag/v31.4.6
 */
export const DRAWIO_RELEASE_TAG = 'v31.4.6'
export const DRAWIO_WAR_URL = `https://github.com/jgraph/drawio/releases/download/${DRAWIO_RELEASE_TAG}/draw.war`
export const DRAWIO_WAR_SHA256 = 'f7798104da17d7e9494ab348c3ba9b2a65640096bd54f704d7a0fa2fab283938'
export const DRAWIO_WAR_BYTES = 53_762_297

/** Archive top-level directories that belong to the Java webapp, not the editor. */
const SKIPPED_TOP_LEVEL = new Set(['web-inf', 'meta-inf'])

/** `<dshHome>/storages/dsh-drawio` — the harness home, not the workspace. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env['DSH_HOME']
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

export type WebappPhase = 'missing' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error'

/** Progress snapshot handed to the viewer while the editor is not usable yet. */
export interface WebappStatus {
  phase: WebappPhase
  ready: boolean
  version: string
  /** Bytes received so far (only meaningful while `phase === 'downloading'`). */
  received: number
  /** Expected archive size in bytes. */
  total: number
  webappRoot: string
  /** Human-readable (Chinese) explanation for `error`, or a short hint otherwise. */
  message?: string
  installedAt?: string
}

interface MarkerFile {
  version: string
  source: string
  sha256: string
  warBytes: number
  webappBytes: number
  files: number
  rootPrefix: string
  installedAt: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Downloads and unpacks the drawio webapp into `<dshHome>/storages/dsh-drawio/webapp`.
 *
 * Only one install runs at a time; every caller observes the same progress
 * snapshot, so N open viewers do not start N downloads. The unpacked tree is
 * built in a `.extract-<nonce>` sibling and swapped in with a rename, so an
 * interrupted install never leaves a half-populated webapp behind.
 */
export class WebappInstaller {
  readonly root: string
  readonly webappRoot: string
  readonly #markerPath: string
  #phase: WebappPhase = 'missing'
  #received = 0
  #total = DRAWIO_WAR_BYTES
  #message: string | undefined
  #installedAt: string | undefined
  #running: Promise<void> | undefined
  #probed = false

  constructor(options: { root?: string } = {}) {
    this.root = options.root ?? join(resolveDshHome(), 'storages', 'dsh-drawio')
    this.webappRoot = join(this.root, 'webapp')
    this.#markerPath = join(this.root, '.installed.json')
  }

  /** Current progress; probes the marker file once per process. */
  async status(): Promise<WebappStatus> {
    if (!this.#probed) await this.#probe()
    return this.#snapshot()
  }

  /**
   * Start (or join) an install when the editor is not ready yet. Returns
   * immediately with the current snapshot — callers poll {@link status}.
   */
  async ensure(): Promise<WebappStatus> {
    const current = await this.status()
    if (current.ready || current.phase === 'downloading' || current.phase === 'verifying' || current.phase === 'extracting') {
      return current
    }
    if (this.#running === undefined) {
      this.#running = this.#install()
        .catch(() => {
          // The failure is already reflected in the snapshot; the caller polls.
        })
        .finally(() => {
          this.#running = undefined
        })
    }
    return this.#snapshot()
  }

  #snapshot(): WebappStatus {
    const base = {
      phase: this.#phase,
      ready: this.#phase === 'ready',
      version: DRAWIO_RELEASE_TAG,
      received: this.#received,
      total: this.#total,
      webappRoot: this.webappRoot,
    }
    return {
      ...base,
      ...(this.#message === undefined ? {} : { message: this.#message }),
      ...(this.#installedAt === undefined ? {} : { installedAt: this.#installedAt }),
    }
  }

  /** Marker present, version matching, and an `index.html` actually on disk? */
  async #probe(): Promise<void> {
    this.#probed = true
    try {
      const marker = JSON.parse(await readFile(this.#markerPath, 'utf8')) as Partial<MarkerFile>
      if (marker.version !== DRAWIO_RELEASE_TAG || marker.sha256 !== DRAWIO_WAR_SHA256) {
        this.#phase = 'missing'
        return
      }
      const info = await stat(join(this.webappRoot, 'index.html'))
      if (!info.isFile()) {
        this.#phase = 'missing'
        return
      }
      this.#phase = 'ready'
      this.#installedAt = marker.installedAt
      this.#total = typeof marker.warBytes === 'number' && marker.warBytes > 0 ? marker.warBytes : DRAWIO_WAR_BYTES
      this.#received = this.#total
    } catch {
      this.#phase = 'missing'
    }
  }

  async #install(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const nonce = randomBytes(6).toString('hex')
    const warPath = join(this.root, `.download-${nonce}.war`)
    const extractDir = join(this.root, `.extract-${nonce}`)
    this.#message = undefined

    try {
      this.#phase = 'downloading'
      this.#received = 0
      this.#total = DRAWIO_WAR_BYTES
      const digest = await this.#download(warPath)
      const warBytes = (await stat(warPath)).size

      this.#phase = 'verifying'
      if (digest !== DRAWIO_WAR_SHA256) {
        throw new Error(`资源包校验失败：期望 sha256 ${DRAWIO_WAR_SHA256}，实际 ${digest}`)
      }

      this.#phase = 'extracting'
      await mkdir(extractDir, { recursive: true })
      const extracted = await extractWebapp(warPath, extractDir)

      await this.#swapIn(extractDir, nonce)

      const installedAt = new Date().toISOString()
      const marker: MarkerFile = {
        version: DRAWIO_RELEASE_TAG,
        source: DRAWIO_WAR_URL,
        sha256: DRAWIO_WAR_SHA256,
        warBytes,
        webappBytes: extracted.bytes,
        files: extracted.files,
        rootPrefix: extracted.rootPrefix,
        installedAt,
      }
      await writeFile(this.#markerPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o644 })

      this.#installedAt = installedAt
      this.#received = this.#total
      this.#phase = 'ready'
      console.log(`[dsh-drawio] webapp ${DRAWIO_RELEASE_TAG} ready at ${this.webappRoot} (${String(extracted.files)} files)`)
    } catch (error) {
      this.#phase = 'error'
      this.#message = errorMessage(error)
      console.warn(`[dsh-drawio] webapp install failed: ${this.#message}`)
      throw error
    } finally {
      await rm(warPath, { force: true }).catch(() => undefined)
      await rm(extractDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** Stream the pinned archive to disk, hashing and metering as it goes. */
  async #download(target: string): Promise<string> {
    const response = await fetch(DRAWIO_WAR_URL, { redirect: 'follow' })
    if (!response.ok) {
      throw new Error(`下载 draw.io 资源包失败：HTTP ${String(response.status)} ${response.statusText}`)
    }
    if (response.body === null) {
      throw new Error('下载 draw.io 资源包失败：响应没有正文')
    }
    const declared = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > 0) this.#total = declared

    const hash = createHash('sha256')
    const meter = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        hash.update(chunk)
        this.#received += chunk.byteLength
        callback(null, chunk)
      },
    })
    const body = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0])
    await pipeline(body, meter, createWriteStream(target))
    return hash.digest('hex')
  }

  /** Atomically replace `webapp/` with the freshly extracted tree. */
  async #swapIn(extractDir: string, nonce: string): Promise<void> {
    const target = this.webappRoot
    const previous = `${target}.old-${nonce}`
    let displaced = false
    try {
      await rename(target, previous)
      displaced = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try {
      await rename(extractDir, target)
    } catch (error) {
      // Best-effort rollback so a failed swap does not destroy a working install.
      if (displaced) await rename(previous, target).catch(() => undefined)
      throw error
    }
    if (displaced) await rm(previous, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Unpack the editor out of `draw.war`.
 *
 * The archive layout is discovered rather than assumed: `.war` files in the
 * wild put the webapp either at the zip root (what jgraph ships today) or under
 * a `webapp/` directory, so the resource root is derived from the shallowest
 * `index.html` entry and every entry is rebased onto it.
 */
export async function extractWebapp(
  warPath: string,
  targetDir: string,
): Promise<{ files: number, bytes: number, rootPrefix: string }> {
  const zip = new AdmZip(warPath)
  const entries = zip.getEntries()

  let rootPrefix: string | undefined
  let bestDepth = Number.POSITIVE_INFINITY
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.entryName
    if (!/(^|[/\\])index\.html$/iu.test(name)) continue
    const depth = name.split('/').length
    if (depth < bestDepth) {
      bestDepth = depth
      rootPrefix = name.slice(0, name.length - 'index.html'.length)
    }
  }
  if (rootPrefix === undefined) {
    throw new Error('draw.war 内找不到 index.html，无法确定编辑器资源根目录')
  }

  let files = 0
  let bytes = 0
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.entryName
    if (!name.startsWith(rootPrefix)) continue
    const relative = name.slice(rootPrefix.length)
    if (relative === '') continue

    const segments = relative.split('/')
    // Zip-slip guard: entries must be plain relative segments.
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) continue
    const top = segments[0]
    if (top !== undefined && SKIPPED_TOP_LEVEL.has(top.toLowerCase())) continue

    const data = entry.getData()
    const target = join(targetDir, ...segments)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
    files += 1
    bytes += data.byteLength
  }

  return { files, bytes, rootPrefix }
}
