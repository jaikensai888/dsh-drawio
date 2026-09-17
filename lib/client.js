window.__ModuleLoader__.load({ id: "dsh-drawio", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react = require("react");
react = __toESM(react);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region src/client/api.ts
/** A host-reported failure, with enough structure for the UI to branch on. */
var DrawioApiError = class extends Error {
	status;
	code;
	details;
	constructor(message, status, code, details) {
		super(message);
		this.name = "DrawioApiError";
		this.status = status;
		this.code = code;
		this.details = details;
	}
	/** True for the "file changed under us" answer the viewer resolves interactively. */
	get isConflict() {
		return this.status === 409;
	}
};
async function request(route, body, method = "POST", signal) {
	let response;
	try {
		response = await fetch(route, {
			method,
			headers: {
				accept: "application/json",
				...method === "POST" ? { "content-type": "application/json" } : {}
			},
			...method === "POST" ? { body: JSON.stringify(body) } : {},
			...signal === void 0 ? {} : { signal }
		});
	} catch (error) {
		throw new DrawioApiError(`无法连接 dsh-drawio 主机接口：${error instanceof Error ? error.message : String(error)}`, 0, "network");
	}
	let envelope;
	try {
		envelope = await response.json();
	} catch {
		throw new DrawioApiError(`接口 ${route} 返回的不是 JSON（HTTP ${String(response.status)}）`, response.status, "bad-response");
	}
	if (envelope.ok !== true || envelope.value === void 0) throw new DrawioApiError(envelope.error?.message ?? `接口 ${route} 失败（HTTP ${String(response.status)}）`, response.status, envelope.error?.code ?? "internal", envelope.error?.details);
	return envelope.value;
}
/** Readiness + download progress of the self-hosted editor. */
function fetchWebappStatus(signal) {
	return request("/drawio/api/webapp-status", {}, "GET", signal);
}
/** Start (or join) the one-time editor download and report progress. */
function startWebappInstall(signal) {
	return request("/drawio/api/webapp-status", {}, "POST", signal);
}
function scopeBody(scope) {
	return scope.cwd === void 0 || scope.cwd === "" ? { sessionId: scope.sessionId } : {
		sessionId: scope.sessionId,
		cwd: scope.cwd
	};
}
/** Read a diagram (decoded) plus the mtime the editor will save against. */
function readDiagram(scope, path, signal) {
	return request("/drawio/api/read", {
		...scopeBody(scope),
		path
	}, "POST", signal);
}
/**
* Write a diagram. `ifMtimeMs` makes the write conditional: the host answers
* 409 instead of clobbering a file that changed since that timestamp. Omit it
* to overwrite deliberately.
*/
function writeDiagram(scope, path, xml, ifMtimeMs, signal) {
	return request("/drawio/api/write", {
		...scopeBody(scope),
		path,
		xml,
		...ifMtimeMs === void 0 ? {} : { ifMtimeMs }
	}, "POST", signal);
}

//#endregion
//#region src/client/embed-protocol.ts
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
const DRAWIO_EMBED_PATH = "/drawio/webapp/index.html";
/**
* `embed=1&proto=json` switches drawio to its postMessage transport.
* `spin=1` is drawio's own loading spinner, `configure=1` makes it wait for our
* configure reply before initialising, `stealth=1` + `suppressNewWindows=1`
* keep it from sprouting chrome or popups, `lang=zh` localises the UI.
*/
const DRAWIO_EMBED_QUERY = [
	"embed=1",
	"proto=json",
	"spin=1",
	"ui=kennedy",
	"libraries=1",
	"configure=1",
	"plugins=0",
	"stealth=1",
	"suppressNewWindows=1",
	"lang=zh"
].join("&");
/** Full editor URL for the iframe `src`. */
const DRAWIO_EMBED_URL = `${DRAWIO_EMBED_PATH}?${DRAWIO_EMBED_QUERY}`;
/**
* Answer to drawio's `configure` event.
*
* `lockdown: true` cuts every data channel except browser ↔ user-chosen
* storage; the CSP we serve the webapp with (`connect-src 'self'`) is the
* actual network-level gate behind it.
*
* `compressXml` mirrors how the file is stored, so drawio hands back a payload
* in that same style. That matters beyond convenience: each page is deflated
* independently, and letting drawio's own (pako) encoder do it keeps every
* *unmodified* page's bytes identical between saves, which is what stops a
* one-shape edit from rewriting every page in a compressed multi-page file.
*/
function drawioConfig(options) {
	return {
		lockdown: true,
		plugins: [],
		compressXml: options.compressed,
		autosaveDelay: 1500,
		preserveViewState: true,
		noAutoFocus: true,
		compact: true,
		hideMenuItems: ["plugins", "print"]
	};
}
function createDrawioEmbedChannel(options) {
	const targetOrigin = options.targetOrigin ?? globalThis.location.origin;
	const handleMessage = (event) => {
		const frame = options.getFrame();
		if (frame === null || event.source !== frame.contentWindow) return;
		if (event.origin !== targetOrigin) return;
		if (typeof event.data !== "string") return;
		let parsed;
		try {
			parsed = JSON.parse(event.data);
		} catch {
			return;
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
		const payload = parsed;
		const name = payload["event"];
		if (typeof name !== "string" || name === "") return;
		options.onEvent(name, payload);
	};
	globalThis.addEventListener("message", handleMessage);
	return {
		post(action, payload) {
			const target = options.getFrame()?.contentWindow;
			if (target === null || target === void 0) return false;
			target.postMessage(JSON.stringify(payload === void 0 ? { action } : {
				action,
				...payload
			}), targetOrigin);
			return true;
		},
		dispose() {
			globalThis.removeEventListener("message", handleMessage);
		}
	};
}

//#endregion
//#region src/client/DiagramViewer.tsx
const POLL_INTERVAL_MS = 700;
/** Idle delay before an autosave reaches disk; at or above drawio's own 1500ms autosaveDelay. */
const WRITE_DEBOUNCE_MS = 1500;
/** Where "另存为" drops a copy, relative to the workspace. */
const DIAGRAMS_DIR = "docs/diagrams";
const FONT = "13px/1.6 system-ui, -apple-system, \"Segoe UI\", \"Microsoft YaHei\", sans-serif";
const BUTTON_STYLE = {
	font: "inherit",
	padding: "2px 8px",
	cursor: "pointer"
};
function asLoadPayload(value) {
	if (typeof value !== "object" || value === null) return null;
	const candidate = value;
	if (candidate.kind === "missing" && typeof candidate.path === "string") return {
		kind: "missing",
		path: candidate.path
	};
	if (candidate.kind === "ready" && typeof candidate.diagram === "object" && candidate.diagram !== null) return {
		kind: "ready",
		diagram: candidate.diagram
	};
	return null;
}
function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
	const units = [
		"B",
		"KB",
		"MB",
		"GB"
	];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
function progressText(status) {
	if (status === null) return "正在检查编辑器资源…";
	switch (status.phase) {
		case "missing": return "正在准备下载 draw.io 编辑器…";
		case "downloading": return `正在下载 draw.io 编辑器（${formatBytes(status.received)} / ${formatBytes(status.total)}）`;
		case "verifying": return "正在校验资源包完整性…";
		case "extracting": return "正在解压编辑器资源（约 147 MB）…";
		default: return "正在检查编辑器资源…";
	}
}
function Panel({ children }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: {
			padding: 16,
			font: FONT,
			display: "flex",
			flexDirection: "column",
			gap: 10
		},
		children
	});
}
/**
* `.drawio` previewer backed by the self-hosted draw.io webapp.
*
* The editor runs in a plain same-origin iframe created by THIS component.
*
* ★ Do not add a `sandbox` attribute. drawio dies silently inside any sandbox
* without `allow-same-origin` (its `localStorage` access throws on an opaque
* origin and initialisation aborts without ever posting `init`). For the same
* reason this viewer must never be hosted inside better-sidebar's browser/HTML
* preview tabs, which are sandboxed frames.
*/
function DiagramViewer(props) {
	const payload = asLoadPayload(props.customData);
	if (payload === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Panel, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "无法加载图纸" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		style: { opacity: .8 },
		children: "视图没有拿到文件内容，请关闭该标签页后重新打开。"
	})] });
	if (payload.kind === "missing") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Panel, { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "此文件不存在" }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: {
				opacity: .8,
				wordBreak: "break-all"
			},
			children: payload.path
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: {
				opacity: .6,
				fontSize: 12
			},
			children: "确认路径是否正确。在编辑器标签页里直接敲一个不存在的 `docs/diagrams/x.drawio` 时，下一步会在这里提供创建按钮。"
		})
	] });
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EditorPane, {
		ctx: props.ctx,
		scope: props.scope,
		path: props.path,
		title: props.title,
		initial: payload.diagram
	});
}
function EditorPane(props) {
	const { ctx, scope, path, title, initial } = props;
	const [installPhase, setInstallPhase] = (0, react.useState)("probing");
	const [status, setStatus] = (0, react.useState)(null);
	const [installError, setInstallError] = (0, react.useState)(null);
	const [installAttempt, setInstallAttempt] = (0, react.useState)(0);
	const [doc, setDoc] = (0, react.useState)(initial);
	const [dirty, setDirty] = (0, react.useState)(false);
	const [saveState, setSaveState] = (0, react.useState)("idle");
	const [saveError, setSaveError] = (0, react.useState)(null);
	const [conflict, setConflict] = (0, react.useState)(null);
	const [editorKey, setEditorKey] = (0, react.useState)(0);
	const [saveAsOpen, setSaveAsOpen] = (0, react.useState)(false);
	const [saveAsName, setSaveAsName] = (0, react.useState)("");
	const frameRef = (0, react.useRef)(null);
	const docRef = (0, react.useRef)(initial);
	const baselineRef = (0, react.useRef)({
		mtimeMs: initial.mtimeMs,
		size: initial.size
	});
	const pendingRef = (0, react.useRef)(null);
	const timerRef = (0, react.useRef)(null);
	const savingRef = (0, react.useRef)(false);
	/** Set while an unresolved conflict holds writes back. */
	const pausedRef = (0, react.useRef)(false);
	const dirtyRef = (0, react.useRef)(false);
	(0, react.useEffect)(() => {
		docRef.current = doc;
	}, [doc]);
	const applyDocument = (0, react.useCallback)((next) => {
		docRef.current = next;
		baselineRef.current = {
			mtimeMs: next.mtimeMs,
			size: next.size
		};
		pendingRef.current = null;
		pausedRef.current = false;
		dirtyRef.current = false;
		setDoc(next);
		setDirty(false);
		setSaveState("idle");
		setSaveError(null);
		setConflict(null);
		setEditorKey((value) => value + 1);
	}, []);
	const flush = (0, react.useCallback)(async (options = {}) => {
		if (timerRef.current !== null) {
			globalThis.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		if (savingRef.current) return;
		const xml = pendingRef.current;
		if (xml === null) return;
		if (pausedRef.current && options.force !== true) return;
		pendingRef.current = null;
		savingRef.current = true;
		setSaveState("saving");
		setSaveError(null);
		try {
			const result = await writeDiagram(scope, path, xml, options.force === true ? void 0 : baselineRef.current.mtimeMs);
			baselineRef.current = {
				mtimeMs: result.mtimeMs,
				size: result.size
			};
			pausedRef.current = false;
			setConflict(null);
			setSaveState("saved");
			if (pendingRef.current === null) {
				dirtyRef.current = false;
				setDirty(false);
			}
		} catch (error) {
			if (error instanceof DrawioApiError && error.isConflict) {
				const current = error.details?.["currentMtimeMs"];
				setConflict({
					message: error.message,
					currentMtimeMs: typeof current === "number" ? current : null
				});
				pausedRef.current = true;
			} else {
				setSaveError(error instanceof Error ? error.message : String(error));
				setSaveState("failed");
			}
			if (pendingRef.current === null) pendingRef.current = xml;
		} finally {
			savingRef.current = false;
		}
		if (pendingRef.current !== null && !pausedRef.current) flush();
	}, [scope, path]);
	const scheduleSave = (0, react.useCallback)((xml) => {
		pendingRef.current = xml;
		dirtyRef.current = true;
		setDirty(true);
		if (timerRef.current !== null) globalThis.clearTimeout(timerRef.current);
		timerRef.current = globalThis.setTimeout(() => {
			timerRef.current = null;
			flush();
		}, WRITE_DEBOUNCE_MS);
	}, [flush]);
	(0, react.useEffect)(() => () => {
		if (timerRef.current !== null) globalThis.clearTimeout(timerRef.current);
		if (pendingRef.current !== null && !pausedRef.current) flush({ force: true });
	}, [flush]);
	(0, react.useEffect)(() => {
		const handler = (event) => {
			if (!dirtyRef.current) return;
			event.preventDefault();
			event.returnValue = "";
		};
		globalThis.addEventListener("beforeunload", handler);
		return () => globalThis.removeEventListener("beforeunload", handler);
	}, []);
	(0, react.useEffect)(() => {
		const onHidden = () => {
			if (document.visibilityState === "hidden" && pendingRef.current !== null && !pausedRef.current) flush();
		};
		document.addEventListener("visibilitychange", onHidden);
		return () => document.removeEventListener("visibilitychange", onHidden);
	}, [flush]);
	(0, react.useEffect)(() => {
		const controller = new AbortController();
		let cancelled = false;
		let timer;
		let started = false;
		const tick = async () => {
			try {
				const snapshot = started ? await fetchWebappStatus(controller.signal) : await startWebappInstall(controller.signal);
				if (cancelled) return;
				started = true;
				setStatus(snapshot);
				if (snapshot.ready) {
					setInstallError(null);
					setInstallPhase("ready");
					return;
				}
				if (snapshot.phase === "error") {
					setInstallError(snapshot.message ?? "编辑器资源安装失败");
					setInstallPhase("error");
					return;
				}
				setInstallPhase("installing");
				timer = globalThis.setTimeout(() => {
					tick();
				}, POLL_INTERVAL_MS);
			} catch (caught) {
				if (cancelled || controller.signal.aborted) return;
				setInstallError(caught instanceof Error ? caught.message : String(caught));
				setInstallPhase("error");
			}
		};
		setInstallPhase("probing");
		setInstallError(null);
		tick();
		return () => {
			cancelled = true;
			controller.abort();
			if (timer !== void 0) globalThis.clearTimeout(timer);
		};
	}, [installAttempt]);
	(0, react.useEffect)(() => {
		if (installPhase !== "ready") return void 0;
		const channel = createDrawioEmbedChannel({
			getFrame: () => frameRef.current,
			onEvent: (event, payload) => {
				if (event === "configure") {
					channel.post("configure", { config: drawioConfig({ compressed: docRef.current.compressed }) });
					return;
				}
				if (event === "init") {
					channel.post("load", {
						xml: docRef.current.xml,
						autosave: 1,
						title: title === "" ? "未命名图纸" : title
					});
					return;
				}
				if (event === "autosave" || event === "save") {
					const xml = payload["xml"];
					if (typeof xml !== "string" || xml === "") return;
					scheduleSave(xml);
					if (event === "save") flush();
					return;
				}
			}
		});
		return () => channel.dispose();
	}, [
		installPhase,
		title,
		scheduleSave,
		flush
	]);
	const reloadFromDisk = (0, react.useCallback)(async () => {
		try {
			applyDocument(await readDiagram(scope, path));
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : String(error));
			setSaveState("failed");
		}
	}, [
		applyDocument,
		scope,
		path
	]);
	const saveAs = (0, react.useCallback)(async () => {
		const name = saveAsName.trim().replace(/\.drawio$/iu, "");
		if (name === "") return;
		try {
			const result = await writeDiagram(scope, `${DIAGRAMS_DIR}/${name}.drawio`, docRef.current.xml);
			setSaveAsOpen(false);
			setSaveAsName("");
			ctx.betterSidebar.openFile(scope, result.path, `${name}.drawio`);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : String(error));
			setSaveState("failed");
		}
	}, [
		ctx,
		scope,
		saveAsName
	]);
	if (installPhase !== "ready") {
		if (installPhase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Panel, { children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "编辑器资源不可用" }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					opacity: .8,
					wordBreak: "break-word"
				},
				children: installError ?? "未知错误"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					opacity: .6,
					fontSize: 12
				},
				children: "首次使用需要从 GitHub 下载 draw.io 资源包（约 51 MB）并解压到本机 DSH 存储目录。请检查网络后重试。"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => setInstallAttempt((value) => value + 1),
				style: BUTTON_STYLE,
				children: "重试"
			}) })
		] });
		const ratio = status !== null && status.total > 0 ? Math.min(1, status.received / status.total) : 0;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Panel, { children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "首次使用：正在准备图表编辑器" }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { opacity: .85 },
				children: progressText(status)
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					height: 6,
					borderRadius: 3,
					background: "rgba(127,127,127,0.25)",
					overflow: "hidden"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
					height: "100%",
					width: `${String(Math.round(ratio * 100))}%`,
					background: "currentColor",
					opacity: .55,
					transition: "width 200ms linear"
				} })
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					opacity: .55,
					fontSize: 12
				},
				children: "draw.io 资源包只下载一次，之后完全离线。图纸始终以 `.drawio` 文件保存在当前工作区。"
			})
		] });
	}
	const saveLabel = saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : saveState === "failed" ? "保存失败" : dirty ? "未保存" : "已同步";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			height: "100%",
			minHeight: 0
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "4px 8px",
					fontSize: 12,
					borderBottom: "1px solid rgba(127,127,127,0.25)"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { fontWeight: 600 },
						children: "图表编辑器"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							flex: 1,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap"
						},
						title: doc.path,
						children: doc.relativePath === "" ? doc.path : doc.relativePath
					}),
					doc.compressed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { opacity: .55 },
						children: "压缩存储"
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { opacity: saveState === "failed" ? 1 : .7 },
						children: saveLabel
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => void flush(),
						style: BUTTON_STYLE,
						children: "保存"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => setSaveAsOpen((value) => !value),
						style: BUTTON_STYLE,
						children: "另存为"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => void reloadFromDisk(),
						style: BUTTON_STYLE,
						children: "重新加载"
					})
				]
			}),
			conflict !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "6px 8px",
					fontSize: 12,
					background: "rgba(229,83,75,0.14)",
					display: "flex",
					gap: 8,
					alignItems: "center",
					flexWrap: "wrap"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: { flex: 1 },
						children: [
							"⚠ ",
							conflict.message,
							"本地改动尚未写入磁盘。"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => void reloadFromDisk(),
						style: BUTTON_STYLE,
						children: "放弃本地改动，读磁盘"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => void flush({ force: true }),
						style: BUTTON_STYLE,
						children: "用我的版本覆盖"
					})
				]
			}) : null,
			saveAsOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "6px 8px",
					fontSize: 12,
					background: "rgba(127,127,127,0.12)",
					display: "flex",
					gap: 8,
					alignItems: "center"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
						"另存到 ",
						DIAGRAMS_DIR,
						"/"
					] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						value: saveAsName,
						onChange: (event) => setSaveAsName(event.target.value),
						placeholder: "文件名",
						style: {
							font: "inherit",
							padding: "2px 6px",
							flex: 1,
							minWidth: 80
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: ".drawio" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => void saveAs(),
						disabled: saveAsName.trim() === "",
						style: BUTTON_STYLE,
						children: "确定"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => setSaveAsOpen(false),
						style: BUTTON_STYLE,
						children: "取消"
					})
				]
			}) : null,
			saveError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "6px 8px",
					fontSize: 12,
					background: "rgba(229,83,75,0.14)"
				},
				children: ["⚠ ", saveError]
			}) : null,
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
				ref: frameRef,
				src: DRAWIO_EMBED_URL,
				title: `图表编辑器：${title}`,
				style: {
					flex: 1,
					width: "100%",
					minHeight: 0,
					border: 0,
					background: "#ffffff"
				}
			}, editorKey)
		]
	});
}

//#endregion
//#region src/client/index.tsx
/**
* Client-half plugin: register a `.drawio` file previewer on the
* dsh-better-sidebar service. `inject` holds *cordis service names* — do not
* confuse it with `dsh.client.inject` in package.json, which holds package
* names and only controls client-bundle arrival order.
*/
const inject = ["betterSidebar"];
/** Namespaced so it can never collide with a builtin viewer id. */
const DIAGRAM_VIEWER_ID = "dsh-drawio:diagram";
const VIEWER_TITLE = "图表编辑器";
/**
* Load a diagram through our own fenced host route.
*
* `fetchStrategy: 'custom'` means the sidebar calls this and renders the
* component with the resolved value as `customData`; a rejection becomes the
* sidebar's own error panel. A missing file is therefore NOT an error here —
* it is a state the viewer turns into a "create it?" affordance.
*/
async function loadDiagram(path, scope, signal) {
	try {
		return {
			kind: "ready",
			diagram: await readDiagram(scope, path, signal)
		};
	} catch (error) {
		if (error instanceof DrawioApiError && error.status === 404) return {
			kind: "missing",
			path
		};
		throw error;
	}
}
/** The descriptor handed to `ctx.betterSidebar.registerFileViewer`. */
function createDiagramViewerDescriptor() {
	return {
		id: DIAGRAM_VIEWER_ID,
		title: VIEWER_TITLE,
		exts: ["drawio", "dio"],
		priority: 0,
		fetchStrategy: "custom",
		load: (path, scope, signal) => loadDiagram(path, scope, signal),
		component: (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiagramViewer, { ...props })
	};
}
function apply(ctx) {
	ctx.effect(() => ctx.betterSidebar.registerFileViewer(createDiagramViewerDescriptor()));
}

//#endregion
exports.DIAGRAM_VIEWER_ID = DIAGRAM_VIEWER_ID;
exports.apply = apply;
exports.createDiagramViewerDescriptor = createDiagramViewerDescriptor;
exports.inject = inject;
exports.loadDiagram = loadDiagram;
return module.exports; } });
//# sourceMappingURL=client.js.map