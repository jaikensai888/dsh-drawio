import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { DrawioError } from './net/http.js'

/**
 * `.drawio` (mxfile) storage styles.
 *
 * A `<diagram>` holds either a literal `<mxGraphModel>` child, or — the
 * compressed variant — a base64 blob that decodes to one:
 *
 *   write:  UTF-8 bytes of `encodeURIComponent(xml)` → raw deflate → base64
 *   read:   base64 → raw inflate → UTF-8 string → `decodeURIComponent`
 *
 * This is drawio's own codec (`Graph.compress` / `Graph.decompress` in
 * `js/grapheditor/Graph.js`, called with no `deflate` flag → `pako.deflateRaw`
 * / `pako.inflateRaw`). Note it is **raw** deflate (windowBits −15), not zlib —
 * the zlib variant exists in drawio only for the `deflate: true` call sites,
 * which are not the file format.
 *
 * Preserving the style on write matters: rewriting a compressed file as plain
 * XML turns every save into a whole-file git diff.
 */

export interface DiagramPart {
  /** Raw `<diagram …>` start tag, attributes included. */
  startTag: string
  /** Inner content exactly as written (compressed base64 text, or child markup). */
  content: string
  /** Self-closing `<diagram … />` with no content. */
  selfClosing: boolean
  /** Whether {@link content} is deflate+base64 encoded. */
  compressed: boolean
}

export interface MxfileShape {
  /** Everything before the first `<diagram …>`. */
  header: string
  diagrams: DiagramPart[]
  /** Everything after the last `</diagram>` (or the last self-closing tag). */
  footer: string
}

const COMPRESSED_ATTR = /\s+compressed\s*=\s*(?:"true"|'true')/iu

/**
 * Index just past the `>` closing a tag that starts at `start`, honouring
 * quoted attribute values (an attribute may legally contain `>`).
 */
function findTagEnd(xml: string, start: number): number {
  let quote: string | undefined
  for (let i = start; i < xml.length; i += 1) {
    const ch = xml[i]
    if (quote !== undefined) {
      if (ch === quote) quote = undefined
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return i + 1
    }
  }
  return -1
}

/**
 * Whether a `<diagram>` stores compressed content — two independent signals,
 * structure first, exactly as drawio and the mxfile spec describe it:
 * an explicit `compressed="true"`, or non-empty text content with no element
 * child (a plain diagram always carries a `<mxGraphModel>` child).
 */
export function diagramIsCompressed(startTag: string, content: string): boolean {
  if (COMPRESSED_ATTR.test(startTag)) return true
  const trimmed = content.trim()
  if (trimmed === '') return false
  return !trimmed.startsWith('<')
}

/** Split an mxfile document into its header, diagram parts and footer. */
export function parseMxfile(xml: string): MxfileShape {
  const diagrams: DiagramPart[] = []
  let header = xml
  let footer = ''
  let cursor = 0
  let sawDiagram = false

  for (;;) {
    const open = xml.indexOf('<diagram', cursor)
    if (open === -1) break
    const after = xml[open + '<diagram'.length]
    if (after !== undefined && !/[\s/>]/u.test(after)) {
      cursor = open + '<diagram'.length
      continue
    }
    const tagEnd = findTagEnd(xml, open)
    if (tagEnd === -1) break
    const startTag = xml.slice(open, tagEnd)

    if (!sawDiagram) {
      header = xml.slice(0, open)
      sawDiagram = true
    }

    if (startTag.endsWith('/>')) {
      diagrams.push({ startTag, content: '', selfClosing: true, compressed: false })
      cursor = tagEnd
      footer = xml.slice(tagEnd)
      continue
    }

    const close = xml.indexOf('</diagram>', tagEnd)
    if (close === -1) break
    const content = xml.slice(tagEnd, close)
    diagrams.push({
      startTag,
      content,
      selfClosing: false,
      compressed: diagramIsCompressed(startTag, content),
    })
    cursor = close + '</diagram>'.length
    footer = xml.slice(cursor)
  }

  return { header, diagrams, footer }
}

/** Rebuild a document from its parts. */
export function serializeMxfile(shape: MxfileShape): string {
  let out = shape.header
  for (const part of shape.diagrams) {
    out += part.selfClosing ? part.startTag : `${part.startTag}${part.content}</diagram>`
  }
  return out + shape.footer
}

/** Drawio's decode step: base64 → raw inflate → `decodeURIComponent`. */
export function decompressDiagram(data: string): string {
  const compact = data.replace(/\s+/gu, '')
  let inflated: Buffer
  try {
    inflated = inflateRawSync(Buffer.from(compact, 'base64'))
  } catch (error) {
    throw new DrawioError('bad-request', `图纸内容解压失败（raw inflate）：${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    return decodeURIComponent(inflated.toString('utf8'))
  } catch {
    throw new DrawioError('bad-request', '图纸内容解码失败（decodeURIComponent）')
  }
}

/** Drawio's encode step: `encodeURIComponent` → raw deflate → base64. */
export function compressDiagram(xml: string): string {
  return deflateRawSync(Buffer.from(encodeURIComponent(xml), 'utf8')).toString('base64')
}

/** Whether any diagram in this document uses the compressed storage style. */
export function isCompressedMxfile(xml: string): boolean {
  return parseMxfile(xml).diagrams.some(part => part.compressed)
}

/**
 * Return an equivalent document whose diagrams are all literal
 * `<mxGraphModel>` children — what the editor needs to load.
 *
 * A document that is already plain comes back byte-identical.
 */
export function decodeMxfile(xml: string): string {
  const shape = parseMxfile(xml)
  if (!shape.diagrams.some(part => part.compressed)) return xml

  return serializeMxfile({
    ...shape,
    diagrams: shape.diagrams.map((part) => {
      if (!part.compressed) return part
      return {
        startTag: part.startTag.replace(COMPRESSED_ATTR, ''),
        content: decompressDiagram(part.content),
        selfClosing: false,
        compressed: false,
      }
    }),
  })
}

export interface MxfileStyle {
  /** Whether diagrams are stored deflate+base64 encoded. */
  compressed: boolean
  /** Whether the compressed flag is written as an explicit `compressed="true"` attribute. */
  explicitAttribute: boolean
}

/** Storage style of the bytes we read from disk. */
export function mxfileStyle(xml: string): MxfileStyle {
  const shape = parseMxfile(xml)
  const compressed = shape.diagrams.some(part => part.compressed)
  return {
    compressed,
    explicitAttribute: compressed && shape.diagrams.some(part => COMPRESSED_ATTR.test(part.startTag)),
  }
}

/**
 * Re-shape the editor's plain output to match how the file was stored.
 *
 * Idempotent: a diagram that already arrived compressed is passed through
 * untouched, so this can never double-encode. In practice the editor is asked
 * to emit compressed content itself (`compressXml` mirrors the file's style),
 * which keeps each page's payload byte-stable across saves and leaves us
 * writing drawio's own bytes; this function is the safety net for the case
 * where it did not, or where the file was plain and stays plain.
 */
export function reshapeToStyle(style: MxfileStyle, xml: string): string {
  if (!style.compressed) return xml
  const shape = parseMxfile(xml)
  if (shape.diagrams.length === 0) return xml

  return serializeMxfile({
    ...shape,
    diagrams: shape.diagrams.map((part) => {
      if (part.selfClosing || part.content.trim() === '') return part
      if (part.compressed) return part
      const startTag = part.startTag.replace(COMPRESSED_ATTR, '')
      const stamped = style.explicitAttribute ? startTag.replace(/(\s*\/?>)$/u, ' compressed="true"$1') : startTag
      return {
        startTag: stamped,
        content: compressDiagram(part.content),
        selfClosing: false,
        compressed: true,
      }
    }),
  })
}
