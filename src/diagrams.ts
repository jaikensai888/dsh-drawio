import { readFile, readdir, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { extname, join } from 'node:path'
import { decodeMxfile, mxfileStyle, reshapeToStyle, type MxfileStyle } from './drawio-xml.js'
import { writeFileAtomic } from './net/atomic-write.js'
import { relativeToBase, resolveRequestPath, resolveWithinBase, type FenceOptions } from './net/fs-fence.js'
import { DrawioError } from './net/http.js'

/** Sub-directory new diagrams land in, relative to the workspace. */
export const DEFAULT_DIAGRAMS_DIR = 'docs/diagrams'

/** Extensions this plugin claims (lowercase, no dot). */
export const DIAGRAM_EXTENSIONS: readonly string[] = ['drawio', 'dio']

/** Permissions for a diagram we write: owner read/write, group and other read. */
const FILE_MODE = 0o644

/** Refuse absurd inputs rather than trying to hold them in memory. */
const MAX_DIAGRAM_BYTES = 64 * 1024 * 1024

/** What a brand-new diagram contains. */
export const BLANK_MXFILE = [
  '<mxfile host="dsh-drawio" agent="dsh-drawio" type="device">',
  '  <diagram id="dsh-drawio-blank" name="Page-1">',
  '    <mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">',
  '      <root>',
  '        <mxCell id="0" />',
  '        <mxCell id="1" parent="0" />',
  '      </root>',
  '    </mxGraphModel>',
  '  </diagram>',
  '</mxfile>',
  '',
].join('\n')

export interface DiagramReadResult {
  path: string
  relativePath: string
  /** Uncompressed mxfile XML, ready for the editor's `load` action. */
  xml: string
  /** Storage style of the bytes on disk; echoed back on write. */
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

async function statOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw new DrawioError('fs-error', `无法访问 ${path}：${(error as Error).message}`, 500)
  }
}

function isDiagramFileName(name: string): boolean {
  return DIAGRAM_EXTENSIONS.includes(extname(name).slice(1).toLowerCase())
}

/** The slice of deployment configuration every entry point needs. */
export interface WorkspaceOptions {
  /** Authoritative workspace root from the session header. */
  cwd: string
  /** Directory for new diagrams, relative to `cwd`. Defaults to `docs/diagrams`. */
  diagramsDir?: string | undefined
  /** Deployment opt-in that drops the containment requirement. Off by default. */
  allowOutsideWorkspace?: boolean | undefined
}

function fenceOf(options: WorkspaceOptions): FenceOptions {
  return { allowOutside: options.allowOutsideWorkspace === true }
}

function diagramsDirOf(options: WorkspaceOptions): string {
  return options.diagramsDir === undefined || options.diagramsDir === ''
    ? DEFAULT_DIAGRAMS_DIR
    : options.diagramsDir
}

/** Read a `.drawio` inside the workspace, decoding compressed storage. */
export async function readDiagram(options: WorkspaceOptions & { path: string }): Promise<DiagramReadResult> {
  const target = resolveRequestPath(options.cwd, options.path, 'path', fenceOf(options))
  const relativePath = relativeToBase(options.cwd, target)

  const info = await statOrUndefined(target)
  if (info === undefined || !info.isFile()) {
    throw new DrawioError('not-found', `图纸不存在：${relativePath}`, 404)
  }
  if (info.size > MAX_DIAGRAM_BYTES) {
    throw new DrawioError('bad-request', `图纸文件过大（${String(info.size)} 字节）`)
  }

  let raw: string
  try {
    raw = await readFile(target, 'utf8')
  } catch (error) {
    throw new DrawioError('fs-error', `读取失败：${(error as Error).message}`, 500)
  }
  // A BOM would survive into the XML and confuse drawio's parser.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)

  if (raw.trim() === '') {
    // A zero-byte file is a legitimate "touch then open" starting point.
    return { path: target, relativePath, xml: BLANK_MXFILE, compressed: false, mtimeMs: info.mtimeMs, size: info.size }
  }
  if (!raw.includes('<mxfile') && !raw.includes('<mxGraphModel')) {
    throw new DrawioError('bad-request', `${relativePath} 不是有效的 .drawio 文件（缺少 mxfile/mxGraphModel）`)
  }

  const style = mxfileStyle(raw)
  return {
    path: target,
    relativePath,
    xml: decodeMxfile(raw),
    compressed: style.compressed,
    mtimeMs: info.mtimeMs,
    size: info.size,
  }
}

export interface WriteDiagramOptions extends WorkspaceOptions {
  path: string
  /** Plain mxfile XML from the editor. */
  xml: string
  /** mtime the editor last saw. Omit to overwrite unconditionally. */
  ifMtimeMs?: number | undefined
}

/**
 * Write a diagram atomically, refusing to clobber an external edit.
 *
 * The mtime check is the whole point: drawio autosaves on a debounce, so
 * without it a stale editor buffer would silently destroy a change made by
 * another tool. A mismatch is a 409 the viewer resolves interactively.
 *
 * The storage style is re-derived from the bytes currently on disk rather than
 * carried by the client: the client cannot get it stale, and a file another
 * tool re-compressed is followed rather than fought.
 */
export async function writeDiagram(options: WriteDiagramOptions): Promise<DiagramWriteResult> {
  if (typeof options.xml !== 'string' || options.xml.trim() === '') {
    throw new DrawioError('bad-request', 'xml 必须是非空字符串')
  }
  if (Buffer.byteLength(options.xml, 'utf8') > MAX_DIAGRAM_BYTES) {
    throw new DrawioError('bad-request', '图纸内容过大')
  }

  const target = resolveRequestPath(options.cwd, options.path, 'path', fenceOf(options))
  const relativePath = relativeToBase(options.cwd, target)
  const existing = await statOrUndefined(target)

  let style: MxfileStyle = { compressed: false, explicitAttribute: false }
  if (existing === undefined) {
    if (options.ifMtimeMs !== undefined) {
      throw new DrawioError('conflict', `文件已被外部删除：${relativePath}`, 409, {
        reason: 'deleted',
        currentMtimeMs: null,
      })
    }
  } else {
    if (!existing.isFile()) {
      throw new DrawioError('bad-request', `目标不是普通文件：${relativePath}`)
    }
    if (options.ifMtimeMs !== undefined && Math.round(existing.mtimeMs) !== Math.round(options.ifMtimeMs)) {
      throw new DrawioError(
        'conflict',
        `文件已被外部修改，未覆盖：${relativePath}`,
        409,
        { reason: 'modified', currentMtimeMs: Math.round(existing.mtimeMs), currentSize: existing.size },
      )
    }
    let onDisk: string | undefined
    try {
      onDisk = await readFile(target, 'utf8')
      style = mxfileStyle(onDisk)
    } catch {
      // Unreadable but stat-able: fall through and write plain XML.
      style = { compressed: false, explicitAttribute: false }
    }

    // Writing a document identical to the one already stored is a pure no-op.
    // This is what preserves a compressed file byte-for-byte when the user
    // opened it and changed nothing — Node's zlib and drawio's pako do not
    // produce identical deflate streams, so re-encoding would otherwise
    // rewrite the whole payload for no reason.
    if (onDisk !== undefined && decodeMxfile(onDisk).trim() === options.xml.trim()) {
      return {
        path: target,
        relativePath,
        mtimeMs: existing.mtimeMs,
        size: existing.size,
        compressed: style.compressed,
      }
    }
  }

  const content = reshapeToStyle(style, options.xml)
  try {
    await writeFileAtomic(target, content, { mode: FILE_MODE })
  } catch (error) {
    throw new DrawioError('fs-error', `写入失败：${(error as Error).message}`, 500)
  }

  const info = await stat(target)
  return {
    path: target,
    relativePath,
    mtimeMs: info.mtimeMs,
    size: info.size,
    compressed: style.compressed,
  }
}

export interface CreateDiagramOptions extends WorkspaceOptions {
  /** Directory relative to the workspace; defaults to the configured diagrams directory. */
  directory?: string | undefined
  /** Base file name without extension; defaults to `untitled`. */
  name?: string | undefined
  /**
   * Create exactly at this path (absolute or workspace-relative) instead of
   * picking the next free `untitled-N`. Backs the "this file does not exist —
   * create it?" prompt, where the user already chose the name by typing it.
   */
  path?: string | undefined
}

/** Reject anything that could steer the new file out of its directory. */
function safeBaseName(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || /[\\/:*?"<>|]/u.test(trimmed) || trimmed.startsWith('.')) {
    throw new DrawioError('bad-request', `非法的文件名：${value}`)
  }
  return trimmed
}

async function writeBlank(cwd: string, target: string): Promise<DiagramReadResult> {
  try {
    await writeFileAtomic(target, BLANK_MXFILE, { mode: FILE_MODE })
  } catch (error) {
    throw new DrawioError('fs-error', `创建图纸失败：${(error as Error).message}`, 500)
  }
  const info = await stat(target)
  return {
    path: target,
    relativePath: relativeToBase(cwd, target),
    xml: BLANK_MXFILE,
    compressed: false,
    mtimeMs: info.mtimeMs,
    size: info.size,
  }
}

/**
 * Create a blank diagram — either at a caller-chosen path, or as the next free
 * `<name>-N.drawio` in the workspace diagrams directory.
 */
export async function createDiagram(options: CreateDiagramOptions): Promise<DiagramReadResult> {
  if (options.path !== undefined && options.path.trim() !== '') {
    const target = resolveRequestPath(options.cwd, options.path, 'path', fenceOf(options))
    const existing = await statOrUndefined(target)
    if (existing !== undefined) {
      throw new DrawioError('conflict', `文件已存在，未覆盖：${relativeToBase(options.cwd, target)}`, 409, {
        reason: 'exists',
        currentMtimeMs: Math.round(existing.mtimeMs),
      })
    }
    const created = await writeBlank(options.cwd, target)
    return created
  }

  const directory = options.directory ?? diagramsDirOf(options)
  const dir = resolveWithinBase(options.cwd, join(options.cwd, directory), 'directory', fenceOf(options))
  const base = safeBaseName(options.name ?? 'untitled')

  const existingNames = new Set<string>()
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isFile()) existingNames.add(entry.name.toLowerCase())
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw new DrawioError('fs-error', `无法读取目录 ${directory}：${(error as Error).message}`, 500)
  }

  let target: string | undefined
  for (let index = 1; index <= 9999; index += 1) {
    const candidate = join(dir, `${base}-${String(index)}.drawio`)
    if (!existingNames.has(`${base}-${String(index)}.drawio`.toLowerCase())) {
      target = candidate
      break
    }
  }
  if (target === undefined) {
    throw new DrawioError('fs-error', `目录 ${directory} 下 ${base}-N.drawio 已用尽`, 500)
  }

  const created = await writeBlank(options.cwd, target)
  return created
}

/** List the diagrams in the workspace diagrams directory, name-sorted. */
export async function listDiagrams(
  options: WorkspaceOptions & { directory?: string | undefined },
): Promise<DiagramEntry[]> {
  const directory = options.directory ?? diagramsDirOf(options)
  const dir = resolveWithinBase(options.cwd, join(options.cwd, directory), 'directory', fenceOf(options))

  let dirents
  try {
    dirents = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw new DrawioError('fs-error', `无法读取目录 ${directory}：${(error as Error).message}`, 500)
  }

  const entries: DiagramEntry[] = []
  for (const dirent of dirents) {
    if (!dirent.isFile() || !isDiagramFileName(dirent.name)) continue
    const full = join(dir, dirent.name)
    const info = await statOrUndefined(full)
    if (info === undefined) continue
    entries.push({
      name: dirent.name,
      path: full,
      relativePath: relativeToBase(options.cwd, full),
      mtimeMs: info.mtimeMs,
      size: info.size,
    })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return entries
}

/** Whether a path exists inside the workspace (used by the "create it?" prompt). */
export async function diagramExists(
  options: WorkspaceOptions & { path: string },
): Promise<DiagramExistsResult> {
  const target = resolveRequestPath(options.cwd, options.path, 'path', fenceOf(options))
  const info = await statOrUndefined(target)
  if (info === undefined) return { exists: false, isFile: false }
  return { exists: true, isFile: info.isFile(), mtimeMs: info.mtimeMs, size: info.size }
}
