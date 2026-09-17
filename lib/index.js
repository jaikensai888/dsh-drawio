import { dirname, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";

//#region src/net/http.ts
/**
* An error we deliberately translate into an HTTP status plus envelope.
* Anything else that escapes a handler becomes a 500 `internal`.
*
* `details` is an optional machine-readable side-channel for errors the client
* must act on — a 409 carries the current on-disk mtime so the conflict UI can
* offer "reload / overwrite" without another round trip.
*/
var DrawioError = class extends Error {
	code;
	status;
	details;
	constructor(code, message, status = 400, details) {
		super(message);
		this.name = "DrawioError";
		this.code = code;
		this.status = status;
		this.details = details;
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
/** Write a failure envelope, deriving status/code/details from the thrown value. */
function writeError(response, error) {
	const { status, code, message, details } = toDrawioHttpError(error);
	writeJson(response, status, {
		ok: false,
		error: {
			code,
			message,
			...details === void 0 ? {} : { details }
		}
	});
}
/** Normalise any thrown value into `{ status, code, message, details }`. */
function toDrawioHttpError(error) {
	if (error instanceof DrawioError) return error.details === void 0 ? {
		status: error.status,
		code: error.code,
		message: error.message
	} : {
		status: error.status,
		code: error.code,
		message: error.message,
		details: error.details
	};
	return {
		status: 500,
		code: "internal",
		message: error instanceof Error ? error.message : String(error)
	};
}
/** Largest JSON request body we accept (a diagram plus envelope). */
const MAX_JSON_BODY_BYTES = 80 * 1024 * 1024;
/**
* Read and parse a JSON request body.
*
* `webServer` hands us raw `node:http` requests — there is no body helper — so
* this owns the stream lifecycle: it destroys the socket on an oversized body
* rather than buffering it.
*/
async function readJsonBody(request) {
	const chunks = [];
	let total = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buffer.byteLength;
		if (total > MAX_JSON_BODY_BYTES) {
			request.destroy();
			throw new DrawioError("bad-request", "请求体过大");
		}
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8").trim();
	if (text === "") return {};
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new DrawioError("bad-request", "请求体不是合法 JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new DrawioError("bad-request", "请求体必须是 JSON 对象");
	return parsed;
}

//#endregion
//#region src/net/fs-fence.ts
/**
* Filesystem containment for the workspace fence.
*
* There is no framework guarantee here — the session cwd is the *scope* a
* `.drawio` may be read from or written to, and every entry point has to
* enforce it. The recipe follows GROUND-TRUTH §5.3, which dsh-better-sidebar
* uses for its own media routes.
*
* Known limitation (shared with better-sidebar's routes): containment is a
* string comparison on `resolve()`d paths, so a **symlink inside the workspace
* pointing outside it** still resolves inside. Closing that would require a
* realpath check that breaks legitimate junctioned workspaces, so it is left
* to the platform sandbox.
*/
/** Normalize separators and drop a trailing slash so prefix tests are exact. */
function normalizeForCompare(value) {
	return value.replace(/[\\/]+/gu, "/").replace(/\/$/u, "");
}
/**
* Whether `target` is `base` itself or lives underneath it.
*
* Case-insensitive on Windows; tolerates mixed separators so a forward-slash
* request path still matches a backslash `resolve()` result.
*/
function isWithin(base, target, platform = process.platform) {
	const b = normalizeForCompare(base);
	const t = normalizeForCompare(target);
	if (platform === "win32") {
		const lb = b.toLowerCase();
		const lt = t.toLowerCase();
		return lt === lb || lt.startsWith(`${lb}/`);
	}
	return t === b || t.startsWith(`${b}/`);
}
/**
* Validate a caller-supplied path is absolute and normalize it.
*
* `path.isAbsolute` already rejects drive-relative forms like `C:foo`, which
* `resolve()` would otherwise silently anchor to the process cwd.
*/
function requireAbsolute(value, label = "path") {
	if (typeof value !== "string" || value.trim() === "") throw new DrawioError("bad-request", `${label} 必须是非空字符串`);
	const trimmed = value.trim();
	if (!isAbsolute(trimmed)) throw new DrawioError("bad-request", `${label} 必须是绝对路径：${trimmed}`);
	return resolve(trimmed);
}
/**
* Resolve a caller path under `base`, refusing anything that escapes it.
*
* ★ The containment test MUST use `path.sep` (via {@link isWithin}), not a
* hard-coded `/`: on Windows `resolve()` yields backslashes, so comparing
* against `${base}/` would reject every legitimate sub-path.
*/
function resolveWithinBase(base, candidate, label = "path") {
	const normalizedBase = resolve(base);
	const target = resolve(normalize(candidate));
	if (!isWithin(normalizedBase, target)) throw new DrawioError("forbidden", `${label} 越出当前工作区：${candidate}`, 403);
	return target;
}
/**
* Resolve a request path (absolute, or relative to the workspace) under `base`.
* Both forms are accepted because better-sidebar hands the editor a path it
* built from its own tree, and the host must not assume which one it chose.
*/
function resolveRequestPath(base, raw, label = "path") {
	if (typeof raw !== "string" || raw.trim() === "") throw new DrawioError("bad-request", `${label} 必须是非空字符串`);
	const value = raw.trim();
	const normalizedBase = resolve(base);
	const candidate = isAbsolute(value) ? resolve(value) : resolve(normalizedBase, value);
	if (!isWithin(normalizedBase, candidate)) throw new DrawioError("forbidden", `${label} 越出当前工作区：${value}`, 403);
	return candidate;
}
/** Path relative to the workspace root, for display; falls back to the absolute path. */
function relativeToBase(base, target) {
	const b = normalizeForCompare(resolve(base));
	const t = normalizeForCompare(resolve(target));
	const prefix = process.platform === "win32" ? b.toLowerCase() : b;
	const probe = process.platform === "win32" ? t.toLowerCase() : t;
	if (probe === prefix) return "";
	if (!probe.startsWith(`${prefix}/`)) return target;
	return t.slice(b.length + 1);
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
//#region src/drawio-xml.ts
const COMPRESSED_ATTR = /\s+compressed\s*=\s*(?:"true"|'true')/iu;
/**
* Index just past the `>` closing a tag that starts at `start`, honouring
* quoted attribute values (an attribute may legally contain `>`).
*/
function findTagEnd(xml, start) {
	let quote;
	for (let i = start; i < xml.length; i += 1) {
		const ch = xml[i];
		if (quote !== void 0) {
			if (ch === quote) quote = void 0;
		} else if (ch === "\"" || ch === "'") quote = ch;
		else if (ch === ">") return i + 1;
	}
	return -1;
}
/**
* Whether a `<diagram>` stores compressed content — two independent signals,
* structure first, exactly as drawio and the mxfile spec describe it:
* an explicit `compressed="true"`, or non-empty text content with no element
* child (a plain diagram always carries a `<mxGraphModel>` child).
*/
function diagramIsCompressed(startTag, content) {
	if (COMPRESSED_ATTR.test(startTag)) return true;
	const trimmed = content.trim();
	if (trimmed === "") return false;
	return !trimmed.startsWith("<");
}
/** Split an mxfile document into its header, diagram parts and footer. */
function parseMxfile(xml) {
	const diagrams = [];
	let header$1 = xml;
	let footer = "";
	let cursor = 0;
	let sawDiagram = false;
	for (;;) {
		const open = xml.indexOf("<diagram", cursor);
		if (open === -1) break;
		const after = xml[open + 8];
		if (after !== void 0 && !/[\s/>]/u.test(after)) {
			cursor = open + 8;
			continue;
		}
		const tagEnd = findTagEnd(xml, open);
		if (tagEnd === -1) break;
		const startTag = xml.slice(open, tagEnd);
		if (!sawDiagram) {
			header$1 = xml.slice(0, open);
			sawDiagram = true;
		}
		if (startTag.endsWith("/>")) {
			diagrams.push({
				startTag,
				content: "",
				selfClosing: true,
				compressed: false
			});
			cursor = tagEnd;
			footer = xml.slice(tagEnd);
			continue;
		}
		const close = xml.indexOf("</diagram>", tagEnd);
		if (close === -1) break;
		const content = xml.slice(tagEnd, close);
		diagrams.push({
			startTag,
			content,
			selfClosing: false,
			compressed: diagramIsCompressed(startTag, content)
		});
		cursor = close + 10;
		footer = xml.slice(cursor);
	}
	return {
		header: header$1,
		diagrams,
		footer
	};
}
/** Rebuild a document from its parts. */
function serializeMxfile(shape) {
	let out = shape.header;
	for (const part of shape.diagrams) out += part.selfClosing ? part.startTag : `${part.startTag}${part.content}</diagram>`;
	return out + shape.footer;
}
/** Drawio's decode step: base64 → raw inflate → `decodeURIComponent`. */
function decompressDiagram(data) {
	const compact = data.replace(/\s+/gu, "");
	let inflated;
	try {
		inflated = inflateRawSync(Buffer.from(compact, "base64"));
	} catch (error) {
		throw new DrawioError("bad-request", `图纸内容解压失败（raw inflate）：${error instanceof Error ? error.message : String(error)}`);
	}
	try {
		return decodeURIComponent(inflated.toString("utf8"));
	} catch {
		throw new DrawioError("bad-request", "图纸内容解码失败（decodeURIComponent）");
	}
}
/** Drawio's encode step: `encodeURIComponent` → raw deflate → base64. */
function compressDiagram(xml) {
	return deflateRawSync(Buffer.from(encodeURIComponent(xml), "utf8")).toString("base64");
}
/**
* Return an equivalent document whose diagrams are all literal
* `<mxGraphModel>` children — what the editor needs to load.
*
* A document that is already plain comes back byte-identical.
*/
function decodeMxfile(xml) {
	const shape = parseMxfile(xml);
	if (!shape.diagrams.some((part) => part.compressed)) return xml;
	return serializeMxfile({
		...shape,
		diagrams: shape.diagrams.map((part) => {
			if (!part.compressed) return part;
			return {
				startTag: part.startTag.replace(COMPRESSED_ATTR, ""),
				content: decompressDiagram(part.content),
				selfClosing: false,
				compressed: false
			};
		})
	});
}
/** Storage style of the bytes we read from disk. */
function mxfileStyle(xml) {
	const shape = parseMxfile(xml);
	const compressed = shape.diagrams.some((part) => part.compressed);
	return {
		compressed,
		explicitAttribute: compressed && shape.diagrams.some((part) => COMPRESSED_ATTR.test(part.startTag))
	};
}
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
function reshapeToStyle(style, xml) {
	if (!style.compressed) return xml;
	const shape = parseMxfile(xml);
	if (shape.diagrams.length === 0) return xml;
	return serializeMxfile({
		...shape,
		diagrams: shape.diagrams.map((part) => {
			if (part.selfClosing || part.content.trim() === "") return part;
			if (part.compressed) return part;
			const startTag = part.startTag.replace(COMPRESSED_ATTR, "");
			return {
				startTag: style.explicitAttribute ? startTag.replace(/(\s*\/?>)$/u, " compressed=\"true\"$1") : startTag,
				content: compressDiagram(part.content),
				selfClosing: false,
				compressed: true
			};
		})
	});
}

//#endregion
//#region src/net/atomic-write.ts
/** Replace `filename` with `content` in one atomic step, creating parent directories. */
async function writeFileAtomic(filename, content, options) {
	await mkdir(dirname(filename), {
		recursive: true,
		...options.dirMode === void 0 ? {} : { mode: options.dirMode }
	});
	const temp = `${filename}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await writeFile(temp, content, {
			mode: options.mode,
			flag: "wx"
		});
		await rename(temp, filename);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}

//#endregion
//#region src/diagrams.ts
/** Sub-directory new diagrams land in, relative to the workspace. */
const DEFAULT_DIAGRAMS_DIR = "docs/diagrams";
/** Extensions this plugin claims (lowercase, no dot). */
const DIAGRAM_EXTENSIONS = ["drawio", "dio"];
/** Permissions for a diagram we write: owner read/write, group and other read. */
const FILE_MODE = 420;
/** Refuse absurd inputs rather than trying to hold them in memory. */
const MAX_DIAGRAM_BYTES = 64 * 1024 * 1024;
/** What a brand-new diagram contains. */
const BLANK_MXFILE = [
	"<mxfile host=\"dsh-drawio\" agent=\"dsh-drawio\" type=\"device\">",
	"  <diagram id=\"dsh-drawio-blank\" name=\"Page-1\">",
	"    <mxGraphModel dx=\"800\" dy=\"600\" grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"1\" pageScale=\"1\" pageWidth=\"850\" pageHeight=\"1100\" math=\"0\" shadow=\"0\">",
	"      <root>",
	"        <mxCell id=\"0\" />",
	"        <mxCell id=\"1\" parent=\"0\" />",
	"      </root>",
	"    </mxGraphModel>",
	"  </diagram>",
	"</mxfile>",
	""
].join("\n");
async function statOrUndefined(path) {
	try {
		return await stat(path);
	} catch (error) {
		const code = error.code;
		if (code === "ENOENT" || code === "ENOTDIR") return void 0;
		throw new DrawioError("fs-error", `无法访问 ${path}：${error.message}`, 500);
	}
}
function isDiagramFileName(name$1) {
	return DIAGRAM_EXTENSIONS.includes(extname(name$1).slice(1).toLowerCase());
}
/** Read a `.drawio` inside the workspace, decoding compressed storage. */
async function readDiagram(options) {
	const target = resolveRequestPath(options.cwd, options.path);
	const relativePath = relativeToBase(options.cwd, target);
	const info = await statOrUndefined(target);
	if (info === void 0 || !info.isFile()) throw new DrawioError("not-found", `图纸不存在：${relativePath}`, 404);
	if (info.size > MAX_DIAGRAM_BYTES) throw new DrawioError("bad-request", `图纸文件过大（${String(info.size)} 字节）`);
	let raw;
	try {
		raw = await readFile(target, "utf8");
	} catch (error) {
		throw new DrawioError("fs-error", `读取失败：${error.message}`, 500);
	}
	if (raw.charCodeAt(0) === 65279) raw = raw.slice(1);
	if (raw.trim() === "") return {
		path: target,
		relativePath,
		xml: BLANK_MXFILE,
		compressed: false,
		mtimeMs: info.mtimeMs,
		size: info.size
	};
	if (!raw.includes("<mxfile") && !raw.includes("<mxGraphModel")) throw new DrawioError("bad-request", `${relativePath} 不是有效的 .drawio 文件（缺少 mxfile/mxGraphModel）`);
	const style = mxfileStyle(raw);
	return {
		path: target,
		relativePath,
		xml: decodeMxfile(raw),
		compressed: style.compressed,
		mtimeMs: info.mtimeMs,
		size: info.size
	};
}
/**
* Write a diagram atomically, refusing to clobber an external edit.
*
* The mtime check is the whole point: drawio autosaves on a debounce, so
* without it a stale editor buffer would silently destroy a change made by
* another tool. A mismatch is a 409 the viewer resolves interactively.
*
* The storage style is re-derived from the bytes currently on disk rather than
* carried by the client: the client cannot get it stale, and a file another
* tool re-compressed is followed rather than fought.
*/
async function writeDiagram(options) {
	if (typeof options.xml !== "string" || options.xml.trim() === "") throw new DrawioError("bad-request", "xml 必须是非空字符串");
	if (Buffer.byteLength(options.xml, "utf8") > MAX_DIAGRAM_BYTES) throw new DrawioError("bad-request", "图纸内容过大");
	const target = resolveRequestPath(options.cwd, options.path);
	const relativePath = relativeToBase(options.cwd, target);
	const existing = await statOrUndefined(target);
	let style = {
		compressed: false,
		explicitAttribute: false
	};
	if (existing === void 0) {
		if (options.ifMtimeMs !== void 0) throw new DrawioError("conflict", `文件已被外部删除：${relativePath}`, 409, {
			reason: "deleted",
			currentMtimeMs: null
		});
	} else {
		if (!existing.isFile()) throw new DrawioError("bad-request", `目标不是普通文件：${relativePath}`);
		if (options.ifMtimeMs !== void 0 && Math.round(existing.mtimeMs) !== Math.round(options.ifMtimeMs)) throw new DrawioError("conflict", `文件已被外部修改，未覆盖：${relativePath}`, 409, {
			reason: "modified",
			currentMtimeMs: Math.round(existing.mtimeMs),
			currentSize: existing.size
		});
		let onDisk;
		try {
			onDisk = await readFile(target, "utf8");
			style = mxfileStyle(onDisk);
		} catch {
			style = {
				compressed: false,
				explicitAttribute: false
			};
		}
		if (onDisk !== void 0 && decodeMxfile(onDisk).trim() === options.xml.trim()) return {
			path: target,
			relativePath,
			mtimeMs: existing.mtimeMs,
			size: existing.size,
			compressed: style.compressed
		};
	}
	const content = reshapeToStyle(style, options.xml);
	try {
		await writeFileAtomic(target, content, { mode: FILE_MODE });
	} catch (error) {
		throw new DrawioError("fs-error", `写入失败：${error.message}`, 500);
	}
	const info = await stat(target);
	return {
		path: target,
		relativePath,
		mtimeMs: info.mtimeMs,
		size: info.size,
		compressed: style.compressed
	};
}
/** Reject anything that could steer the new file out of its directory. */
function safeBaseName(value) {
	const trimmed = value.trim();
	if (trimmed === "" || /[\\/:*?"<>|]/u.test(trimmed) || trimmed.startsWith(".")) throw new DrawioError("bad-request", `非法的文件名：${value}`);
	return trimmed;
}
/** Create the next free `<name>-N.drawio` under the workspace diagrams directory. */
async function createDiagram(options) {
	const directory = options.directory ?? DEFAULT_DIAGRAMS_DIR;
	const dir = resolveWithinBase(options.cwd, join(options.cwd, directory));
	const base = safeBaseName(options.name ?? "untitled");
	const existingNames = /* @__PURE__ */ new Set();
	try {
		for (const entry of await readdir(dir, { withFileTypes: true })) if (entry.isFile()) existingNames.add(entry.name.toLowerCase());
	} catch (error) {
		if (error.code !== "ENOENT") throw new DrawioError("fs-error", `无法读取目录 ${directory}：${error.message}`, 500);
	}
	let target;
	for (let index = 1; index <= 9999; index += 1) {
		const candidate = join(dir, `${base}-${String(index)}.drawio`);
		if (!existingNames.has(`${base}-${String(index)}.drawio`.toLowerCase())) {
			target = candidate;
			break;
		}
	}
	if (target === void 0) throw new DrawioError("fs-error", `目录 ${directory} 下 ${base}-N.drawio 已用尽`, 500);
	try {
		await writeFileAtomic(target, BLANK_MXFILE, { mode: FILE_MODE });
	} catch (error) {
		throw new DrawioError("fs-error", `创建图纸失败：${error.message}`, 500);
	}
	const info = await stat(target);
	return {
		path: target,
		relativePath: relativeToBase(options.cwd, target),
		xml: BLANK_MXFILE,
		compressed: false,
		mtimeMs: info.mtimeMs,
		size: info.size
	};
}
/** List the diagrams in the workspace diagrams directory, name-sorted. */
async function listDiagrams(options) {
	const directory = options.directory ?? DEFAULT_DIAGRAMS_DIR;
	const dir = resolveWithinBase(options.cwd, join(options.cwd, directory));
	let dirents;
	try {
		dirents = await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return [];
		throw new DrawioError("fs-error", `无法读取目录 ${directory}：${error.message}`, 500);
	}
	const entries = [];
	for (const dirent of dirents) {
		if (!dirent.isFile() || !isDiagramFileName(dirent.name)) continue;
		const full = join(dir, dirent.name);
		const info = await statOrUndefined(full);
		if (info === void 0) continue;
		entries.push({
			name: dirent.name,
			path: full,
			relativePath: relativeToBase(options.cwd, full),
			mtimeMs: info.mtimeMs,
			size: info.size
		});
	}
	entries.sort((a, b) => a.name.localeCompare(b.name));
	return entries;
}
/** Whether a path exists inside the workspace (used by the "create it?" prompt). */
async function diagramExists(options) {
	const info = await statOrUndefined(resolveRequestPath(options.cwd, options.path));
	if (info === void 0) return {
		exists: false,
		isFile: false
	};
	return {
		exists: true,
		isFile: info.isFile(),
		mtimeMs: info.mtimeMs,
		size: info.size
	};
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
	const exact = new Map([
		["/ping", handlePing],
		["/api/webapp-status", (request, response) => handleWebappStatus(request, response, deps.installer)],
		["/api/read", (request, response) => handleRead(request, response, deps)],
		["/api/write", (request, response) => handleWrite(request, response, deps)],
		["/api/create", (request, response) => handleCreate(request, response, deps)],
		["/api/list", (request, response) => handleList(request, response, deps)],
		["/api/exists", (request, response) => handleExists(request, response, deps)]
	]);
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
function requirePostBody(request, route) {
	if (request.method !== "POST") throw new DrawioError("method-not-allowed", `${route} 只接受 POST 请求`, 405);
	return readJsonBody(request);
}
function requireSessionId(body) {
	const value = body["sessionId"];
	if (typeof value !== "string" || value.trim() === "") throw new DrawioError("bad-request", "sessionId 必须是非空字符串");
	return value.trim();
}
function optionalString(body, key) {
	const value = body[key];
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "string" || value.trim() === "") throw new DrawioError("bad-request", `${key} 必须是非空字符串`);
	return value.trim();
}
function optionalNumber(body, key) {
	const value = body[key];
	if (value === void 0 || value === null) return void 0;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new DrawioError("bad-request", `${key} 必须是有限数字`);
	return value;
}
/** Session → authoritative cwd, with the client value as hydration fallback only. */
function cwdFor(deps, body) {
	return deps.resolveSessionCwd(requireSessionId(body), optionalString(body, "cwd"));
}
async function handleRead(request, response, deps) {
	const body = await requirePostBody(request, "POST /drawio/api/read");
	const path = optionalString(body, "path");
	if (path === void 0) throw new DrawioError("bad-request", "缺少 path");
	writeOk(response, await readDiagram({
		cwd: cwdFor(deps, body),
		path
	}));
}
async function handleWrite(request, response, deps) {
	const body = await requirePostBody(request, "POST /drawio/api/write");
	const path = optionalString(body, "path");
	if (path === void 0) throw new DrawioError("bad-request", "缺少 path");
	const xml = body["xml"];
	if (typeof xml !== "string") throw new DrawioError("bad-request", "xml 必须是字符串");
	writeOk(response, await writeDiagram({
		cwd: cwdFor(deps, body),
		path,
		xml,
		ifMtimeMs: optionalNumber(body, "ifMtimeMs")
	}));
}
async function handleCreate(request, response, deps) {
	const body = await requirePostBody(request, "POST /drawio/api/create");
	const options = { cwd: cwdFor(deps, body) };
	const directory = optionalString(body, "directory");
	if (directory !== void 0) options.directory = directory;
	const name$1 = optionalString(body, "name");
	if (name$1 !== void 0) options.name = name$1;
	writeOk(response, await createDiagram(options));
}
async function handleList(request, response, deps) {
	const body = await requirePostBody(request, "POST /drawio/api/list");
	const directory = optionalString(body, "directory");
	writeOk(response, await listDiagrams({
		cwd: cwdFor(deps, body),
		...directory === void 0 ? {} : { directory }
	}));
}
async function handleExists(request, response, deps) {
	const body = await requirePostBody(request, "POST /drawio/api/exists");
	const path = optionalString(body, "path");
	if (path === void 0) throw new DrawioError("bad-request", "缺少 path");
	writeOk(response, await diagramExists({
		cwd: cwdFor(deps, body),
		path
	}));
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
* Resolve the workspace directory a session's diagrams are scoped to.
*
* `header.cwd` is authoritative — the session store validated it as an
* absolute path at construction. The client's copy is a hydration fallback
* (useful before a session is materialised) and the process cwd the last
* resort. `ctx.sessions.list()` only returns live sessions, so nothing here
* tries to look up historical working directories.
*/
function sessionCwdOf(ctx, sessionId, clientCwd) {
	const headerCwd = ctx.get(sessionId)?.header.cwd;
	if (headerCwd !== void 0 && headerCwd !== "") return headerCwd;
	if (clientCwd !== void 0 && clientCwd !== "") return requireAbsolute(clientCwd, "cwd");
	return process.cwd();
}
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
	const resolveSessionCwd = (sessionId, clientCwd) => {
		try {
			return sessionCwdOf(ctx.sessions, sessionId, clientCwd);
		} catch (error) {
			if (error instanceof DrawioError) throw error;
			throw new DrawioError("bad-request", `无法确定会话工作区：${error.message}`);
		}
	};
	const handler = createDrawioRouteHandler({
		installer,
		trustedHosts,
		resolveSessionCwd
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
export { apply, inject, name, sessionCwdOf };
//# sourceMappingURL=index.js.map