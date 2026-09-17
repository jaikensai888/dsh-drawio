import { describe, expect, it } from 'vitest'
import {
  Config,
  DEFAULT_DIAGRAMS_DIR,
  clientConfigOf,
  normalizeDiagramsDir,
  resolveDrawioConfig,
} from '../src/config.js'
import { DRAWIO_RELEASE_TAG, DRAWIO_WAR_SHA256 } from '../src/webapp-install.js'

describe('resolveDrawioConfig defaults', () => {
  it('produces a complete config from nothing', () => {
    const config = resolveDrawioConfig()
    expect(config).toEqual({
      drawioVersion: DRAWIO_RELEASE_TAG,
      drawioSha256: DRAWIO_WAR_SHA256,
      editorUrl: '',
      diagramsDir: DEFAULT_DIAGRAMS_DIR,
      autosaveDelayMs: 1500,
      writeDebounceMs: 1500,
      uiTheme: 'kennedy',
      language: 'zh',
      allowOutsideWorkspace: false,
    })
  })

  it('survives junk of every shape', () => {
    for (const junk of [null, undefined, 42, 'nope', [], true]) {
      expect(() => resolveDrawioConfig(junk)).not.toThrow()
      expect(resolveDrawioConfig(junk).diagramsDir).toBe(DEFAULT_DIAGRAMS_DIR)
    }
  })
})

describe('resolveDrawioConfig — the schemastery non-strict defence', () => {
  it('the raw schema really does merge unknown keys through', () => {
    // ★ GROUND-TRUTH pitfall #9: this is the behaviour we are defending against.
    const resolved = Config({ diagramsDir: 'a/b', totallyUnknown: 'leaked' }) as Record<string, unknown>
    expect(resolved['totallyUnknown']).toBe('leaked')
  })

  it('and the resolver drops them', () => {
    const resolved = resolveDrawioConfig({ diagramsDir: 'a/b', totallyUnknown: 'leaked' })
    expect(resolved).not.toHaveProperty('totallyUnknown')
    expect(Object.keys(resolved).sort()).toEqual([
      'allowOutsideWorkspace',
      'autosaveDelayMs',
      'diagramsDir',
      'drawioSha256',
      'drawioVersion',
      'editorUrl',
      'language',
      'uiTheme',
      'writeDebounceMs',
    ])
  })
})

describe('normalizeDiagramsDir', () => {
  it('keeps a plain relative path', () => {
    expect(normalizeDiagramsDir('docs/diagrams')).toBe('docs/diagrams')
    expect(normalizeDiagramsDir('  docs/figures  ')).toBe('docs/figures')
    expect(normalizeDiagramsDir('./docs/diagrams')).toBe('docs/diagrams')
  })

  it('★ refuses anything that would escape the workspace', () => {
    for (const hostile of ['../outside', 'docs/../../outside', '..', '/etc', 'C:\\Windows', 'C:relative', '..\\outside']) {
      expect(normalizeDiagramsDir(hostile)).toBe(DEFAULT_DIAGRAMS_DIR)
    }
  })

  it('tidies redundant separators without leaving the workspace', () => {
    expect(normalizeDiagramsDir('docs//x')).toBe('docs/x')
    expect(normalizeDiagramsDir('docs\\diagrams')).toBe('docs/diagrams')
    expect(normalizeDiagramsDir('docs/nested/../diagrams')).toBe('docs/diagrams')
  })

  it('falls back on non-strings and empties', () => {
    for (const value of [undefined, null, 7, {}, '   ']) {
      expect(normalizeDiagramsDir(value)).toBe(DEFAULT_DIAGRAMS_DIR)
    }
  })
})

describe('resolveDrawioConfig coercion', () => {
  it('clamps the timing knobs and keeps 0 meaningful for the write debounce', () => {
    expect(resolveDrawioConfig({ autosaveDelayMs: 1 }).autosaveDelayMs).toBe(200)
    expect(resolveDrawioConfig({ autosaveDelayMs: 999_999 }).autosaveDelayMs).toBe(10_000)
    expect(resolveDrawioConfig({ writeDebounceMs: 0 }).writeDebounceMs).toBe(0)
    expect(resolveDrawioConfig({ autosaveDelayMs: 'fast' }).autosaveDelayMs).toBe(1500)
  })

  it('only accepts a known ui theme', () => {
    expect(resolveDrawioConfig({ uiTheme: 'atlas' }).uiTheme).toBe('atlas')
    expect(resolveDrawioConfig({ uiTheme: 'nonsense' }).uiTheme).toBe('kennedy')
  })

  it('only accepts a well-formed language tag', () => {
    expect(resolveDrawioConfig({ language: 'en' }).language).toBe('en')
    expect(resolveDrawioConfig({ language: 'zh-Hant' }).language).toBe('zh-Hant')
    expect(resolveDrawioConfig({ language: '<script>' }).language).toBe('zh')
  })

  it('keeps editorUrl verbatim (it is an explicit escape hatch) but never whitespace', () => {
    expect(resolveDrawioConfig({ editorUrl: '  https://embed.diagrams.net/  ' }).editorUrl)
      .toBe('https://embed.diagrams.net/')
    expect(resolveDrawioConfig({ editorUrl: '   ' }).editorUrl).toBe('')
  })

  it('passes the containment opt-in through as a real boolean', () => {
    expect(resolveDrawioConfig({ allowOutsideWorkspace: true }).allowOutsideWorkspace).toBe(true)
    expect(resolveDrawioConfig({ allowOutsideWorkspace: 'yes' }).allowOutsideWorkspace).toBe(false)
  })
})

describe('clientConfigOf', () => {
  it('exposes only what the browser needs', () => {
    const client = clientConfigOf(resolveDrawioConfig({ diagramsDir: 'figs', uiTheme: 'dark' }))
    expect(client).toEqual({
      editorUrl: '',
      diagramsDir: 'figs',
      autosaveDelayMs: 1500,
      writeDebounceMs: 1500,
      uiTheme: 'dark',
      language: 'zh',
      allowOutsideWorkspace: false,
      webappVersion: DRAWIO_RELEASE_TAG,
    })
    // The pinned archive digest stays on the host.
    expect(client).not.toHaveProperty('drawioSha256')
  })
})
