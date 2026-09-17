import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BLANK_MXFILE, createDiagram, diagramExists, listDiagrams, readDiagram, writeDiagram } from '../src/diagrams.js'
import { parseMxfile, decompressDiagram, mxfileStyle } from '../src/drawio-xml.js'
import { writeFileAtomic } from '../src/net/atomic-write.js'
import { DrawioError } from '../src/net/http.js'

const scratch: string[] = []

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-drawio-ws-'))
  scratch.push(dir)
  return dir
}

afterEach(async () => {
  while (scratch.length > 0) {
    const dir = scratch.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

const DRAWIO_COMPRESSED =
  'jZLBboQgEIafhrtKuum5dtteNmnioWciUyFBx7Bj1T59cWVUstmkFzLz8Q/M/CBk2U7vXvXmghqcKDI9CfkqiuI5y8K6gHkFJwaNt3pF+Q4q+wsRsmywGq6JkBAd2T6FNXYd1JQw5T2OqewbXXprrxq4A1Wt3D39sppMHOsp2/kH2MbwzTnP1yoWR3A1SuN4QPIsZOkRaY3aqQS3eMe+xDpRvD0QbL156OifNcUq+FFuiBN+3nyxEw0eYqc08/geh07DUpsJ+TIaS1D1ql52x/DegRlqXcjyEMajwRNMDzvMt9HDlwFsgfwcJFzAE8z8f9Z03L3PT5GZg+/MVHzuZjs5sSME0RFOd/9ve4dPLM9/'
const MODEL =
  '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" /><mxCell id="2" value="P2 fixture" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="120" y="80" width="160" height="60" as="geometry" /></mxCell></root></mxGraphModel>'
const COMPRESSED_FILE = `<mxfile host="app.diagrams.net" agent="test" version="31.4.6">\n  <diagram id="page-1" name="Page-1">\n    ${DRAWIO_COMPRESSED}\n  </diagram>\n</mxfile>\n`
const PLAIN_FILE = `<mxfile host="dsh-drawio">\n  <diagram id="page-1" name="Page-1">\n    ${MODEL}\n  </diagram>\n</mxfile>\n`

async function seed(cwd: string, relative: string, content: string): Promise<string> {
  const target = join(cwd, relative)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, content, 'utf8')
  return target
}

describe('writeFileAtomic', () => {
  it('creates parent directories and writes the content', async () => {
    const cwd = await makeWorkspace()
    const target = join(cwd, 'a', 'b', 'c.drawio')
    await writeFileAtomic(target, 'hello', { mode: 0o644 })
    expect(await readFile(target, 'utf8')).toBe('hello')
  })

  it('replaces an existing file and leaves no temp siblings behind', async () => {
    const cwd = await makeWorkspace()
    const target = join(cwd, 'x.drawio')
    await writeFileAtomic(target, 'first', { mode: 0o644 })
    await writeFileAtomic(target, 'second', { mode: 0o644 })
    expect(await readFile(target, 'utf8')).toBe('second')
    const leftovers = (await readdir(cwd)).filter(name => name !== 'x.drawio')
    expect(leftovers).toEqual([])
  })
})

describe('readDiagram', () => {
  it('returns decoded XML plus the mtime to save against', async () => {
    const cwd = await makeWorkspace()
    await seed(cwd, 'docs/diagrams/a.drawio', COMPRESSED_FILE)
    const result = await readDiagram({ cwd, path: 'docs/diagrams/a.drawio' })

    expect(result.compressed).toBe(true)
    expect(result.xml).toContain(MODEL)
    expect(result.relativePath).toBe('docs/diagrams/a.drawio')
    expect(result.mtimeMs).toBeGreaterThan(0)
  })

  it('accepts an absolute path inside the workspace', async () => {
    const cwd = await makeWorkspace()
    const target = await seed(cwd, 'a.drawio', PLAIN_FILE)
    const result = await readDiagram({ cwd, path: target })
    expect(result.path).toBe(target)
    expect(result.compressed).toBe(false)
  })

  it('treats a zero-byte file as a blank diagram', async () => {
    const cwd = await makeWorkspace()
    await seed(cwd, 'empty.drawio', '')
    const result = await readDiagram({ cwd, path: 'empty.drawio' })
    expect(result.xml).toBe(BLANK_MXFILE)
  })

  it('404s a missing file and 403s an escape', async () => {
    const cwd = await makeWorkspace()
    await expect(readDiagram({ cwd, path: 'nope.drawio' })).rejects.toMatchObject({ status: 404 })
    await expect(readDiagram({ cwd, path: '../outside.drawio' })).rejects.toMatchObject({ status: 403 })
  })

  it('rejects content that is not a diagram', async () => {
    const cwd = await makeWorkspace()
    await seed(cwd, 'junk.drawio', 'not xml at all')
    await expect(readDiagram({ cwd, path: 'junk.drawio' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('writeDiagram', () => {
  it('writes plain XML for a plain file', async () => {
    const cwd = await makeWorkspace()
    await seed(cwd, 'a.drawio', PLAIN_FILE)
    const read = await readDiagram({ cwd, path: 'a.drawio' })
    const result = await writeDiagram({
      cwd,
      path: 'a.drawio',
      xml: read.xml.replace('P2 fixture', 'edited once'),
      ifMtimeMs: read.mtimeMs,
    })
    expect(result.compressed).toBe(false)
    expect(await readFile(join(cwd, 'a.drawio'), 'utf8')).toContain('edited once')
  })

  it('keeps a compressed file compressed', async () => {
    const cwd = await makeWorkspace()
    await seed(cwd, 'a.drawio', COMPRESSED_FILE)
    const read = await readDiagram({ cwd, path: 'a.drawio' })
    expect(read.compressed).toBe(true)

    const edited = read.xml.replace('P2 fixture', 'edited while compressed')
    const result = await writeDiagram({ cwd, path: 'a.drawio', xml: edited, ifMtimeMs: read.mtimeMs })
    expect(result.compressed).toBe(true)

    const onDisk = await readFile(join(cwd, 'a.drawio'), 'utf8')
    // The whole point: the file must not turn into plain XML on save.
    expect(onDisk).not.toContain('<mxGraphModel')
    const section = parseMxfile(onDisk).diagrams[0]?.content.trim() ?? ''
    expect(decompressDiagram(section)).toContain('edited while compressed')

    const reread = await readDiagram({ cwd, path: 'a.drawio' })
    expect(reread.xml).toContain('edited while compressed')
    expect(mxfileStyle(onDisk).compressed).toBe(true)
  })

  it('★ leaves a compressed file byte-identical when the document is unchanged', async () => {
    const cwd = await makeWorkspace()
    await seed(cwd, 'a.drawio', COMPRESSED_FILE)
    const before = await readFile(join(cwd, 'a.drawio'), 'utf8')

    const read = await readDiagram({ cwd, path: 'a.drawio' })
    const result = await writeDiagram({ cwd, path: 'a.drawio', xml: read.xml, ifMtimeMs: read.mtimeMs })

    // Node's zlib cannot reproduce pako's bytes, so a needless re-encode would
    // rewrite the whole payload; the no-op guard is what avoids that.
    expect(await readFile(join(cwd, 'a.drawio'), 'utf8')).toBe(before)
    expect(result.mtimeMs).toBe(read.mtimeMs)
  })

  it('creates a file when the caller omits ifMtimeMs', async () => {
    const cwd = await makeWorkspace()
    const result = await writeDiagram({ cwd, path: 'docs/diagrams/new.drawio', xml: BLANK_MXFILE })
    expect(existsSync(result.path)).toBe(true)
    expect(result.relativePath).toBe('docs/diagrams/new.drawio')
  })

  it('★ answers 409 instead of clobbering an external edit', async () => {
    const cwd = await makeWorkspace()
    await seed(cwd, 'a.drawio', PLAIN_FILE)
    const read = await readDiagram({ cwd, path: 'a.drawio' })

    // Another tool writes the file while the editor holds the older mtime.
    await new Promise(resolve => setTimeout(resolve, 12))
    await writeFile(join(cwd, 'a.drawio'), PLAIN_FILE.replace('P2 fixture', 'changed by another tool'), 'utf8')

    let caught: unknown
    try {
      await writeDiagram({ cwd, path: 'a.drawio', xml: read.xml.replace('P2 fixture', 'editor version'), ifMtimeMs: read.mtimeMs })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(DrawioError)
    expect((caught as DrawioError).status).toBe(409)
    expect((caught as DrawioError).details?.['reason']).toBe('modified')
    expect(typeof (caught as DrawioError).details?.['currentMtimeMs']).toBe('number')

    // The external content must survive.
    expect(await readFile(join(cwd, 'a.drawio'), 'utf8')).toContain('changed by another tool')
  })

  it('409s when the file was deleted under the editor', async () => {
    const cwd = await makeWorkspace()
    await seed(cwd, 'a.drawio', PLAIN_FILE)
    const read = await readDiagram({ cwd, path: 'a.drawio' })
    await rm(join(cwd, 'a.drawio'))
    await expect(
      writeDiagram({ cwd, path: 'a.drawio', xml: read.xml, ifMtimeMs: read.mtimeMs }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('a forced write (no ifMtimeMs) goes through', async () => {
    const cwd = await makeWorkspace()
    await seed(cwd, 'a.drawio', PLAIN_FILE)
    await writeFile(join(cwd, 'a.drawio'), PLAIN_FILE.replace('P2 fixture', 'external'), 'utf8')
    await writeDiagram({ cwd, path: 'a.drawio', xml: PLAIN_FILE.replace('P2 fixture', 'forced') })
    expect(await readFile(join(cwd, 'a.drawio'), 'utf8')).toContain('forced')
  })

  it('fences writes outside the workspace', async () => {
    const cwd = await makeWorkspace()
    await expect(writeDiagram({ cwd, path: '../escape.drawio', xml: BLANK_MXFILE })).rejects.toMatchObject({ status: 403 })
  })

  it('rejects empty XML', async () => {
    const cwd = await makeWorkspace()
    await expect(writeDiagram({ cwd, path: 'a.drawio', xml: '   ' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('createDiagram', () => {
  it('creates docs/diagrams and picks the next free untitled-N name', async () => {
    const cwd = await makeWorkspace()
    const first = await createDiagram({ cwd })
    expect(first.relativePath).toBe('docs/diagrams/untitled-1.drawio')

    const second = await createDiagram({ cwd })
    expect(second.relativePath).toBe('docs/diagrams/untitled-2.drawio')

    expect(await readFile(first.path, 'utf8')).toBe(BLANK_MXFILE)
  })

  it('honours a custom directory and name', async () => {
    const cwd = await makeWorkspace()
    const created = await createDiagram({ cwd, directory: 'docs/other', name: 'flow' })
    expect(created.relativePath).toBe('docs/other/flow-1.drawio')
  })

  it('refuses a directory escape and a hostile file name', async () => {
    const cwd = await makeWorkspace()
    await expect(createDiagram({ cwd, directory: '../outside' })).rejects.toMatchObject({ status: 403 })
    await expect(createDiagram({ cwd, name: '../evil' })).rejects.toMatchObject({ status: 400 })
    await expect(createDiagram({ cwd, name: 'a/b' })).rejects.toMatchObject({ status: 400 })
    await expect(createDiagram({ cwd, name: '.hidden' })).rejects.toMatchObject({ status: 400 })
  })
})

describe('listDiagrams', () => {
  it('lists only diagram files, name-sorted, and tolerates a missing directory', async () => {
    const cwd = await makeWorkspace()
    expect(await listDiagrams({ cwd })).toEqual([])

    await seed(cwd, 'docs/diagrams/b.drawio', PLAIN_FILE)
    await seed(cwd, 'docs/diagrams/a.dio', PLAIN_FILE)
    await seed(cwd, 'docs/diagrams/notes.md', 'not a diagram')

    const entries = await listDiagrams({ cwd })
    expect(entries.map(entry => entry.name)).toEqual(['a.dio', 'b.drawio'])
    expect(entries[0]?.relativePath).toBe('docs/diagrams/a.dio')
  })
})

describe('diagramExists', () => {
  it('reports presence, absence, and fences escapes', async () => {
    const cwd = await makeWorkspace()
    await seed(cwd, 'a.drawio', PLAIN_FILE)
    expect(await diagramExists({ cwd, path: 'a.drawio' })).toMatchObject({ exists: true, isFile: true })
    expect(await diagramExists({ cwd, path: 'b.drawio' })).toMatchObject({ exists: false, isFile: false })
    await expect(diagramExists({ cwd, path: '../x' })).rejects.toMatchObject({ status: 403 })
  })
})
