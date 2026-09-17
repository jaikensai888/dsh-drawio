//#region src/net/http.ts
/**
* An error we deliberately translate into an HTTP status plus envelope.
* Anything else that escapes a handler becomes a 500 `internal`.
*/
var DrawioError = class extends Error {
	code;
	status;
	constructor(code, message, status = 400) {
		super(message);
		this.name = "DrawioError";
		this.code = code;
		this.status = status;
	}
};
/** Write a JSON response. A response whose headers already went out is destroyed. */
function writeJson(response, status, body) {
	if (response.headersSent) {
		response.destroy();
		return;
	}
	const payload = Buffer.from(JSON.stringify(body), "utf8");
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": String(payload.byteLength),
		"cache-control": "no-store"
	});
	response.end(payload);
}
/** Write a success envelope. */
function writeOk(response, value, status = 200) {
	writeJson(response, status, {
		ok: true,
		value
	});
}
/** Write a failure envelope, deriving status/code from the thrown value. */
function writeError(response, error) {
	const { status, code, message } = toDrawioHttpError(error);
	writeJson(response, status, {
		ok: false,
		error: {
			code,
			message
		}
	});
}
/** Normalise any thrown value into `{ status, code, message }`. */
function toDrawioHttpError(error) {
	if (error instanceof DrawioError) return {
		status: error.status,
		code: error.code,
		message: error.message
	};
	return {
		status: 500,
		code: "internal",
		message: error instanceof Error ? error.message : String(error)
	};
}

//#endregion
//#region src/routes.ts
/**
* The one and only `webServer.register` call this plugin ever makes.
*
* `webServer.register` throws on a duplicate `(kind, path)` pair and that
* failure takes the whole plugin tree down, so every `/drawio/**` endpoint
* lives behind this single prefix route and is dispatched internally by
* sub-path. Do not add a second registration anywhere in this package.
*/
const DRAWIO_ROUTE_PREFIX = "/drawio";
/** Sub-path (relative to {@link DRAWIO_ROUTE_PREFIX}) → handler. */
const ROUTES = new Map([["/ping", handlePing]]);
/**
* P0 liveness probe. Reaching this endpoint at all proves the host half
* mounted *and* that the single prefix route registered without colliding
* with an existing `(kind, path)` — a collision aborts plugin-tree startup,
* in which case this handler would never be reachable.
*/
function handlePing(request, response) {
	if (request.method !== "GET" && request.method !== "HEAD") throw new DrawioError("method-not-allowed", "GET /drawio/ping 只接受 GET/HEAD 请求", 405);
	writeOk(response, {
		plugin: "dsh-drawio",
		phase: "P0-skeleton",
		routePrefix: DRAWIO_ROUTE_PREFIX,
		pid: process.pid,
		now: (/* @__PURE__ */ new Date()).toISOString()
	});
}
/** The `webServer.register({ kind: 'prefix', path: '/drawio' })` handler. */
function createDrawioRouteHandler() {
	return (request, response) => {
		dispatch(request, response);
	};
}
async function dispatch(request, response) {
	try {
		const pathname = resolvePathname(request.url);
		const subPath = stripPrefix(pathname);
		const handler = ROUTES.get(subPath);
		if (handler === void 0) throw new DrawioError("not-found", `未知的 dsh-drawio 路由：${pathname}`, 404);
		await handler(request, response, pathname);
	} catch (error) {
		writeError(response, error);
	}
}
/** Slice the route prefix off a pathname, returning `/` for the bare prefix. */
function stripPrefix(pathname) {
	if (!pathname.startsWith(DRAWIO_ROUTE_PREFIX)) throw new DrawioError("not-found", `dsh-drawio 只服务 ${DRAWIO_ROUTE_PREFIX} 前缀：${pathname}`, 404);
	const rest = pathname.slice(7);
	return rest === "" ? "/" : rest;
}
/** Parse a request URL down to its pathname (never throws on junk input). */
function resolvePathname(rawUrl) {
	try {
		return new URL(rawUrl ?? "/", "http://localhost").pathname;
	} catch {
		throw new DrawioError("bad-request", `无法解析请求路径：${String(rawUrl)}`);
	}
}

//#endregion
//#region src/index.ts
/** Host-half plugin name. Must equal the package name. */
const name = "dsh-drawio";
/**
* Hard dependencies. `webServer` serves the `/drawio` routes (and, from P1,
* the self-hosted drawio webapp); `sessions` is what turns a session id into
* the authoritative workspace cwd that fences every diagram read/write.
*/
const inject = ["webServer", "sessions"];
/**
* Host half: register exactly one prefix route and let `routes.ts` dispatch.
*
* There is intentionally no `Config` yet — P1/P3 add one together with the
* `resolveDrawioConfig()` second-line-of-defence resolver (schemastery is
* non-strict, so unknown yaml keys leak into the resolved config).
*/
function apply(ctx) {
	const handler = createDrawioRouteHandler();
	ctx.effect(() => {
		const disposeRoute = ctx.webServer.register({
			kind: "prefix",
			path: DRAWIO_ROUTE_PREFIX,
			handler
		});
		console.log(`[dsh-drawio] prefix route registered: ${DRAWIO_ROUTE_PREFIX}`);
		return () => {
			console.log(`[dsh-drawio] prefix route disposed: ${DRAWIO_ROUTE_PREFIX}`);
			disposeRoute();
		};
	});
}

//#endregion
export { apply, inject, name };
//# sourceMappingURL=index.js.map