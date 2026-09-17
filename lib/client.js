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
/** Deployment configuration for this browser session. */
function fetchConfig(signal) {
	return request("/drawio/api/config", {}, "GET", signal);
}
let cachedConfig;
/**
* Process-wide memo of {@link fetchConfig}. The configuration is deployment
* static (only a restart can change it), and every open editor tab would
* otherwise re-request it. A failure clears the memo so a retry can succeed.
*/
function clientConfig() {
	cachedConfig ??= fetchConfig().catch((error) => {
		cachedConfig = void 0;
		throw error;
	});
	return cachedConfig;
}
/**
* Create a blank diagram — the next free `<name>-N.drawio` in the configured
* diagrams directory, or exactly at `path` when one is given.
*/
function createDiagram(scope, options = {}) {
	return request("/drawio/api/create", {
		...scopeBody(scope),
		...options
	});
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
/** Editor document URL on this origin, used when no `editorUrl` escape hatch is set. */
const DRAWIO_EMBED_PATH = "/drawio/webapp/index.html";
/**
* Build the editor URL.
*
* `embed=1&proto=json` switches drawio to its postMessage transport.
* `spin=1` is drawio's own loading spinner, `configure=1` makes it wait for our
* configure reply before initialising, `stealth=1` + `suppressNewWindows=1`
* keep it from sprouting chrome or popups, and `lang` localises the UI.
*/
function drawioEmbedUrl(options) {
	return `${DRAWIO_EMBED_PATH}?${[
		"embed=1",
		"proto=json",
		"spin=1",
		`ui=${encodeURIComponent(options.uiTheme)}`,
		"libraries=1",
		"configure=1",
		"plugins=0",
		"stealth=1",
		"suppressNewWindows=1",
		`lang=${encodeURIComponent(options.language)}`
	].join("&")}`;
}
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
		autosaveDelay: options.autosaveDelayMs,
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
/** Below this the editor collapses its own side panels, which the user should know about. */
const NARROW_PANE_PX = 760;
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
/** Last-resort error surface with a retry, used by every failed phase. */
function FailurePanel(props) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Panel, { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: props.title }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: {
				opacity: .8,
				wordBreak: "break-word"
			},
			children: props.message
		}),
		props.hint === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: {
				opacity: .6,
				fontSize: 12
			},
			children: props.hint
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			onClick: props.onRetry,
			style: BUTTON_STYLE,
			children: "重试"
		}) })
	] });
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
	if (payload.kind === "missing") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MissingDiagram, {
		ctx: props.ctx,
		scope: props.scope,
		path: payload.path,
		title: props.title
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EditorPane, {
		ctx: props.ctx,
		scope: props.scope,
		path: props.path,
		title: props.title,
		initial: payload.diagram
	});
}
/**
* Cold start entry (B): the path the user opened does not exist.
*
* The sidebar reports this through our own `load()` rather than as an error, so
* here it becomes an offer to create the file — which is what makes "type a new
* path into the editor tab" a usable creation flow.
*/
function MissingDiagram(props) {
	const { ctx, scope, path, title } = props;
	const [created, setCreated] = (0, react.useState)(null);
	const [busy, setBusy] = (0, react.useState)(false);
	const [error, setError] = (0, react.useState)(null);
	const create = (0, react.useCallback)(async () => {
		setBusy(true);
		setError(null);
		try {
			setCreated(await createDiagram(scope, { path }));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	}, [path, scope]);
	if (created !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EditorPane, {
		ctx,
		scope,
		path: created.path,
		title,
		initial: created
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Panel, { children: [
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "此文件不存在" }),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: {
				opacity: .8,
				wordBreak: "break-all"
			},
			children: path
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			style: { opacity: .7 },
			children: "可以在这里把它创建为一张空白图纸，之后照常编辑并自动保存。"
		}),
		/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
			type: "button",
			onClick: () => void create(),
			disabled: busy,
			style: BUTTON_STYLE,
			children: busy ? "创建中…" : "创建为空白图纸"
		}) }),
		error === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: { color: "#e5534b" },
			children: ["⚠ ", error]
		})
	] });
}
function EditorPane(props) {
	const { ctx, scope, path, title, initial } = props;
	const [config, setConfig] = (0, react.useState)(null);
	const [configError, setConfigError] = (0, react.useState)(null);
	const [configAttempt, setConfigAttempt] = (0, react.useState)(0);
	const [phase, setPhase] = (0, react.useState)("config");
	const [status, setStatus] = (0, react.useState)(null);
	const [error, setError] = (0, react.useState)(null);
	const [installAttempt, setInstallAttempt] = (0, react.useState)(0);
	const [doc, setDoc] = (0, react.useState)(initial);
	const [dirty, setDirty] = (0, react.useState)(false);
	const [saveState, setSaveState] = (0, react.useState)("idle");
	const [saveError, setSaveError] = (0, react.useState)(null);
	const [conflict, setConflict] = (0, react.useState)(null);
	const [editorKey, setEditorKey] = (0, react.useState)(0);
	const [saveAsOpen, setSaveAsOpen] = (0, react.useState)(false);
	const [saveAsName, setSaveAsName] = (0, react.useState)("");
	const [narrow, setNarrow] = (0, react.useState)(false);
	const frameRef = (0, react.useRef)(null);
	const rootRef = (0, react.useRef)(null);
	const docRef = (0, react.useRef)(initial);
	const configRef = (0, react.useRef)(null);
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
	(0, react.useEffect)(() => {
		let cancelled = false;
		setConfigError(null);
		clientConfig().then((value) => {
			if (cancelled) return;
			configRef.current = value;
			setConfig(value);
		}).catch((caught) => {
			if (cancelled) return;
			setConfigError(caught instanceof Error ? caught.message : String(caught));
			setPhase("error");
		});
		return () => {
			cancelled = true;
		};
	}, [configAttempt]);
	(0, react.useEffect)(() => {
		const element = rootRef.current;
		if (element === null || typeof ResizeObserver === "undefined") return void 0;
		const observer = new ResizeObserver(() => {
			setNarrow(element.getBoundingClientRect().width < NARROW_PANE_PX);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
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
		} catch (caught) {
			if (caught instanceof DrawioApiError && caught.isConflict) {
				const current = caught.details?.["currentMtimeMs"];
				setConflict({
					message: caught.message,
					currentMtimeMs: typeof current === "number" ? current : null
				});
				pausedRef.current = true;
				setSaveState("failed");
			} else {
				setSaveError(caught instanceof Error ? caught.message : String(caught));
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
		}, configRef.current?.writeDebounceMs ?? 1500);
	}, [flush]);
	(0, react.useEffect)(() => () => {
		if (timerRef.current !== null) globalThis.clearTimeout(timerRef.current);
		if (pendingRef.current !== null && !pausedRef.current) flush();
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
		if (config === null) return void 0;
		if (config.editorUrl !== "") {
			setPhase("ready");
			return;
		}
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
					setError(null);
					setPhase("ready");
					return;
				}
				if (snapshot.phase === "error") {
					setError(snapshot.message ?? "编辑器资源安装失败");
					setPhase("error");
					return;
				}
				setPhase("installing");
				timer = globalThis.setTimeout(() => {
					tick();
				}, POLL_INTERVAL_MS);
			} catch (caught) {
				if (cancelled || controller.signal.aborted) return;
				setError(caught instanceof Error ? caught.message : String(caught));
				setPhase("error");
			}
		};
		setPhase("probing");
		setError(null);
		tick();
		return () => {
			cancelled = true;
			controller.abort();
			if (timer !== void 0) globalThis.clearTimeout(timer);
		};
	}, [config, installAttempt]);
	(0, react.useEffect)(() => {
		if (phase !== "ready") return void 0;
		const channel = createDrawioEmbedChannel({
			getFrame: () => frameRef.current,
			onEvent: (event, payload) => {
				if (event === "configure") {
					channel.post("configure", { config: drawioConfig({
						compressed: docRef.current.compressed,
						autosaveDelayMs: configRef.current?.autosaveDelayMs ?? 1500
					}) });
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
		phase,
		title,
		scheduleSave,
		flush
	]);
	const reloadFromDisk = (0, react.useCallback)(async () => {
		try {
			applyDocument(await readDiagram(scope, path));
		} catch (caught) {
			setSaveError(caught instanceof Error ? caught.message : String(caught));
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
		const directory = configRef.current?.diagramsDir ?? "docs/diagrams";
		try {
			await writeDiagram(scope, `${directory}/${name}.drawio`, docRef.current.xml);
			setSaveAsOpen(false);
			setSaveAsName("");
			ctx.betterSidebar.openFile(scope, `${directory}/${name}.drawio`);
		} catch (caught) {
			setSaveError(caught instanceof Error ? caught.message : String(caught));
			setSaveState("failed");
		}
	}, [
		ctx,
		scope,
		saveAsName
	]);
	const newDiagram = (0, react.useCallback)(async () => {
		try {
			const created = await createDiagram(scope);
			ctx.betterSidebar.openFile(scope, created.relativePath);
		} catch (caught) {
			setSaveError(caught instanceof Error ? caught.message : String(caught));
			setSaveState("failed");
		}
	}, [ctx, scope]);
	if (configError !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FailurePanel, {
		title: "无法读取插件配置",
		message: configError,
		hint: "dsh-drawio 的主机接口没有应答。请确认插件已挂载，然后重试。",
		onRetry: () => setConfigAttempt((value) => value + 1)
	});
	if (phase !== "ready") {
		if (phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FailurePanel, {
			title: "编辑器资源不可用",
			message: error ?? "未知错误",
			hint: "首次使用需要从 GitHub 下载 draw.io 资源包（约 51 MB）并解压到本机 DSH 存储目录。请检查网络后重试。",
			onRetry: () => setInstallAttempt((value) => value + 1)
		});
		const ratio = status !== null && status.total > 0 ? Math.min(1, status.received / status.total) : 0;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Panel, { children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: phase === "config" || phase === "probing" ? "正在准备图表编辑器" : "首次使用：正在准备图表编辑器" }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: { opacity: .85 },
				children: phase === "config" ? "正在读取插件配置…" : progressText(status)
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
	const saveLabel = conflict !== null ? "有冲突" : saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : saveState === "failed" ? "保存失败" : dirty ? "未保存" : "已同步";
	const diagramsDir = config?.diagramsDir ?? "docs/diagrams";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		ref: rootRef,
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
						onClick: () => void newDiagram(),
						style: BUTTON_STYLE,
						children: "新建"
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
			narrow ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: "3px 8px",
					fontSize: 11,
					opacity: .6,
					borderBottom: "1px solid rgba(127,127,127,0.18)"
				},
				children: "侧边栏较窄时 draw.io 会收起形状/格式面板 —— 把本标签页拖到主会话区域即可变成可缩放的悬浮窗口。"
			}) : null,
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
							"；本地改动尚未写入磁盘。"
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
						diagramsDir,
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
				src: config?.editorUrl !== void 0 && config.editorUrl !== "" ? config.editorUrl : drawioEmbedUrl({
					uiTheme: config?.uiTheme ?? "kennedy",
					language: config?.language ?? "zh"
				}),
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
//#region src/client/NewDiagramButton.tsx
/**
* Cold start entry (A): a 「新建图纸」 button in the **official** left sidebar's
* footer slot.
*
* Without this a fresh workspace has no way in at all — the `.drawio` file
* viewer only appears once a `.drawio` exists. `sidebar.footer.action` is a
* `list`-kind slot declared by `@deepseek-ai/dsh-client-ui-sidebar`, and it is
* the only additive seat the official sidebar offers.
*
* The active session comes from the sidebar service snapshot rather than from
* slot props: the slot is `scope: 'root'`, so its owner props carry no session,
* and `getSnapshot().sessionId` is exactly what better-sidebar itself uses.
*/
/** The slot this button occupies. */
const FOOTER_ACTION_SLOT = "sidebar.footer.action";
/**
* Sizing taken from the official footer entry this button sits next to.
*
* The 设置 row (`ui-settings-general`'s `.trigger`) is **42px high and full
* width in the expanded column, and a 36x36 circle in the rail**, with a 16x16
* glyph when expanded and 18x18 when collapsed (`IconSettingsOutline16` /
* `IconSettingsOutline14`), and it drops its label text in the rail. The slot
* owner hands us exactly that state as the `wide` prop, so we mirror it rather
* than pick our own numbers.
*/
const RAIL_ROW_HEIGHT_PX = 42;
const RAIL_BUTTON_PX = 36;
const RAIL_ICON_PX_WIDE = 16;
const RAIL_ICON_PX_NARROW = 18;
/** Visible only in the expanded column, like the settings row's own label. */
const RAIL_LABEL = "画布";
/**
* Hover state needs a real CSS rule: inline styles outrank class selectors, so
* the base background has to live in the same sheet as the `:hover` one.
*/
const RAIL_STYLE_ID = "dsh-drawio-rail-entry";
const RAIL_STYLE_RULES = [".dsh-drawio-rail-entry{background:transparent}", ".dsh-drawio-rail-entry:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}"].join("");
function ensureRailStyles() {
	if (typeof document === "undefined" || document.getElementById(RAIL_STYLE_ID) !== null) return;
	const style = document.createElement("style");
	style.id = RAIL_STYLE_ID;
	style.textContent = RAIL_STYLE_RULES;
	document.head.append(style);
}
function activeScope(ctx) {
	try {
		const sessionId = ctx.betterSidebar.getSnapshot().sessionId;
		return typeof sessionId === "string" && sessionId !== "" ? { sessionId } : void 0;
	} catch {
		return;
	}
}
/**
* Icon-only glyph, drawn in the rail's own 16-unit viewBox and sized to match
* whatever the settings icon currently uses.
*/
function NewDiagramIcon({ size }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		"aria-hidden": "true",
		style: {
			flex: "0 0 auto",
			display: "block"
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
				x: "1.75",
				y: "1.75",
				width: "6",
				height: "4.5",
				rx: "1",
				stroke: "currentColor",
				strokeWidth: "1.5"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
				x: "8.25",
				y: "9.75",
				width: "6",
				height: "4.5",
				rx: "1",
				stroke: "currentColor",
				strokeWidth: "1.5"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
				d: "M4.75 6.25v3.5a1 1 0 0 0 1 1h2.5",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round"
			})
		]
	});
}
function NewDiagramButton({ ctx, wide = true }) {
	const [scope, setScope] = (0, react.useState)(() => activeScope(ctx));
	const [busy, setBusy] = (0, react.useState)(false);
	const [error, setError] = (0, react.useState)(null);
	(0, react.useEffect)(() => {
		ensureRailStyles();
		const sync = () => {
			setScope(activeScope(ctx));
		};
		sync();
		return ctx.betterSidebar.subscribeState(sync);
	}, [ctx]);
	const create = (0, react.useCallback)(async () => {
		if (scope === void 0 || busy) return;
		setBusy(true);
		setError(null);
		try {
			const created = await createDiagram(scope);
			ctx.betterSidebar.openFile(scope, created.relativePath);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	}, [
		busy,
		ctx,
		scope
	]);
	const disabled = scope === void 0 || busy;
	const title = scope === void 0 ? "新建图纸：当前没有活跃会话，无法确定工作区" : error !== null ? `新建图纸失败：${error}` : `新建图纸：在当前工作区新建一张空白图纸`;
	const wideStyle = {
		boxSizing: "border-box",
		display: "flex",
		alignItems: "center",
		gap: 8,
		flex: "none",
		width: "calc(100% + 4px)",
		height: RAIL_ROW_HEIGHT_PX,
		margin: "4px -2px",
		padding: "0 10px 0 8px",
		border: "none",
		borderRadius: 12,
		overflow: "hidden",
		color: error !== null ? "#e5534b" : "var(--dsw-alias-label-primary, inherit)",
		fontFamily: "inherit",
		fontSize: 14,
		lineHeight: "22px",
		fontWeight: 400,
		textAlign: "left",
		cursor: disabled ? "not-allowed" : "pointer",
		opacity: disabled ? .45 : 1
	};
	const narrowStyle = {
		boxSizing: "border-box",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		flex: "none",
		width: RAIL_BUTTON_PX,
		height: RAIL_BUTTON_PX,
		margin: "8px 0 10px",
		padding: 0,
		border: "none",
		borderRadius: "50%",
		color: error !== null ? "#e5534b" : "var(--dsw-alias-label-primary, inherit)",
		font: "inherit",
		cursor: disabled ? "not-allowed" : "pointer",
		opacity: disabled ? .45 : 1
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		type: "button",
		className: "dsh-drawio-rail-entry",
		onClick: () => {
			create();
		},
		disabled,
		title,
		"aria-label": "新建图纸",
		"aria-busy": busy,
		style: wide ? wideStyle : narrowStyle,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NewDiagramIcon, { size: wide ? RAIL_ICON_PX_WIDE : RAIL_ICON_PX_NARROW }), wide ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			style: {
				whiteSpace: "nowrap",
				overflow: "hidden"
			},
			children: RAIL_LABEL
		}) : null]
	});
}

//#endregion
//#region src/client/index.tsx
/**
* Client-half plugin.
*
* `inject` holds *cordis service names* — do not confuse it with
* `dsh.client.inject` in package.json, which holds package names and only
* controls client-bundle arrival order. `slots` is the UI slot registry the
* official sidebar declares `sidebar.footer.action` on.
*/
const inject = ["betterSidebar", "slots"];
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
	const slots = ctx.slots;
	if (slots === void 0) return;
	ctx.effect(() => slots.inject(FOOTER_ACTION_SLOT, () => slots.register({
		name: FOOTER_ACTION_SLOT,
		id: "dsh-drawio:new-diagram",
		order: 100,
		registrant: "dsh-drawio"
	}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NewDiagramButton, {
		ctx,
		wide: props?.wide !== false
	}))));
}

//#endregion
exports.DIAGRAM_VIEWER_ID = DIAGRAM_VIEWER_ID;
exports.apply = apply;
exports.createDiagramViewerDescriptor = createDiagramViewerDescriptor;
exports.inject = inject;
exports.loadDiagram = loadDiagram;
return module.exports; } });
//# sourceMappingURL=client.js.map