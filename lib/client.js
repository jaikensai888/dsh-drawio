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
* P0 placeholder: proves the viewer wins the `.drawio` file match. P1 replaces
* the body with the real drawio iframe (which must NOT carry a `sandbox`
* attribute — drawio dies silently without `allow-same-origin`).
*/
function DiagramViewer({ path, title, viewerId, scope }) {
	const [probe, setProbe] = (0, react.useState)("未检查");
	const ping = async () => {
		setProbe("检查中…");
		try {
			const response = await fetch("/drawio/ping", { headers: { accept: "application/json" } });
			const body = await response.text();
			setProbe(`${response.status} ${body}`);
		} catch (error) {
			setProbe(`失败：${error instanceof Error ? error.message : String(error)}`);
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		style: {
			display: "flex",
			flexDirection: "column",
			gap: 10,
			padding: 14,
			height: "100%",
			boxSizing: "border-box",
			overflow: "auto",
			font: "13px/1.6 system-ui, -apple-system, \"Segoe UI\", \"Microsoft YaHei\", sans-serif"
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					fontSize: 12,
					opacity: .65
				},
				children: [VIEWER_TITLE, " · dsh-drawio（P0 骨架）"]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 26,
					fontWeight: 600,
					letterSpacing: 1
				},
				children: "hello"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
				style: {
					margin: 0,
					display: "grid",
					gridTemplateColumns: "auto 1fr",
					gap: "4px 10px",
					opacity: .85
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
						style: { opacity: .6 },
						children: "文件"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						style: {
							margin: 0,
							wordBreak: "break-all"
						},
						children: path
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
						style: { opacity: .6 },
						children: "标题"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						style: { margin: 0 },
						children: title
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
						style: { opacity: .6 },
						children: "viewer"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						style: { margin: 0 },
						children: viewerId
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
						style: { opacity: .6 },
						children: "会话"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						style: { margin: 0 },
						children: scope.sessionId
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", {
						style: { opacity: .6 },
						children: "cwd"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", {
						style: {
							margin: 0,
							wordBreak: "break-all"
						},
						children: scope.cwd ?? "(未提供，以 host 侧为准)"
					})
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => void ping(),
				style: {
					font: "inherit",
					padding: "4px 10px",
					cursor: "pointer"
				},
				children: "检查 host 路由"
			}) }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				style: {
					margin: 0,
					padding: 8,
					borderRadius: 4,
					background: "rgba(127,127,127,0.14)",
					whiteSpace: "pre-wrap",
					wordBreak: "break-all"
				},
				children: probe
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 12,
					opacity: .55
				},
				children: "P0 只验证管线：`dsh` 字段契约、`exports[\"./client\"]`、`__ModuleLoader__` 包装、 `dsh plugin add` 的 bundle reconcile、client 半能否拿到 `ctx.betterSidebar`。"
			})
		]
	});
}
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