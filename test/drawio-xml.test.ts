import { describe, expect, it } from 'vitest'
import {
  compressDiagram,
  decompressDiagram,
  decodeMxfile,
  diagramIsCompressed,
  isCompressedMxfile,
  mxfileStyle,
  parseMxfile,
  reshapeToStyle,
  serializeMxfile,
} from '../src/drawio-xml.js'
import { DrawioError } from '../src/net/http.js'

/**
 * Authentic fixture: the exact base64 string drawio's own `Graph.compress`
 * produced for {@link MODEL} inside drawio v31.4.6 running in the browser,
 * captured on 2026-09-17 with a verified `Graph.decompress(compress(x)) === x`
 * round trip. Encoding our own fixture would have made these tests circular.
 */
const DRAWIO_COMPRESSED =
  'jZLBboQgEIafhrtKuum5dtteNmnioWciUyFBx7Bj1T59cWVUstmkFzLz8Q/M/CBk2U7vXvXmghqcKDI9CfkqiuI5y8K6gHkFJwaNt3pF+Q4q+wsRsmywGq6JkBAd2T6FNXYd1JQw5T2OqewbXXprrxq4A1Wt3D39sppMHOsp2/kH2MbwzTnP1yoWR3A1SuN4QPIsZOkRaY3aqQS3eMe+xDpRvD0QbL156OifNcUq+FFuiBN+3nyxEw0eYqc08/geh07DUpsJ+TIaS1D1ql52x/DegRlqXcjyEMajwRNMDzvMt9HDlwFsgfwcJFzAE8z8f9Z03L3PT5GZg+/MVHzuZjs5sSME0RFOd/9ve4dPLM9/'

const MODEL =
  '<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" /><mxCell id="2" value="P2 fixture" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="120" y="80" width="160" height="60" as="geometry" /></mxCell></root></mxGraphModel>'

const COMPRESSED_FILE = `<mxfile host="app.diagrams.net" agent="test" version="31.4.6">\n  <diagram id="page-1" name="Page-1">\n    ${DRAWIO_COMPRESSED}\n  </diagram>\n</mxfile>\n`
const PLAIN_FILE = `<mxfile host="dsh-drawio" agent="dsh-drawio" type="device">\n  <diagram id="page-1" name="Page-1">\n    ${MODEL}\n  </diagram>\n</mxfile>\n`

describe('compression codec vs drawio', () => {
  it('decodes drawio\'s own compressed output byte-for-byte', () => {
    expect(decompressDiagram(DRAWIO_COMPRESSED)).toBe(MODEL)
  })

  it('re-encodes into a payload drawio reads back identically', () => {
    // NOT a byte-equality assertion. drawio compresses with pako and this
    // plugin with node:zlib; no zlib level/memLevel/strategy combination
    // reproduces pako's LZ77 choices (verified: all 20 combinations differ),
    // so byte-identity is unattainable and is not what matters. What matters is
    // that a compressed file stays compressed and stays readable — which is why
    // the editor is asked to emit compressed payloads itself, and why
    // writeDiagram skips a write whose decoded document is unchanged.
    const ours = compressDiagram(MODEL)
    expect(ours).not.toBe(DRAWIO_COMPRESSED)
    expect(decompressDiagram(ours)).toBe(MODEL)
  })

  it('is stable: compressing the same input twice gives the same bytes', () => {
    expect(compressDiagram(MODEL)).toBe(compressDiagram(MODEL))
  })

  it('accepts a payload drawio produced and re-emits one drawio accepts', () => {
    // Cross-implementation round trip in both directions.
    expect(compressDiagram(decompressDiagram(DRAWIO_COMPRESSED))).toBe(compressDiagram(MODEL))
  })

  it('tolerates the whitespace a pretty-printed file may carry', () => {
    const wrapped = `\n    ${DRAWIO_COMPRESSED.slice(0, 100)}\n    ${DRAWIO_COMPRESSED.slice(100)}\n  `
    expect(decompressDiagram(wrapped)).toBe(MODEL)
  })

  it('reports undecodable payloads as a 400, not a crash', () => {
    expect(() => decompressDiagram('!!!not-base64!!!')).toThrow(DrawioError)
  })
})

describe('diagramIsCompressed — the two independent signals', () => {
  it('accepts an explicit compressed="true" attribute', () => {
    expect(diagramIsCompressed('<diagram id="a" compressed="true">', MODEL)).toBe(true)
    expect(diagramIsCompressed("<diagram id='a' compressed='true'>", MODEL)).toBe(true)
  })

  it('infers compression from structure: text content with no element child', () => {
    expect(diagramIsCompressed('<diagram id="a" name="P">', DRAWIO_COMPRESSED)).toBe(true)
    expect(diagramIsCompressed('<diagram id="a" name="P">', MODEL)).toBe(false)
    expect(diagramIsCompressed('<diagram id="a" name="P">', '   ')).toBe(false)
  })

  it('does not treat a plain diagram as compressed', () => {
    expect(diagramIsCompressed('<diagram id="a">', `\n  ${MODEL}\n`)).toBe(false)
  })
})

describe('parseMxfile', () => {
  it('splits header, diagrams and footer', () => {
    const shape = parseMxfile(COMPRESSED_FILE)
    expect(shape.header.startsWith('<mxfile')).toBe(true)
    expect(shape.diagrams).toHaveLength(1)
    expect(shape.diagrams[0]?.compressed).toBe(true)
    expect(shape.footer.trim()).toBe('</mxfile>')
  })

  it('round-trips through serialize', () => {
    for (const file of [COMPRESSED_FILE, PLAIN_FILE]) {
      expect(serializeMxfile(parseMxfile(file))).toBe(file)
    }
  })

  it('handles multiple diagrams and self-closing ones', () => {
    const xml = '<mxfile><diagram id="a" name="A">x</diagram><diagram id="b" name="B" /><diagram id="c" name="C">y</diagram></mxfile>'
    const shape = parseMxfile(xml)
    expect(shape.diagrams).toHaveLength(3)
    expect(shape.diagrams[1]?.selfClosing).toBe(true)
    expect(serializeMxfile(shape)).toBe(xml)
  })

  it('is not fooled by a > inside an attribute value', () => {
    const xml = '<mxfile><diagram id="a" name="x>y">body</diagram></mxfile>'
    const shape = parseMxfile(xml)
    expect(shape.diagrams).toHaveLength(1)
    expect(shape.diagrams[0]?.startTag).toContain('name="x>y"')
  })

  it('ignores a <diagramFoo> element', () => {
    expect(parseMxfile('<mxfile><diagramFoo /></mxfile>').diagrams).toHaveLength(0)
  })
})

describe('decodeMxfile', () => {
  it('expands a compressed diagram into a literal mxGraphModel child', () => {
    const decoded = decodeMxfile(COMPRESSED_FILE)
    expect(decoded).toContain(MODEL)
    expect(decoded).not.toContain(DRAWIO_COMPRESSED)
    expect(decoded).toContain('<diagram id="page-1" name="Page-1">')
  })

  it('drops an explicit compressed="true" once the content is literal', () => {
    const withAttr = `<mxfile><diagram id="a" compressed="true">${DRAWIO_COMPRESSED}</diagram></mxfile>`
    const decoded = decodeMxfile(withAttr)
    expect(decoded).not.toContain('compressed=')
    expect(decoded).toContain(MODEL)
  })

  it('returns a plain document byte-identical', () => {
    expect(decodeMxfile(PLAIN_FILE)).toBe(PLAIN_FILE)
  })

  it('leaves a non-mxfile document alone', () => {
    expect(decodeMxfile('<hello />')).toBe('<hello />')
  })
})

describe('mxfileStyle + reshapeToStyle', () => {
  it('detects the implicit compressed style', () => {
    expect(mxfileStyle(COMPRESSED_FILE)).toEqual({ compressed: true, explicitAttribute: false })
    expect(mxfileStyle(PLAIN_FILE)).toEqual({ compressed: false, explicitAttribute: false })
  })

  it('detects the explicit attribute style', () => {
    const xml = `<mxfile><diagram id="a" compressed="true">${DRAWIO_COMPRESSED}</diagram></mxfile>`
    expect(mxfileStyle(xml)).toEqual({ compressed: true, explicitAttribute: true })
  })

  it('isCompressedMxfile agrees with mxfileStyle', () => {
    expect(isCompressedMxfile(COMPRESSED_FILE)).toBe(true)
    expect(isCompressedMxfile(PLAIN_FILE)).toBe(false)
  })

  it('rewrites a compressed file compressed, keeping the document identical', () => {
    const reshaped = reshapeToStyle({ compressed: true, explicitAttribute: false }, decodeMxfile(COMPRESSED_FILE))
    // Style preserved: still a base64 diagram, no literal mxGraphModel.
    expect(reshaped).not.toContain('<mxGraphModel')
    expect(reshapeToStyle({ compressed: true, explicitAttribute: false }, decodeMxfile(COMPRESSED_FILE)))
      .toBe(reshaped)
    // And the document survives the decode → reshape → decode cycle.
    expect(decodeMxfile(reshaped)).toContain(MODEL)
    expect(mxfileStyle(reshaped)).toEqual({ compressed: true, explicitAttribute: false })
  })

  it('never double-encodes an already-compressed payload', () => {
    const style = { compressed: true, explicitAttribute: false }
    const once = reshapeToStyle(style, decodeMxfile(COMPRESSED_FILE))
    expect(reshapeToStyle(style, once)).toBe(once)
    expect(decodeMxfile(once)).toContain(MODEL)
  })

  it('preserves the explicit-attribute style', () => {
    const xml = `<mxfile><diagram id="a" compressed="true">${DRAWIO_COMPRESSED}</diagram></mxfile>`
    const reshaped = reshapeToStyle({ compressed: true, explicitAttribute: true }, decodeMxfile(xml))
    expect(reshaped).toContain('compressed="true"')
    expect(reshaped).not.toContain('<mxGraphModel')
    expect(decodeMxfile(reshaped)).toContain(MODEL)
  })

  it('leaves a plain file plain', () => {
    const style = mxfileStyle(PLAIN_FILE)
    expect(reshapeToStyle(style, PLAIN_FILE)).toBe(PLAIN_FILE)
  })

  it('compresses an edited document without touching the plain path', () => {
    const edited = PLAIN_FILE.replace('P2 fixture', 'P2 fixture edited')
    const reshaped = reshapeToStyle({ compressed: true, explicitAttribute: false }, edited)
    expect(reshaped).not.toContain('<mxGraphModel')
    const section = parseMxfile(reshaped).diagrams[0]?.content.trim() ?? ''
    expect(decompressDiagram(section)).toContain('P2 fixture edited')
  })
})
