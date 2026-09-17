import { isAbsolute, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWithin, relativeToBase, requireAbsolute, resolveRequestPath, resolveWithinBase } from '../src/net/fs-fence.js'
import { DrawioError } from '../src/net/http.js'

const POSIX_ROOT = '/srv/workspace'
const WIN_ROOT = 'C:\\Users\\dev\\project'

describe('isWithin', () => {
  it('accepts the base itself and anything below it', () => {
    expect(isWithin(POSIX_ROOT, POSIX_ROOT, 'linux')).toBe(true)
    expect(isWithin(POSIX_ROOT, `${POSIX_ROOT}/a/b.drawio`, 'linux')).toBe(true)
  })

  it('rejects siblings that merely share a name prefix', () => {
    expect(isWithin(POSIX_ROOT, '/srv/workspace-other/a.drawio', 'linux')).toBe(false)
    expect(isWithin(POSIX_ROOT, '/srv/other/a.drawio', 'linux')).toBe(false)
  })

  it('is case-insensitive on Windows and case-sensitive elsewhere', () => {
    expect(isWithin(WIN_ROOT, 'c:\\users\\DEV\\project\\a.drawio', 'win32')).toBe(true)
    expect(isWithin(POSIX_ROOT, '/SRV/workspace/a.drawio', 'linux')).toBe(false)
  })

  it('tolerates mixed separators and a trailing slash on the base', () => {
    expect(isWithin('C:\\root\\', 'C:/root/sub/x.drawio', 'win32')).toBe(true)
    expect(isWithin('C:\\root', 'C:\\root\\sub/x.drawio', 'win32')).toBe(true)
  })

  it('does not mistake a sibling for a child when the base has a trailing separator', () => {
    expect(isWithin('C:\\root\\', 'C:\\root2\\x', 'win32')).toBe(false)
  })
})

describe('requireAbsolute', () => {
  it('accepts and normalizes absolute paths', () => {
    const value = requireAbsolute(join(process.cwd(), 'a', '..', 'b.drawio'))
    expect(isAbsolute(value)).toBe(true)
    expect(value.endsWith('b.drawio')).toBe(true)
  })

  it('rejects relative forms, including a drive-relative C:foo', () => {
    expect(() => requireAbsolute('docs/a.drawio')).toThrow(DrawioError)
    expect(() => requireAbsolute('C:foo')).toThrow(DrawioError)
  })

  it('rejects empty and non-string values', () => {
    expect(() => requireAbsolute('')).toThrow(DrawioError)
    expect(() => requireAbsolute('   ')).toThrow(DrawioError)
    expect(() => requireAbsolute(42)).toThrow(DrawioError)
    expect(() => requireAbsolute(undefined)).toThrow(DrawioError)
  })
})

describe('resolveWithinBase — the path.sep regression', () => {
  const base = resolve(process.cwd())

  it('accepts every legitimate sub-path on this platform', () => {
    // ★ A guard written with a hard-coded '/' would reject all of these on
    //   Windows, because resolve() yields backslashes there.
    for (const relative of ['a.drawio', 'docs/diagrams/a.drawio', 'deep/nested/dir/x.dio']) {
      expect(() => resolveWithinBase(base, join(base, relative))).not.toThrow()
      expect(resolveWithinBase(base, join(base, relative))).toBe(join(base, relative))
    }
  })

  it('accepts the base itself', () => {
    expect(resolveWithinBase(base, base)).toBe(base)
  })

  it('rejects escapes written with forward slashes, backslashes and mixed forms', () => {
    for (const escape of ['../x.drawio', '..\\x.drawio', 'a/../../x.drawio', 'a\\..\\..\\x.drawio']) {
      expect(() => resolveWithinBase(base, join(base, escape))).toThrow(DrawioError)
    }
  })

  it('rejects a sibling directory sharing the base name prefix', () => {
    expect(() => resolveWithinBase(base, `${base}-other/x.drawio`)).toThrow(DrawioError)
  })

  it('reports 403 for an escape', () => {
    try {
      resolveWithinBase(base, join(base, '..', 'x.drawio'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(DrawioError)
      expect((error as DrawioError).status).toBe(403)
    }
  })
})

describe('resolveRequestPath', () => {
  const base = resolve(process.cwd())

  it('resolves a relative request against the workspace', () => {
    expect(resolveRequestPath(base, 'docs/diagrams/a.drawio')).toBe(join(base, 'docs', 'diagrams', 'a.drawio'))
  })

  it('passes an absolute request through', () => {
    const absolute = join(base, 'docs', 'a.drawio')
    expect(resolveRequestPath(base, absolute)).toBe(absolute)
  })

  it('refuses a relative escape', () => {
    expect(() => resolveRequestPath(base, '../../etc/passwd')).toThrow(DrawioError)
    expect(() => resolveRequestPath(base, '..\\..\\windows\\system32\\config')).toThrow(DrawioError)
  })

  it('refuses an absolute path outside the workspace', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/passwd'
    expect(() => resolveRequestPath(base, outside)).toThrow(DrawioError)
  })

  it('refuses empty input', () => {
    expect(() => resolveRequestPath(base, '')).toThrow(DrawioError)
    expect(() => resolveRequestPath(base, null)).toThrow(DrawioError)
  })
})

describe('relativeToBase', () => {
  const base = resolve(process.cwd())

  it('strips the base prefix', () => {
    expect(relativeToBase(base, join(base, 'docs', 'a.drawio'))).toBe('docs/a.drawio')
  })

  it('returns the absolute path when the target is outside', () => {
    expect(relativeToBase(base, resolve(base, '..', 'outside.drawio'))).toBe(resolve(base, '..', 'outside.drawio'))
  })
})
