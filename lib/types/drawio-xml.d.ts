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
    startTag: string;
    /** Inner content exactly as written (compressed base64 text, or child markup). */
    content: string;
    /** Self-closing `<diagram … />` with no content. */
    selfClosing: boolean;
    /** Whether {@link content} is deflate+base64 encoded. */
    compressed: boolean;
}
export interface MxfileShape {
    /** Everything before the first `<diagram …>`. */
    header: string;
    diagrams: DiagramPart[];
    /** Everything after the last `</diagram>` (or the last self-closing tag). */
    footer: string;
}
/**
 * Whether a `<diagram>` stores compressed content — two independent signals,
 * structure first, exactly as drawio and the mxfile spec describe it:
 * an explicit `compressed="true"`, or non-empty text content with no element
 * child (a plain diagram always carries a `<mxGraphModel>` child).
 */
export declare function diagramIsCompressed(startTag: string, content: string): boolean;
/** Split an mxfile document into its header, diagram parts and footer. */
export declare function parseMxfile(xml: string): MxfileShape;
/** Rebuild a document from its parts. */
export declare function serializeMxfile(shape: MxfileShape): string;
/** Drawio's decode step: base64 → raw inflate → `decodeURIComponent`. */
export declare function decompressDiagram(data: string): string;
/** Drawio's encode step: `encodeURIComponent` → raw deflate → base64. */
export declare function compressDiagram(xml: string): string;
/** Whether any diagram in this document uses the compressed storage style. */
export declare function isCompressedMxfile(xml: string): boolean;
/**
 * Return an equivalent document whose diagrams are all literal
 * `<mxGraphModel>` children — what the editor needs to load.
 *
 * A document that is already plain comes back byte-identical.
 */
export declare function decodeMxfile(xml: string): string;
export interface MxfileStyle {
    /** Whether diagrams are stored deflate+base64 encoded. */
    compressed: boolean;
    /** Whether the compressed flag is written as an explicit `compressed="true"` attribute. */
    explicitAttribute: boolean;
}
/** Storage style of the bytes we read from disk. */
export declare function mxfileStyle(xml: string): MxfileStyle;
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
export declare function reshapeToStyle(style: MxfileStyle, xml: string): string;
//# sourceMappingURL=drawio-xml.d.ts.map