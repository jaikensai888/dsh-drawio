import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import { extractWebapp, resolveDshHome } from '../src/webapp-install.js'

const scratch: string[] = []

async function makeScratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-drawio-test-'))
  scratch.push(dir)
  return dir
}

afterEach(async () => {
  while (scratch.length > 0) {
    const dir = scratch.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

/** Build a `.war`-shaped archive with the given entry layout. */
function makeWar(dir: string, entries: Record<string, string>): string {
  const zip = new AdmZip()
  for (const [name, body] of Object.entries(entries)) zip.addFile(name, Buffer.from(body))
  const warPath = join(dir, 'draw.war')
  zip.writeZip(warPath)
  return warPath
}

const INDEX = '<html><body>editor</body></html>'

describe('extractWebapp', () => {
  it('handles the root layout jgraph ships today', async () => {
    const dir = await makeScratch()
    const war = makeWar(dir, {
      'index.html': INDEX,
      'js/main.js': 'main',
      'js/diagramly/App.js': 'app',
      'styles/grapheditor.css': 'css',
      'WEB-INF/web.xml': 'java',
      'WEB-INF/lib/foo.jar': 'jar',
      'META-INF/MANIFEST.MF': 'mf',
    })
    const out = join(dir, 'out')
    const result = await extractWebapp(war, out)

    expect(result.rootPrefix).toBe('')
    expect(result.files).toBe(4)
    expect(existsSync(join(out, 'index.html'))).toBe(true)
    expect(existsSync(join(out, 'js', 'diagramly', 'App.js'))).toBe(true)
    // WEB-INF / META-INF are the Java webapp, never the editor.
    expect(existsSync(join(out, 'WEB-INF'))).toBe(false)
    expect(existsSync(join(out, 'META-INF'))).toBe(false)
  })

  it('handles a webapp/ sub-directory layout and rebases onto it', async () => {
    const dir = await makeScratch()
    const war = makeWar(dir, {
      'webapp/index.html': INDEX,
      'webapp/js/main.js': 'main',
      'webapp/img/logo.svg': '<svg/>',
      'WEB-INF/web.xml': 'java',
      'README.md': 'not the editor',
    })
    const out = join(dir, 'out')
    const result = await extractWebapp(war, out)

    expect(result.rootPrefix).toBe('webapp/')
    expect(result.files).toBe(3)
    // Rebasing means index.html lands at the extraction root in BOTH layouts.
    expect(existsSync(join(out, 'index.html'))).toBe(true)
    expect(existsSync(join(out, 'js', 'main.js'))).toBe(true)
    expect(existsSync(join(out, 'img', 'logo.svg'))).toBe(true)
    expect(existsSync(join(out, 'README.md'))).toBe(false)
    expect(existsSync(join(out, 'webapp'))).toBe(false)
  })

  it('picks the shallowest index.html when several exist', async () => {
    const dir = await makeScratch()
    const war = makeWar(dir, {
      'index.html': '<html>ROOT</html>',
      'webapp/index.html': '<html>NESTED</html>',
      'webapp/js/main.js': 'nested-main',
      'js/main.js': 'root-main',
    })
    const out = join(dir, 'out')
    const result = await extractWebapp(war, out)

    expect(result.rootPrefix).toBe('')
    // The ROOT document must win; the nested one is just another file below it.
    expect(await readFile(join(out, 'index.html'), 'utf8')).toBe('<html>ROOT</html>')
    expect(await readFile(join(out, 'js', 'main.js'), 'utf8')).toBe('root-main')
  })

  it('preserves file bytes', async () => {
    const dir = await makeScratch()
    const war = makeWar(dir, { 'index.html': INDEX, 'js/main.js': 'console.log(1)' })
    const out = join(dir, 'out')
    await extractWebapp(war, out)
    expect(await readFile(join(out, 'js', 'main.js'), 'utf8')).toBe('console.log(1)')
    expect((await stat(join(out, 'index.html'))).isFile()).toBe(true)
  })

  it('fails loudly when the archive has no index.html', async () => {
    const dir = await makeScratch()
    const war = makeWar(dir, { 'js/main.js': 'main' })
    await expect(extractWebapp(war, join(dir, 'out'))).rejects.toThrow(/找不到 index\.html/u)
  })
})

describe('resolveDshHome', () => {
  it('prefers DSH_HOME and falls back to ~/.dsh', () => {
    expect(resolveDshHome({ DSH_HOME: 'D:\\harness-home' })).toBe('D:\\harness-home')
    expect(resolveDshHome({ DSH_HOME: '   ' })).toMatch(/\.dsh$/u)
    expect(resolveDshHome({})).toMatch(/\.dsh$/u)
  })
})
