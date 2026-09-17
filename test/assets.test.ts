import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { etagFor, parseRange, relativeAssetPath, resolveWithinRoot, WEBAPP_MOUNT } from '../src/assets.js'
import { DrawioError } from '../src/net/http.js'
import { isDocumentType, mimeTypeForPath } from '../src/net/mime.js'

describe('mimeTypeForPath', () => {
  it('covers the extensions the bundled DSH table is missing', () => {
    expect(mimeTypeForPath('/a/b/x.png')).toBe('image/png')
    expect(mimeTypeForPath('/a/b/x.woff2')).toBe('font/woff2')
    expect(mimeTypeForPath('/a/b/x.wasm')).toBe('application/wasm')
    expect(mimeTypeForPath('/a/b/x.ttf')).toBe('font/ttf')
    expect(mimeTypeForPath('/a/b/x.cur')).toBe('image/x-icon')
  })

  it('is case-insensitive and defaults to octet-stream', () => {
    expect(mimeTypeForPath('X.SVG')).toBe('image/svg+xml')
    expect(mimeTypeForPath('/a/b/noext')).toBe('application/octet-stream')
    expect(mimeTypeForPath('/a/unknown.zzz')).toBe('application/octet-stream')
  })

  it('does not mistake a dot in a directory name for an extension', () => {
    expect(mimeTypeForPath('/a/b.c/d')).toBe('application/octet-stream')
  })

  it('flags documents for CSP attachment', () => {
    expect(isDocumentType(mimeTypeForPath('i.html'))).toBe(true)
    expect(isDocumentType(mimeTypeForPath('j.js'))).toBe(false)
  })
})

describe('parseRange', () => {
  it('returns undefined when there is nothing to slice', () => {
    expect(parseRange(undefined, 100)).toBeUndefined()
    expect(parseRange('items=0-1', 100)).toBeUndefined()
  })

  it('parses closed, open-ended and suffix ranges', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=0-999', 100)).toEqual({ start: 0, end: 99 })
  })

  it('rejects unsatisfiable and multi-range requests', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=0-1,5-6', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=abc', 100)).toBe('unsatisfiable')
  })
})

describe('etagFor', () => {
  it('derives the tag from mtime and size without hashing content', () => {
    expect(etagFor({ mtimeMs: 0x1a0ad472b4a, size: 0xac7 })).toBe('"1a0ad472b4a-ac7"')
  })
})

describe('relativeAssetPath', () => {
  it('maps the mount root onto index.html', () => {
    expect(relativeAssetPath(WEBAPP_MOUNT)).toBe('index.html')
    expect(relativeAssetPath(`${WEBAPP_MOUNT}/`)).toBe('index.html')
  })

  it('decodes percent escapes but leaves %2f opaque to the URL layer', () => {
    expect(relativeAssetPath(`${WEBAPP_MOUNT}/js/a%20b.js`)).toBe('js/a b.js')
    expect(relativeAssetPath(`${WEBAPP_MOUNT}/js/%2e%2e/x.js`)).toBe('js/../x.js')
  })

  it('refuses paths outside the mount and undecodable escapes', () => {
    expect(() => relativeAssetPath('/sidebar/file')).toThrow(DrawioError)
    expect(() => relativeAssetPath(`${WEBAPP_MOUNT}/%E0%A4%A`)).toThrow(DrawioError)
  })

  it('refuses a NUL byte', () => {
    expect(() => relativeAssetPath(`${WEBAPP_MOUNT}/a%00b`)).toThrow(DrawioError)
  })
})

describe('resolveWithinRoot — the path.sep regression', () => {
  // ★ On Windows resolve() yields backslashes. A guard written with '/' would
  //   reject every legitimate sub-path, so these cases are the firewall
  //   against reintroducing that bug.
  it('accepts every legitimate sub-path on this platform', () => {
    const root = process.cwd()
    for (const relative of ['index.html', 'js/main.js', 'mxgraph/css/common.css', 'images/a/b/c.svg']) {
      expect(() => resolveWithinRoot(root, relative)).not.toThrow()
      const resolved = resolveWithinRoot(root, relative)
      expect(resolved).toContain(relative.split('/').join(process.platform === 'win32' ? '\\' : '/'))
    }
  })

  it('accepts the root itself', () => {
    const root = process.cwd()
    expect(resolveWithinRoot(root, '.')).toBe(resolveWithinRoot(root, ''))
  })

  it('rejects escapes with forward slashes, backslashes and mixed forms', () => {
    const root = process.cwd()
    // Forward slashes separate on every platform, so these escape everywhere.
    for (const relative of ['../x.js', 'js/../../x.js', './../x.js']) {
      expect(() => resolveWithinRoot(root, relative)).toThrow(DrawioError)
    }
    // A backslash separates only on Windows; on POSIX the same text names a
    // file *inside* the root, so containment must hold instead of throwing.
    for (const relative of ['..\\x.js', 'js\\..\\..\\x.js']) {
      if (process.platform === 'win32') {
        expect(() => resolveWithinRoot(root, relative)).toThrow(DrawioError)
      } else {
        expect(resolveWithinRoot(root, relative)).toBe(join(resolve(root), relative))
      }
    }
  })

  it('rejects a sibling directory sharing the root prefix', () => {
    const root = process.cwd()
    expect(() => resolveWithinRoot(root, '../' + 'whatever')).toThrow(DrawioError)
    expect(() => resolveWithinRoot(`${root}`, '../sibling/file')).toThrow(DrawioError)
  })
})
