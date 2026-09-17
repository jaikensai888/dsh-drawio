import type { ServerResponse } from 'node:http';
/** Error codes carried in the `{ ok:false, error:{ code } }` envelope. */
export type DrawioErrorCode = 'bad-request' | 'forbidden' | 'not-found' | 'method-not-allowed' | 'conflict' | 'fs-error' | 'not-ready' | 'unavailable' | 'internal';
/**
 * An error we deliberately translate into an HTTP status plus envelope.
 * Anything else that escapes a handler becomes a 500 `internal`.
 */
export declare class DrawioError extends Error {
    readonly code: DrawioErrorCode;
    readonly status: number;
    constructor(code: DrawioErrorCode, message: string, status?: number);
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
    };
};
/** Write a JSON response. A response whose headers already went out is destroyed. */
export declare function writeJson(response: ServerResponse, status: number, body: unknown): void;
/** Write a success envelope. */
export declare function writeOk<T>(response: ServerResponse, value: T, status?: number): void;
/** Write a failure envelope, deriving status/code from the thrown value. */
export declare function writeError(response: ServerResponse, error: unknown): void;
/** Normalise any thrown value into `{ status, code, message }`. */
export declare function toDrawioHttpError(error: unknown): {
    status: number;
    code: DrawioErrorCode | 'internal';
    message: string;
};
//# sourceMappingURL=http.d.ts.map