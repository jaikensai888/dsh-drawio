/**
 * MIME table for the self-hosted drawio webapp.
 *
 * Deliberately not reused from `dsh-host-frontend-static`: that table covers
 * only 8 extensions and is missing `.png`, `.woff2`, `.wasm`, `.ttf` and
 * `.cur`, all of which the drawio webapp serves. Unknown extensions fall back
 * to `application/octet-stream` (never sniff, never guess).
 */
/** Content type for a filesystem path, by extension (case-insensitive). */
export declare function mimeTypeForPath(path: string): string;
/** Whether a content type is a document this plugin attaches its CSP to. */
export declare function isDocumentType(mimeType: string): boolean;
//# sourceMappingURL=mime.d.ts.map