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
async function request(path, init) {
	const response = await fetch(path, {
		headers: { accept: "application/json" },
		...init
	});
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error(`接口 ${path} 返回的不是 JSON（HTTP ${String(response.status)}）`);
	}
	if (body.ok !== true || body.value === void 0) throw new Error(body.error?.message ?? `接口 ${path} 失败（HTTP ${String(response.status)}）`);
	return body.value;
}
/** Readiness + download progress of the self-hosted editor. */
function fetchWebappStatus() {
	return request("/drawio/api/webapp-status");
}
/** Start (or join) the one-time editor download and report progress. */
function startWebappInstall() {
	return request("/drawio/api/webapp-status", { method: "POST" });
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
*/
const DRAWIO_CONFIG = {
	lockdown: true,
	plugins: [],
	compressXml: false,
	autosaveDelay: 1500,
	preserveViewState: true,
	noAutoFocus: true,
	compact: true,
	hideMenuItems: ["plugins", "print"]
};
/** Minimal valid `.drawio` document, used until P2 wires real file reads. */
const EMPTY_DIAGRAM_XML = [
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
const FONT = "13px/1.6 system-ui, -apple-system, \"Segoe UI\", \"Microsoft YaHei\", sans-serif";
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
function DiagramViewer({ path, title }) {
	const [phase, setPhase] = (0, react.useState)("probing");
	const [status, setStatus] = (0, react.useState)(null);
	const [error, setError] = (0, react.useState)(null);
	const [reloadKey, setReloadKey] = (0, react.useState)(0);
	const frameRef = (0, react.useRef)(null);
	const channelRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		let cancelled = false;
		let timer;
		let started = false;
		const schedule = () => {
			timer = globalThis.setTimeout(() => {
				tick();
			}, POLL_INTERVAL_MS);
		};
		const tick = async () => {
			try {
				const snapshot = started ? await fetchWebappStatus() : await startWebappInstall();
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
				schedule();
			} catch (caught) {
				if (cancelled) return;
				setError(caught instanceof Error ? caught.message : String(caught));
				setPhase("error");
			}
		};
		setPhase("probing");
		setError(null);
		tick();
		return () => {
			cancelled = true;
			if (timer !== void 0) globalThis.clearTimeout(timer);
		};
	}, [reloadKey]);
	(0, react.useEffect)(() => {
		if (phase !== "ready") return void 0;
		const channel = createDrawioEmbedChannel({
			getFrame: () => frameRef.current,
			onEvent: (event, _payload) => {
				if (event === "configure") {
					channel.post("configure", { config: DRAWIO_CONFIG });
					return;
				}
				if (event === "init") channel.post("load", {
					xml: EMPTY_DIAGRAM_XML,
					autosave: 1,
					title: title === "" ? "未命名图纸" : title
				});
			}
		});
		channelRef.current = channel;
		return () => {
			channel.dispose();
			channelRef.current = null;
		};
	}, [phase, title]);
	if (phase === "ready") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			height: "100%",
			minHeight: 0
		},
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "4px 8px",
				fontSize: 12,
				opacity: .75,
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
					title: path,
					children: path
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: () => {
						setReloadKey((value) => value + 1);
					},
					style: {
						font: "inherit",
						padding: "2px 8px",
						cursor: "pointer"
					},
					children: "重新加载"
				})
			]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
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
		})]
	});
	if (phase === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			padding: 16,
			font: FONT,
			display: "flex",
			flexDirection: "column",
			gap: 10
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 14,
					fontWeight: 600
				},
				children: "编辑器资源不可用"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					opacity: .8,
					wordBreak: "break-word"
				},
				children: error ?? "未知错误"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					opacity: .6,
					fontSize: 12
				},
				children: "首次使用需要从 GitHub 下载 draw.io 资源包（约 51 MB），并解压到本机 DSH 存储目录。请检查网络后重试。"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => {
					setReloadKey((value) => value + 1);
				},
				style: {
					font: "inherit",
					padding: "4px 10px",
					cursor: "pointer"
				},
				children: "重试"
			}) })
		]
	});
	const ratio = status !== null && status.total > 0 ? Math.min(1, status.received / status.total) : 0;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			padding: 16,
			font: FONT,
			display: "flex",
			flexDirection: "column",
			gap: 12
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 14,
					fontWeight: 600
				},
				children: "首次使用：正在准备图表编辑器"
			}),
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
/** The descriptor handed to `ctx.betterSidebar.registerFileViewer`. */
function createDiagramViewerDescriptor() {
	return {
		id: DIAGRAM_VIEWER_ID,
		title: VIEWER_TITLE,
		exts: ["drawio", "dio"],
		priority: 0,
		fetchStrategy: "none",
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
return module.exports; } });
//# sourceMappingURL=client.js.map