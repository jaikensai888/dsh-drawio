/**
 * MIME table for the self-hosted drawio webapp.
 *
 * Deliberately not reused from `dsh-host-frontend-static`: that table covers
 * only 8 extensions and is missing `.png`, `.woff2`, `.wasm`, `.ttf` and
 * `.cur`, all of which the drawio webapp serves. Unknown extensions fall back
 * to `application/octet-stream` (never sniff, never guess).
 */

const MIME_TYPES: Readonly<Record<string, string>> = {
  // documents
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  pdf: 'application/pdf',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  // scripts + styles
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  wasm: 'application/wasm',
  // images
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  // fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  // media
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  // misc
  gz: 'application/gzip',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  properties: 'text/plain; charset=utf-8',
}

const FALLBACK = 'application/octet-stream'

/** Content type for a filesystem path, by extension (case-insensitive). */
export function mimeTypeForPath(path: string): string {
  const dot = path.lastIndexOf('.')
  // A dot in a directory segment must not be treated as an extension.
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (dot === -1 || dot < slash) return FALLBACK
  const ext = path.slice(dot + 1).toLowerCase()
  return MIME_TYPES[ext] ?? FALLBACK
}

/** Whether a content type is a document this plugin attaches its CSP to. */
export function isDocumentType(mimeType: string): boolean {
  return mimeType.startsWith('text/html')
}
