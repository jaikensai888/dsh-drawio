/**
 * draw.io embed protocol over `postMessage`.
 *
 * Two directions, two different safety rules:
 *   host → iframe : always an explicit `targetOrigin` (never `*`)
 *   iframe → host : the sender must be OUR frame AND same-origin
 *
 * drawio's own sample only compares `evt.source`; we check both, and every
 * payload goes through a guarded `JSON.parse` because a malformed string from
 * the frame must not be able to throw inside a message listener.
 */
/** Editor document URL, relative to the DSH origin it is served from. */
export declare const DRAWIO_EMBED_PATH = "/drawio/webapp/index.html";
/**
 * `embed=1&proto=json` switches drawio to its postMessage transport.
 * `spin=1` is drawio's own loading spinner, `configure=1` makes it wait for our
 * configure reply before initialising, `stealth=1` + `suppressNewWindows=1`
 * keep it from sprouting chrome or popups, `lang=zh` localises the UI.
 */
export declare const DRAWIO_EMBED_QUERY: string;
/** Full editor URL for the iframe `src`. */
export declare const DRAWIO_EMBED_URL: string;
/**
 * Answer to drawio's `configure` event.
 *
 * `lockdown: true` cuts every data channel except browser ↔ user-chosen
 * storage; the CSP we serve the webapp with (`connect-src 'self'`) is the
 * actual network-level gate behind it.
 */
export declare const DRAWIO_CONFIG: Readonly<Record<string, unknown>>;
/** Minimal valid `.drawio` document, used until P2 wires real file reads. */
export declare const EMPTY_DIAGRAM_XML: string;
export interface DrawioEmbedChannelOptions {
    /** Resolved lazily so the channel can be built before the frame mounts. */
    getFrame: () => HTMLIFrameElement | null;
    /** Called for every accepted `{ event }` message from the frame. */
    onEvent: (event: string, payload: Record<string, unknown>) => void;
    /** Expected iframe origin; defaults to this window's origin. */
    targetOrigin?: string;
}
export interface DrawioEmbedChannel {
    /** Send an `{ action }` message to the frame. `false` when it is not there yet. */
    post: (action: string, payload?: Record<string, unknown>) => boolean;
    dispose: () => void;
}
export declare function createDrawioEmbedChannel(options: DrawioEmbedChannelOptions): DrawioEmbedChannel;
//# sourceMappingURL=embed-protocol.d.ts.map