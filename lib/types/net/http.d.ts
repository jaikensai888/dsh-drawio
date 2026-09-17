import type { IncomingMessage, ServerResponse } from 'node:http';
/** Error codes carried in the `{ ok:false, error:{ code } }` envelope. */
export type DrawioErrorCode = 'bad-request' | 'forbidden' | 'not-found' | 'method-not-allowed' | 'conflict' | 'fs-error' | 'not-ready' | 'unavailable' | 'internal';
/**
 * An error we deliberately translate into an HTTP status plus envelope.
 * Anything else that escapes a handler becomes a 500 `internal`.
 *
 * `details` is an optional machine-readable side-channel for errors the client
 * must act on — a 409 carries the current on-disk mtime so the conflict UI can
 * offer "reload / overwrite" without another round trip.
 */
export declare class DrawioError extends Error {
    readonly code: DrawioErrorCode;
    readonly status: number;
    readonly details: Record<string, unknown> | undefined;
    constructor(code: DrawioErrorCode, message: string, status?: number, details?: Record<string, unknown>);
}
/** The response shape shared by every `/drawio/**` JSON route. */
export type DrawioEnvelope<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: {
        code: DrawioErrorCode | 'internal';
        message: string;
        details?: Record<string, unknown>;
    };
};
/** Write a JSON response. A response whose headers already went out is destroyed. */
export declare function writeJson(response: ServerResponse, status: number, body: unknown): void;
/** Write a success envelope. */
export declare function writeOk<T>(response: ServerResponse, value: T, status?: number): void;
/** Write a failure envelope, deriving status/code/details from the thrown value. */
export declare function writeError(response: ServerResponse, error: unknown): void;
/** Normalise any thrown value into `{ status, code, message, details }`. */
export declare function toDrawioHttpError(error: unknown): {
    status: number;
    code: DrawioErrorCode | 'internal';
    message: string;
    details?: Record<string, unknown>;
};
/**
 * Read and parse a JSON request body.
 *
 * `webServer` hands us raw `node:http` requests — there is no body helper — so
 * this owns the stream lifecycle: it destroys the socket on an oversized body
 * rather than buffering it.
 */
export declare function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>>;
//# sourceMappingURL=http.d.ts.map