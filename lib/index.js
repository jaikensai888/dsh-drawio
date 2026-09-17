import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";

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
//#region src/net/mime.ts
/**
* MIME table for the self-hosted drawio webapp.
*
* Deliberately not reused from `dsh-host-frontend-static`: that table covers
* only 8 extensions and is missing `.png`, `.woff2`, `.wasm`, `.ttf` and
* `.cur`, all of which the drawio webapp serves. Unknown extensions fall back
* to `application/octet-stream` (never sniff, never guess).
*/
const MIME_TYPES = {
	html: "text/html; charset=utf-8",
	htm: "text/html; charset=utf-8",
	xml: "application/xml; charset=utf-8",
	txt: "text/plain; charset=utf-8",
	md: "text/markdown; charset=utf-8",
	pdf: "application/pdf",
	json: "application/json; charset=utf-8",
	map: "application/json; charset=utf-8",
	webmanifest: "application/manifest+json",
	js: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	css: "text/css; charset=utf-8",
	wasm: "application/wasm",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	ico: "image/x-icon",
	cur: "image/x-icon",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	otf: "font/otf",
	eot: "application/vnd.ms-fontobject",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	mp4: "video/mp4",
	gz: "application/gzip",
	yaml: "text/yaml; charset=utf-8",
	yml: "text/yaml; charset=utf-8",
	properties: "text/plain; charset=utf-8"
};
const FALLBACK = "application/octet-stream";
/** Content type for a filesystem path, by extension (case-insensitive). */
function mimeTypeForPath(path) {
	const dot = path.lastIndexOf(".");
	const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	if (dot === -1 || dot < slash) return FALLBACK;
	return MIME_TYPES[path.slice(dot + 1).toLowerCase()] ?? FALLBACK;
}
/** Whether a content type is a document this plugin attaches its CSP to. */
function isDocumentType(mimeType) {
	return mimeType.startsWith("text/html");
}

//#endregion
//#region src/assets.ts
/** URL prefix that maps onto the extracted webapp root. */
const WEBAPP_MOUNT = "/drawio/webapp";
/**
* The one network-level boundary this plugin owns.
*
* `connect-src 'self'` is the real gate: no matter what the editor tries to
* reach, it cannot open a connection to another origin. `'unsafe-inline'` is
* required by drawio's inline styles/scripts. `frame-src 'self'` (rather than
* PLAN's `'none'`) still blocks every external frame while leaving drawio's own
* same-origin sub-frames working.
*/
const DRAWIO_CSP = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"media-src 'self' data: blob:",
	"worker-src 'self' blob:",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-src 'self'"
].join("; ");
/** Strict `bytes=` single-range parser; undefined means "send the whole file". */
function parseRange(header$1, size) {
	if (header$1 === void 0 || !header$1.startsWith("bytes=")) return void 0;
	const spec = header$1.slice(6).trim();
	if (spec.includes(",")) return "unsatisfiable";
	const dash = spec.indexOf("-");
	if (dash === -1) return "unsatisfiable";
	const rawStart = spec.slice(0, dash).trim();
	const rawEnd = spec.slice(dash + 1).trim();
	if (rawStart === "") {
		const suffix = Number(rawEnd);
		if (!Number.isInteger(suffix) || suffix <= 0) return "unsatisfiable";
		return {
			start: Math.max(0, size - suffix),
			end: size - 1
		};
	}
	const start = Number(rawStart);
	if (!Number.isInteger(start) || start < 0 || start >= size) return "unsatisfiable";
	if (rawEnd === "") return {
		start,
		end: size - 1
	};
	const end = Number(rawEnd);
	if (!Number.isInteger(end) || end < start) return "unsatisfiable";
	return {
		start,
		end: Math.min(end, size - 1)
	};
}
/** Quote an fs stat as a weak-free entity tag (never hashes file content). */
function etagFor(info) {
	return `"${Math.floor(info.mtimeMs).toString(16)}-${info.size.toString(16)}"`;
}
function headerValue(value) {
	if (Array.isArray(value)) return value[0];
	return value;
}
/**
* Turn a request pathname into a decoded, relative, slash-free-of-traversal
* path below the mount point.
*/
function relativeAssetPath(pathname, mount = WEBAPP_MOUNT) {
	if (pathname !== mount && !pathname.startsWith(`${mount}/`)) throw new DrawioError("not-found", `不是编辑器资源路径：${pathname}`, 404);
	const rest = pathname.slice(mount.length);
	if (rest === "" || rest === "/") return "index.html";
	let decoded;
	try {
		decoded = decodeURIComponent(rest);
	} catch {
		throw new DrawioError("bad-request", `资源路径无法解码：${rest}`);
	}
	if (decoded.includes("\0")) throw new DrawioError("bad-request", "资源路径包含空字节");
	return decoded.replace(/^\/+/u, "");
}
/**
* Containment check for the webapp root.
*
* ★ The separator MUST come from `path.sep`, not a hard-coded `/`: on Windows
* `resolve()` yields backslashes, so comparing against `${root}/` rejects every
* legitimate sub-path.
*/
function resolveWithinRoot(root, relative) {
	const base = resolve(root);
	const target = resolve(normalize(join(base, relative)));
	if (target !== base && !target.startsWith(base + sep)) throw new DrawioError("forbidden", `资源路径越界：${relative}`, 403);
	return target;
}
/** Stream `<webappRoot>/**` with ETag/304, Range and a document CSP. */
function createWebappAssetHandler(options) {
	const mount = options.mountPath ?? WEBAPP_MOUNT;
	return async (request, response, pathname) => {
		try {
			if (request.method !== "GET" && request.method !== "HEAD") throw new DrawioError("method-not-allowed", "编辑器静态资源只支持 GET/HEAD", 405);
			const root = await options.resolveRoot();
			if (root === void 0) throw new DrawioError("not-ready", "draw.io 编辑器资源尚未就绪", 503);
			let target = resolveWithinRoot(root, relativeAssetPath(pathname, mount));
			let info = await statFile(target);
			if (info === void 0) throw new DrawioError("not-found", `资源不存在：${pathname}`, 404);
			if (info.isDirectory()) {
				target = resolveWithinRoot(root, join(relativeAssetPath(pathname, mount), "index.html"));
				info = await statFile(target);
				if (info === void 0) throw new DrawioError("not-found", `资源不存在：${pathname}`, 404);
			}
			if (!info.isFile()) throw new DrawioError("not-found", `资源不是普通文件：${pathname}`, 404);
			const mimeType = mimeTypeForPath(target);
			const etag = etagFor(info);
			const lastModified = new Date(info.mtimeMs).toUTCString();
			const headers = {
				"content-type": mimeType,
				"cache-control": "no-cache",
				"etag": etag,
				"last-modified": lastModified,
				"accept-ranges": "bytes",
				"x-content-type-options": "nosniff"
			};
			if (isDocumentType(mimeType)) headers["content-security-policy"] = DRAWIO_CSP;
			if (headerValue(request.headers["if-none-match"]) === etag) {
				response.writeHead(304, headers);
				response.end();
				return;
			}
			const range = parseRange(headerValue(request.headers["range"]), info.size);
			if (range === "unsatisfiable") {
				response.writeHead(416, {
					...headers,
					"content-range": `bytes */${String(info.size)}`
				});
				response.end();
				return;
			}
			if (range === void 0) {
				response.writeHead(200, {
					...headers,
					"content-length": String(info.size)
				});
				if (request.method === "HEAD") {
					response.end();
					return;
				}
				streamFile(target, response);
				return;
			}
			const length = range.end - range.start + 1;
			response.writeHead(206, {
				...headers,
				"content-range": `bytes ${String(range.start)}-${String(range.end)}/${String(info.size)}`,
				"content-length": String(length)
			});
			if (request.method === "HEAD") {
				response.end();
				return;
			}
			streamFile(target, response, range);
		} catch (error) {
			writeError(response, error);
		}
	};
}
async function statFile(path) {
	try {
		return await stat(path);
	} catch (error) {
		const code = error.code;
		if (code === "ENOENT" || code === "ENOTDIR") return void 0;
		throw error;
	}
}
/**
* Pipe a file into the response and tear the stream down with the socket —
* DSH had no streaming precedent before this, and a leaked read stream on a
* 147 MB tree is how a sidebar ends up holding file handles.
*/
function streamFile(path, response, range) {
	const stream = range === void 0 ? createReadStream(path) : createReadStream(path, {
		start: range.start,
		end: range.end
	});
	response.on("close", () => {
		stream.destroy();
	});
	stream.on("error", () => {
		response.destroy();
	});
	stream.pipe(response);
}

//#endregion
//#region src/net/trust-fence.ts
function header(headers, name$1) {
	const value = headers[name$1];
	return typeof value === "string" ? value : void 0;
}
/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
/**
* Decide whether one `/drawio` request may reach the plugin routes.
* @param request - node HTTP request facts (headers).
* @param trustedHosts - non-loopback authorities this deployment serves.
* @returns true when the Host is ours (loopback or trusted) and browser markers are same-origin.
*/
function isTrustedApiRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	const origin = header(request.headers, "origin");
	if (origin === void 0) return true;
	try {
		return new URL(origin).hostname === hostUrl.hostname;
	} catch {
		return false;
	}
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
/** Build the dispatch table for the single `/drawio` prefix route. */
function createDrawioRouteHandler(deps) {
	const exact = new Map([["/ping", handlePing], ["/api/webapp-status", (request, response) => handleWebappStatus(request, response, deps.installer)]]);
	const prefixed = [["/webapp", createWebappAssetHandler({ resolveRoot: async () => {
		return (await deps.installer.status()).ready ? deps.installer.webappRoot : void 0;
	} })]];
	return (request, response) => {
		dispatch(request, response, exact, prefixed, deps);
	};
}
async function dispatch(request, response, exact, prefixed, deps) {
	try {
		if (!isTrustedApiRequest(request, deps.trustedHosts())) throw new DrawioError("forbidden", "请求未通过 dsh-drawio 信任围栏", 403);
		const pathname = resolvePathname(request.url);
		const subPath = stripPrefix(pathname);
		const exactHandler = exact.get(subPath);
		if (exactHandler !== void 0) {
			await exactHandler(request, response, pathname);
			return;
		}
		for (const [prefix, handler] of prefixed) if (subPath === prefix || subPath.startsWith(`${prefix}/`)) {
			await handler(request, response, pathname);
			return;
		}
		throw new DrawioError("not-found", `未知的 dsh-drawio 路由：${pathname}`, 404);
	} catch (error) {
		writeError(response, error);
	}
}
/**
* Liveness probe. Reaching this endpoint at all proves the host half mounted
* *and* that the single prefix route registered without colliding with an
* existing `(kind, path)` — a collision aborts plugin-tree startup, in which
* case this handler would never be reachable.
*/
function handlePing(request, response) {
	if (request.method !== "GET" && request.method !== "HEAD") throw new DrawioError("method-not-allowed", "GET /drawio/ping 只接受 GET/HEAD 请求", 405);
	writeOk(response, {
		plugin: "dsh-drawio",
		routePrefix: DRAWIO_ROUTE_PREFIX,
		pid: process.pid,
		now: (/* @__PURE__ */ new Date()).toISOString()
	});
}
/**
* Editor asset readiness. `GET` reports progress; `POST` starts (or joins) the
* one-time download. The viewer polls `GET` while `ready` is false, which is
* what keeps a first run from being a blank white rectangle.
*/
async function handleWebappStatus(request, response, installer) {
	if (request.method === "GET" || request.method === "HEAD") {
		writeOk(response, await installer.status());
		return;
	}
	if (request.method === "POST") {
		writeOk(response, await installer.ensure());
		return;
	}
	throw new DrawioError("method-not-allowed", "GET /drawio/api/webapp-status 只接受 GET/POST", 405);
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
//#region src/webapp-install.ts
/**
* Pinned drawio release. The tag AND the archive digest are frozen in code on
* purpose — never resolve `latest` at runtime, or a compromised/rewritten
* upstream release would silently become our editor.
*
* Verified 2026-09-17 against
* https://github.com/jgraph/drawio/releases/tag/v31.4.6
*/
const DRAWIO_RELEASE_TAG = "v31.4.6";
const DRAWIO_WAR_URL = `https://github.com/jgraph/drawio/releases/download/${DRAWIO_RELEASE_TAG}/draw.war`;
const DRAWIO_WAR_SHA256 = "f7798104da17d7e9494ab348c3ba9b2a65640096bd54f704d7a0fa2fab283938";
const DRAWIO_WAR_BYTES = 53762297;
/** Archive top-level directories that belong to the Java webapp, not the editor. */
const SKIPPED_TOP_LEVEL = new Set(["web-inf", "meta-inf"]);
/** `<dshHome>/storages/dsh-drawio` — the harness home, not the workspace. */
function resolveDshHome(env = process.env) {
	const fromEnv = env["DSH_HOME"];
	if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv.trim();
	return join(homedir(), ".dsh");
}
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Downloads and unpacks the drawio webapp into `<dshHome>/storages/dsh-drawio/webapp`.
*
* Only one install runs at a time; every caller observes the same progress
* snapshot, so N open viewers do not start N downloads. The unpacked tree is
* built in a `.extract-<nonce>` sibling and swapped in with a rename, so an
* interrupted install never leaves a half-populated webapp behind.
*/
var WebappInstaller = class {
	root;
	webappRoot;
	#markerPath;
	#phase = "missing";
	#received = 0;
	#total = DRAWIO_WAR_BYTES;
	#message;
	#installedAt;
	#running;
	#probed = false;
	constructor(options = {}) {
		this.root = options.root ?? join(resolveDshHome(), "storages", "dsh-drawio");
		this.webappRoot = join(this.root, "webapp");
		this.#markerPath = join(this.root, ".installed.json");
	}
	/** Current progress; probes the marker file once per process. */
	async status() {
		if (!this.#probed) await this.#probe();
		return this.#snapshot();
	}
	/**
	* Start (or join) an install when the editor is not ready yet. Returns
	* immediately with the current snapshot — callers poll {@link status}.
	*/
	async ensure() {
		const current = await this.status();
		if (current.ready || current.phase === "downloading" || current.phase === "verifying" || current.phase === "extracting") return current;
		if (this.#running === void 0) this.#running = this.#install().catch(() => {}).finally(() => {
			this.#running = void 0;
		});
		return this.#snapshot();
	}
	#snapshot() {
		return {
			phase: this.#phase,
			ready: this.#phase === "ready",
			version: DRAWIO_RELEASE_TAG,
			received: this.#received,
			total: this.#total,
			webappRoot: this.webappRoot,
			...this.#message === void 0 ? {} : { message: this.#message },
			...this.#installedAt === void 0 ? {} : { installedAt: this.#installedAt }
		};
	}
	/** Marker present, version matching, and an `index.html` actually on disk? */
	async #probe() {
		this.#probed = true;
		try {
			const marker = JSON.parse(await readFile(this.#markerPath, "utf8"));
			if (marker.version !== DRAWIO_RELEASE_TAG || marker.sha256 !== DRAWIO_WAR_SHA256) {
				this.#phase = "missing";
				return;
			}
			if (!(await stat(join(this.webappRoot, "index.html"))).isFile()) {
				this.#phase = "missing";
				return;
			}
			this.#phase = "ready";
			this.#installedAt = marker.installedAt;
			this.#total = typeof marker.warBytes === "number" && marker.warBytes > 0 ? marker.warBytes : DRAWIO_WAR_BYTES;
			this.#received = this.#total;
		} catch {
			this.#phase = "missing";
		}
	}
	async #install() {
		await mkdir(this.root, { recursive: true });
		const nonce = randomBytes(6).toString("hex");
		const warPath = join(this.root, `.download-${nonce}.war`);
		const extractDir = join(this.root, `.extract-${nonce}`);
		this.#message = void 0;
		try {
			this.#phase = "downloading";
			this.#received = 0;
			this.#total = DRAWIO_WAR_BYTES;
			const digest = await this.#download(warPath);
			const warBytes = (await stat(warPath)).size;
			this.#phase = "verifying";
			if (digest !== DRAWIO_WAR_SHA256) throw new Error(`资源包校验失败：期望 sha256 ${DRAWIO_WAR_SHA256}，实际 ${digest}`);
			this.#phase = "extracting";
			await mkdir(extractDir, { recursive: true });
			const extracted = await extractWebapp(warPath, extractDir);
			await this.#swapIn(extractDir, nonce);
			const installedAt = (/* @__PURE__ */ new Date()).toISOString();
			const marker = {
				version: DRAWIO_RELEASE_TAG,
				source: DRAWIO_WAR_URL,
				sha256: DRAWIO_WAR_SHA256,
				warBytes,
				webappBytes: extracted.bytes,
				files: extracted.files,
				rootPrefix: extracted.rootPrefix,
				installedAt
			};
			await writeFile(this.#markerPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 420 });
			this.#installedAt = installedAt;
			this.#received = this.#total;
			this.#phase = "ready";
			console.log(`[dsh-drawio] webapp ${DRAWIO_RELEASE_TAG} ready at ${this.webappRoot} (${String(extracted.files)} files)`);
		} catch (error) {
			this.#phase = "error";
			this.#message = errorMessage(error);
			console.warn(`[dsh-drawio] webapp install failed: ${this.#message}`);
			throw error;
		} finally {
			await rm(warPath, { force: true }).catch(() => void 0);
			await rm(extractDir, {
				recursive: true,
				force: true
			}).catch(() => void 0);
		}
	}
	/** Stream the pinned archive to disk, hashing and metering as it goes. */
	async #download(target) {
		const response = await fetch(DRAWIO_WAR_URL, { redirect: "follow" });
		if (!response.ok) throw new Error(`下载 draw.io 资源包失败：HTTP ${String(response.status)} ${response.statusText}`);
		if (response.body === null) throw new Error("下载 draw.io 资源包失败：响应没有正文");
		const declared = Number(response.headers.get("content-length") ?? "");
		if (Number.isFinite(declared) && declared > 0) this.#total = declared;
		const hash = createHash("sha256");
		const meter = new Transform({ transform: (chunk, _encoding, callback) => {
			hash.update(chunk);
			this.#received += chunk.byteLength;
			callback(null, chunk);
		} });
		await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(target));
		return hash.digest("hex");
	}
	/** Atomically replace `webapp/` with the freshly extracted tree. */
	async #swapIn(extractDir, nonce) {
		const target = this.webappRoot;
		const previous = `${target}.old-${nonce}`;
		let displaced = false;
		try {
			await rename(target, previous);
			displaced = true;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		try {
			await rename(extractDir, target);
		} catch (error) {
			if (displaced) await rename(previous, target).catch(() => void 0);
			throw error;
		}
		if (displaced) await rm(previous, {
			recursive: true,
			force: true
		}).catch(() => void 0);
	}
};
/**
* Unpack the editor out of `draw.war`.
*
* The archive layout is discovered rather than assumed: `.war` files in the
* wild put the webapp either at the zip root (what jgraph ships today) or under
* a `webapp/` directory, so the resource root is derived from the shallowest
* `index.html` entry and every entry is rebased onto it.
*/
async function extractWebapp(warPath, targetDir) {
	const entries = new AdmZip(warPath).getEntries();
	let rootPrefix;
	let bestDepth = Number.POSITIVE_INFINITY;
	for (const entry of entries) {
		if (entry.isDirectory) continue;
		const name$1 = entry.entryName;
		if (!/(^|[/\\])index\.html$/iu.test(name$1)) continue;
		const depth = name$1.split("/").length;
		if (depth < bestDepth) {
			bestDepth = depth;
			rootPrefix = name$1.slice(0, name$1.length - 10);
		}
	}
	if (rootPrefix === void 0) throw new Error("draw.war 内找不到 index.html，无法确定编辑器资源根目录");
	let files = 0;
	let bytes = 0;
	for (const entry of entries) {
		if (entry.isDirectory) continue;
		const name$1 = entry.entryName;
		if (!name$1.startsWith(rootPrefix)) continue;
		const relative = name$1.slice(rootPrefix.length);
		if (relative === "") continue;
		const segments = relative.split("/");
		if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) continue;
		const top = segments[0];
		if (top !== void 0 && SKIPPED_TOP_LEVEL.has(top.toLowerCase())) continue;
		const data = entry.getData();
		const target = join(targetDir, ...segments);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, data);
		files += 1;
		bytes += data.byteLength;
	}
	return {
		files,
		bytes,
		rootPrefix
	};
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
* The self-hosted drawio webapp is fetched lazily — nothing touches the
* network until a viewer asks for it, and `/drawio/ping` stays a pure
* no-side-effect probe.
*
* There is intentionally no `Config` yet — P3 adds one together with the
* `resolveDrawioConfig()` second-line-of-defence resolver (schemastery is
* non-strict, so unknown yaml keys leak into the resolved config).
*/
function apply(ctx) {
	const installer = new WebappInstaller();
	const trustedHosts = () => {
		try {
			const value = ctx.get("webRuntime", false)?.trustedHosts;
			return Array.isArray(value) ? value : [];
		} catch {
			return [];
		}
	};
	const handler = createDrawioRouteHandler({
		installer,
		trustedHosts
	});
	ctx.effect(() => {
		const disposeRoute = ctx.webServer.register({
			kind: "prefix",
			path: DRAWIO_ROUTE_PREFIX,
			handler
		});
		console.log(`[dsh-drawio] prefix route registered: ${DRAWIO_ROUTE_PREFIX} (webapp root ${installer.webappRoot})`);
		return () => {
			console.log(`[dsh-drawio] prefix route disposed: ${DRAWIO_ROUTE_PREFIX}`);
			disposeRoute();
		};
	});
}

//#endregion
export { apply, inject, name };
//# sourceMappingURL=index.js.map