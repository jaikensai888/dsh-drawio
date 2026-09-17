# GROUND-TRUTH — 已核实的事实与踩坑清单

> 本文是 `dsh-drawio` 的**施工前事实基线**。所有条目都在本机真实环境里读过源码/跑过命令核对，
> 目的是让新会话**不必重新调研**，也**不要重新踩坑**。
> 标注 `[实测]` 的是我实际执行验证过的；`[源码]` 的是从源码读出的；`[未验证]` 的必须自己再确认。

环境时间基准：2026-09-17。DSH Desktop `2.0.4`，`@deepseek-ai/*` = `0.1.2-alpha.1`。

---

## 0. 一句话结论

要加一个"侧边栏里的 draw.io 编辑器 + 工作区级图纸读写"，**唯一可行的路径**是：

> 写一个第三方 DSH 插件（host 半 = HTTP 路由 + 文件读写，client 半 = 通过
> `ctx.betterSidebar.registerFileViewer` 注册 `.drawio` 预览器），
> 编辑器本体用**自托管**的 drawio webapp 塞进 iframe，数据走 postMessage。

已有一个完整的同构蓝图可以直接抄：`G:\claude_project\code-agent\dsh-skillui`。

---

## 1. 环境事实

### 1.1 目标 profile 是 `desktop`，不是 `web` `[实测]`

`C:\Users\jaike\AppData\Roaming\DSH Desktop\host-commands\desktop\bin\dsh.cmd`：

```bat
set "ELECTRON_RUN_AS_NODE=1"
set "DSH_DESKTOP_DEFAULT_PROFILE=desktop"
set "DSH_HOME=C:\Users\jaike\.dsh"
"E:\DSH\DSH Desktop\DSH Desktop.exe" --expose-internals "E:\DSH\DSH Desktop\resources\app.asar\lib\desktop-cli.js" %*
```

`C:\Users\jaike\.dsh\profiles\desktop\package.json`：

```json
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",
                  "dsh-better-sidebar", "dsh-skillui", "@wenaixi/dsh-superpower"],
      "patchReload": "live"
    }
  },
  "dependencies": {
    "@wenaixi/dsh-superpower": "6.3.1",
    "dsh-better-sidebar": "0.17.1",
    "dsh-skillui": "link:G:/claude_project/code-agent/dsh-skillui"
  }
}
```

> ⚠️ `profiles/web/` 也存在（只有 `dsh-better-sidebar@0.14.0`），但**运行中的 GUI 用的是 `desktop`**。
> 所有安装/调试命令都要带 `--profile desktop`。

### 1.2 关键路径

| 用途 | 路径 |
|---|---|
| DSH home | `C:\Users\jaike\.dsh` |
| 目标 profile | `C:\Users\jaike\.dsh\profiles\desktop` |
| 已装插件 | `C:\Users\jaike\.dsh\profiles\desktop\node_modules\dsh-better-sidebar` (0.17.1) |
| **蓝图插件（完整 host+client 源码）** | `G:\claude_project\code-agent\dsh-skillui` |
| DSH 桌面壳 checkout | `E:\DSH\DSH Desktop\resources\app.asar.unpacked` |
| `@deepseek-ai/*` 发行包 | `<checkout>\node_modules\@deepseek-ai\`（**不含 `.d.ts`**） |
| 本插件开发目录 | `G:\claude_project\code-agent\dsh-drawio` |
| 本地 `dsh` CLI | `C:\Users\jaike\AppData\Roaming\DSH Desktop\host-commands\desktop\bin\dsh.cmd` |
| 运行中的 GUI | `http://127.0.0.1:43120`（浏览器直接访问；探活返回 401 属正常，那是信任围栏） |

### 1.3 工具链 `[实测]`

```
node   v24.11.1
npm    11.6.2
pnpm   11.8.0
git    2.37.0.windows.1
gh     ✗ 未安装
```

git 身份：`wengjuntao <jaikensai888@qq.com>`；系统级 `credential.helper = manager-core`（Git Credential Manager），HTTPS push 走 GCM。

### 1.4 沙箱 `[实测]`

当前 DSH 会话文件策略是 `workspace-write`，工作区 = 会话 cwd。
**往会话工作区之外写文件会被沙箱拒绝**（实测探针被拒）。
新会话请把工作区设为 `G:\claude_project\code-agent\dsh-drawio`，否则无法落盘。

---

## 2. DSH 插件包契约

### 2.1 `package.json` 的三个 `dsh` 字段 `[源码]`

```jsonc
{
  "main": "lib/index.js",              // host 半入口
  "exports": {
    ".":        { "types": "./lib/types/index.d.ts",        "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }  // ★ 必需
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },   // 声明本包是 profile bundle 层
    "client": {
      "platform": "web",                            // ★ 必需，且只认 "web"
      "inject": ["@deepseek-ai/dsh-client-ui-slots", "dsh-better-sidebar"],
      "external": [],                               // 基座之外额外 require 的 specifier
      "immediately": false                          // 是否启动时预取
    }
  }
}
```

- `dsh.client.platform` 必须是字符串；**只有 `"web"` 会被扫描**，其他一律跳过。
- 声明了 `dsh.client` 却**没有 `exports["./client"]`** → 组合期直接抛错。
- `dsh.bundle.patch` 是"本包作为 profile 层被挂载"的声明。**没有它，`dsh plugin add` 只当普通依赖装，且会警告**；而且 `dsh-app-boot` 在解析 bundle 时发现缺它会直接抛错。
- **`dsh.host` 不存在**——不要臆造。

### 2.2 双半结构只共享包名 `[源码]`

- **host 半**：由 profile 的 loader 树按包名挂载，走 `main` / `exports["."]`，Node 侧 ESM。
- **client 半**：由 `@deepseek-ai/dsh-client-modules` 扫**已启用的 loader entry**，读 `dsh.client`，产出浏览器 bundle。
- 两者唯一的连接点是**包名**。因此：**host 半必须存在，client 半才会被发现。**

### 2.3 host 半的导出形状 `[源码]`

```ts
export const name = 'dsh-drawio'
export const inject = ['webServer', 'sessions'] as const
export const Config = z.object({ /* schemastery */ })
export function apply(ctx: Context, config?: DrawioConfig): void { /* ... */ }
```

- **规范要求：无 default 导出**；具名 `name` / `inject` / `apply` / 可选 `Config`。
- `inject` 是**硬依赖**，fiber 会等这些服务就绪。
- 可选依赖用 `ctx.inject(['settings'], (sctx) => { ... })`，**不会阻塞挂载**。
- 一切资源用 `ctx.effect(() => { ...; return dispose })` 包裹，fiber 释放时自动回收。
- `Config` 经 schemastery 校验后作为**第二个参数**传给 `apply`。

### 2.4 client 半的导出形状 `[源码]`

```ts
export const inject = ['betterSidebar'] as const
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.betterSidebar.registerFileViewer({ /* ... */ }))
}
```

`inject` 里放的是 **cordis 服务名**（`'betterSidebar'`、`'slots'`），不是包名。
`dsh.client.inject` 里放的是**包名**（决定 bundle 到达顺序）。两者别混。

---

## 3. client bundle 的构建（最容易做错的一环）

### 3.1 目标产物格式 `[源码]`

`lib/client.js` **不是 ESM**，必须是 classic script：

```js
window.__ModuleLoader__.load({
  id: "dsh-drawio",                       // 包名；尾缀 "/client" 会被剥掉
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    /* ...bundle 内容... */
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

- 执行 bundle **只注册 factory**；所有模块副作用（含 CSS 注入）必须在 factory 闭包内、物化时才跑。
- `id` 必须是**包名**。

### 3.2 现成配方：抄 `dsh-skillui/tsdown.config.ts` `[实测]`

```ts
import type { UserConfig } from 'tsdown'

const PACKAGE_ID = 'dsh-drawio'
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

function clientBundle(entryFile: string, moduleId: string): UserConfig {
  return {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,                                   // ★ 见 3.5
    external: CLIENT_EXTERNALS,
    noExternal: (id) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
    outputOptions: {
      entryFileNames: entryFile,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(moduleId)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

export default [
  { entry: { index: 'src/index.ts' }, outDir: 'lib', format: 'esm', platform: 'node', target: 'es2022', dts: false, clean: false },
  clientBundle('client.js', PACKAGE_ID),
] satisfies UserConfig[]
```

> **`banner` + `intro` + `footer` 三件套就是全部魔法**，不要手写包装层。
> 参考配置里 externalize 了 `cordis` 和 `@deepseek-ai/dsh-client-runtime/client`，
> 但**这两个都解析不了**（见 3.3）——我们的 bundle 里只要不 `require` 它们就无害，但别照抄进新代码。

### 3.3 平台模块表只有 8 个可 `require` 的 specifier `[源码]`

```
react
react/jsx-runtime
react-dom
react-dom/client
@deepseek-ai/cordis
@deepseek-ai/dsh-client-store
@deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-ui-primitives
```

- **没有 import map**，是手写的 lazy-CJS 表。表外的 specifier 只有在"已注册的 graph row factory"里才解析得到 —— 而这正是 `dsh.client.inject` 保证的（让依赖方 bundle 先到达）。
- 裸 `cordis` **不在表里**，且本机没装裸 `cordis` 包。要 cordis 就用 `@deepseek-ai/cordis`，**更好的做法是用服务注入**（`inject = ['betterSidebar']`），根本别 require。
- **client 半拿不到任何 config**：boot manifest 每条只有 `{id, inject, immediately}`，boot kernel 以 `create({ name })` 建 entry，**从不写 config**。
  → 用户设置只能走：(a) 自己的 host 路由；(b) better-sidebar 的 `pluginSettings` 缝。

### 3.4 bundle 怎么被服务 `[源码]`

- 走 `/plugins` 前缀路由，但**只认启动 combo URL**（`/plugins/??<id>/client.js,...&rev=<hash>`）。
- **手写 `fetch('/plugins/dsh-drawio/client.js')` 会真 404。** 永远不要硬编码这个 URL。
- 所有产物在 host 内存里留多份快照，并带 `cache-control: public, max-age=31536000, immutable`。
  → **大资源（drawio 的 ~100MB）绝不能进 client bundle**，必须走自己的路由。

### 3.5 Windows 文件锁陷阱 `[源码]`

DSH Desktop 运行时持有 `lib/*.js`。**`rm -rf lib` 会 EPERM 失败。**
→ 因此（且因为要提交构建产物）**build 脚本不要 clean**，靠 `tsdown` 原地覆盖。
这样 client 改动还能被 `dsh-client-hmr`（轮询 `lib/client.js`）热替换，不必退出 DSH。

---

## 4. better-sidebar 的扩展契约（我们是它的 client）

包：`dsh-better-sidebar@0.17.1`（`~/.dsh/profiles/desktop/node_modules/`）。
它同时带 `src/`（原始 TS）与 `lib/types/**/*.d.ts`，**可以读到真实契约**。

### 4.1 服务 `[源码]`

```ts
import type {} from 'dsh-better-sidebar'   // 触发 ctx.betterSidebar 类型合并
export const inject = ['betterSidebar']
```

服务在 client 半由 `ctx.provide('betterSidebar', service)` 发布，通过**双模块增强**
（`declare module 'cordis'` 与 `declare module '@deepseek-ai/cordis'`）暴露类型。

### 4.2 文件预览器契约 `[源码]`

```ts
export type FileFetchStrategy = 'none' | 'fsRead' | 'mediaUrl' | 'custom' | 'binary-download'

export interface FileViewerDescriptor {
  id: string                    // 唯一；用 'dsh-drawio:editor' 这种带命名空间的
  title?: string | (() => string)
  icon?: ReactNode | ((size: number) => ReactNode)
  exts: readonly string[]       // 小写、不带点；[] = catch-all
  priority?: number             // 默认 0，大者先匹配
  fetchStrategy: FileFetchStrategy
  detect?: (path: string, head: Uint8Array) => boolean
  load?: (path: string, scope: SessionScope, signal?: AbortSignal) => Promise<unknown>
  settings?: SidebarSettingsDeclaration
  component: (props: FileViewerProps) => ReactNode   // 必需
}

export interface FileViewerProps {
  ctx: Context; store: SidebarStore; scope: SessionScope
  path: string; title: string; viewerId: string
  content?: string; truncated?: boolean          // fsRead
  mediaUrl?: string                              // mediaUrl
  customData?: unknown                           // custom ← 我们用这个
  /* 其余为内置编辑器内部用，忽略即可 */
}
```

**匹配算法**：按 `priority` 降序（同值按注册序稳定）逐个给机会；每个 descriptor 先试自己的 `detect`（有 head 字节时），再试 `exts`；`exts: []` 是 catch-all，但带 `detect` 的 catch-all 是 **sniff-only**（没 head 就跳过，不能盲吞）。已禁用的 viewer 直接跳过。

**名字必须避开的内置 id**：viewer = `image` / `pdf` / `markdown` / `html` / `code` / `binary-download`；tab = `editor` / `git` / `subagent` / `terminal` / `browser` / `diff`。

**`.drawio` 目前无人认领**，会掉到 `code`（catch-all, priority -100）。我们在默认 priority 0 注册 `exts: ['drawio','dio']` 即自动胜出。

### 4.3 会话 scope 与 cwd `[源码]`

```ts
export interface SessionScope {
  sessionId: string
  cwd?: string          // 可选；权威值在 host 侧
}
```

`TabComponentProps` / `FileViewerProps` 都带 `scope`。要显式解析用 `api.sessionCwd(scope)`。

### 4.4 版本契约稳定性 `[实测]`

我逐条比对了 **0.14.0 与 0.17.1** 的 `lib/types/client/service.d.ts`：
`registerTab` / `registerFileViewer` / `FileViewerDescriptor` / `FileViewerProps` / `openFile`
**完全一致，无 drift**。0.17 新增的 `features` 项：`'floatWindows'`。

### 4.5 ★ `floatWindows`：解决"侧边栏太窄" `[源码]`

v0.16.0+：把标签栏的**任意 tab（内置或插件注册的）拖到主会话区域** →
变成可移动 / 可缩放 / 置顶的**悬浮窗口**（默认 390×780，钳制到视口），拖回侧边栏 pane 即停靠。
`features` 含 `'floatWindows'`；`openTab` 的 dedupe/id 聚焦命中浮动 tab = **置顶**而非重复开。

→ 我们**不需要自己写弹窗**。文档里告诉用户"把编辑器 tab 拖到主会话区域即可放大"。

### 4.6 其它可用 API `[源码]`

```ts
registerFileViewer(descriptor): () => void   // 返回 disposer
openFile(scope, path, title?): void          // 在侧边栏编辑器打开文件 ← 冷启动入口 A/B 要用
matchFileViewer(path, head?): FileViewerDescriptor | undefined
getSnapshot(): SidebarSnapshot               // { sessionId, state, prefs }
subscribeState(listener): () => void
readonly features: readonly string[]         // 能力探测（单调增，永不移除）
settings?: { pluginToggles?, render? }       // 插件自有设置，持久化在 pluginSettings[<id>]
```

**重复注册同一个 id 会抛错**（`tab type "x" already registered`）。

---

## 5. host 侧 API

### 5.1 webserver `[源码]`

服务名 **`ctx.webServer`**（注意大小写），inject token 字符串 **`'webServer'`**。

```ts
ctx.webServer.register({ kind: 'exact' | 'prefix', path: string, handler })
ctx.webServer.registerUpgrade({ path, handler })
ctx.webServer.registerFallback(handler)
ctx.webServer.tapIndex(transform)
ctx.webServer.port / .host
```

- **同一张表内重复 `(kind, path)` 直接抛错**：`webserver: duplicate prefix route "/x"`。
  这会让**整棵插件树启动失败**（`dsh web` 崩），是双挂载的经典症状。
- 匹配顺序：**先精确，再最长前缀，最后 fallback**。
- 前缀是**段边界感知**的：`/drawio` 匹配 `/drawio` 与 `/drawio/x`，**不匹配** `/drawio-other`。
- **没有静态目录 API**、没有 JSON body 助手、没有 sendFile。给你的是裸 `node:http` 的 `req`/`res`，响应生命周期完全自负。
- handler 抛错 → 400（若已发头则 destroy socket），记 warning，**绝不退出进程**。

#### 已被占用的路由（避免撞车）`[源码]`

| kind | path | 归属 |
|---|---|---|
| prefix | `/api` | `dsh-client-connection` RPC 网关 |
| prefix | `/plugins` | `dsh-client-modules` |
| exact | `/plugins/events` | `dsh-client-hmr` SSE |
| prefix | `/sidebar/api` | better-sidebar JSON API |
| prefix | `/sidebar/file` | better-sidebar 媒体路由 |
| prefix | `/sidebar/html` | better-sidebar HTML 预览 |
| prefix | `/sidebar/bundle` | better-sidebar 懒加载 chunk |
| upgrade | `/sidebar/ws/terminal`、`/sidebar/ws/agent-terminals` | better-sidebar |
| upgrade | `/api/remote.mux` | `dsh-api-gateway` |
| **fallback** | — | `dsh-host-frontend-static`（**唯一席位，已被占**） |

**`/drawio` 空闲**，可以用。

### 5.2 会话 → cwd（工作区隔离的基石）`[源码]`

```ts
function sessionCwdOf(ctx: Context, sessionId: string, clientCwd?: string): string {
  const session = ctx.sessions.get(sessionId)
  const headerCwd = session?.header.cwd          // ① 权威
  if (headerCwd !== undefined && headerCwd !== '') return headerCwd
  if (clientCwd !== undefined && clientCwd !== '') {   // ② hydration 兜底
    try { return requireAbsolute(clientCwd) } catch { throw new SidebarError('bad-request', ...) }
  }
  return process.cwd()                            // ③ 最后手段
}
```

- 服务名 `ctx.sessions`；`header.cwd` 在构造时被校验**必须是绝对路径**并被 `deepFreeze`。
- **子会话 fork 时继承父会话 cwd** → 按 cwd 做的图纸作用域自动覆盖 subagent。
- `ctx.sessions.list()` **只返回活跃会话**，拿不到历史工作区列表。

**DSH 里 "workspace" 的准确含义**：`dsh-workspace` 提供的是**持久化的命名目录注册表**，不是权限边界。
服务名 `ctx.workspaceRegistry`，关键方法：

```ts
list(): Workspace[]                              // 持久顺序
get(id): Workspace | undefined
resolveByPath(path): Promise<Workspace | undefined>   // 按 realpath 规范化后精确相等匹配
create(path, title?) / delete(id) / insertBefore(...)
```

- **成员资格是 cwd 与 workspace.path 的规范化精确相等**，子目录**不算**成员。
- `Workspace.status()` 返回 `'ok' | 'missing-dir'`（目录可能已消失）。
- **host 侧没有"当前/活跃 workspace"概念**——那是纯客户端 UI 选择。
- `workspaceRegistry` 依赖 `storageDomain` + `sessionPersistence`，最小组合里可能**不存在** → 用 `ctx.get('workspaceRegistry')` 并降级到 cwd。

**推荐的图纸作用域键**：`workspace?.path ?? realpath(cwd)`。

### 5.3 围栏与路径安全 `[源码]`

**两个不同的东西都叫 "fence"，别混：**

1. **浏览器信任围栏**（DNS-rebinding / 跨站防御，**不是鉴权**）：
   `dsh-client-connection` 不导出它，better-sidebar 只能抄进自己包里，**我们也要抄**。
   ```ts
   export function isTrustedApiRequest(req, trustedHosts: readonly string[]): boolean {
     const host = header(req.headers, 'host'); if (!host) return false
     const hostUrl = parseAuthority(host);    if (!hostUrl) return false
     if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false
     if (header(req.headers, 'sec-fetch-site') === 'cross-site') return false
     const origin = header(req.headers, 'origin'); if (origin === undefined) return true
     try { return new URL(origin).host === hostUrl.host } catch { return false }
   }
   ```
   可信主机列表来自 `ctx.webRuntime.trustedHosts`（需 `inject: ['webRuntime']`，或直接读 live 值）。

2. **文件系统包含检查**（自己写，没有任何框架保证）：
   ```ts
   export function isWithin(base: string, target: string, platform = process.platform): boolean {
     const norm = (v: string) => v.replace(/[\\/]+/g, '/').replace(/\/$/, '')
     const b = norm(base), t = norm(target)
     if (platform === 'win32') {
       const lb = b.toLowerCase(), lt = t.toLowerCase()
       return lt === lb || lt.startsWith(`${lb}/`)
     }
     return t === b || t.startsWith(`${b}/`)
   }
   ```
   - 大小写不敏感（Windows）、容忍混合分隔符。
   - 所有调用方传入的路径先过 `requireAbsolute()`（`path.isAbsolute` + `resolve`，拒绝 `C:foo` 这种盘符相对形式）。

> ⚠️ **better-sidebar 的 `/sidebar/api` JSON 方法并没有应用 `isWithin`**（只有 `/sidebar/file` 和 `/sidebar/html` 应用了）。`fs.read` 还有 512KB 截断、相对路径按 **git 仓库根**解析。
> → **我们不要复用它的 `fs.read`，自己实现带围栏的读写。**

### 5.4 原子写 `[源码]`

`@deepseek-ai/dsh-atomic-write` 导出 `writeFileAtomic(filename, content, options)`：

- `options.mode` **必填**（权限位，让权限决策在每个调用点可见）。
- 同目录随机后缀临时文件 + `wx` 独占创建（拒绝跟随符号链接）+ `rename` 替换。
- 失败自动清理临时文件并重抛。**不做 fsync**；**只支持字符串内容**。
- 另有 `withFileLock(filename, operation, options?)`（`wx` 建 `<file>.lock`，指数退避 20→200ms，默认等 2000ms）。
- 它是**普通库，不是插件**：`import` 用，不能在 yaml 里挂载。

### 5.5 插件配置：两条通道，别混 `[源码]`

| | 部署配置 | 用户设置 |
|---|---|---|
| 来源 | `cordis.patch.yml` 的插件行 `config:` | `~/.dsh/settings.yaml` |
| 机制 | `export const Config`（schemastery），Loader 校验后作 `apply` 第二参 | `ctx.settings.register(ns, schema)` |
| 生效 | 需改 yaml / 重启 | 实时热更新 |

推荐用 `installSettingsSection(ctx, ns, Config, entryConfig, hooks)`：把 `Config` 同时当设置 schema，yaml 行作为 `base` 层。层序 = **schema 默认值 → composition base → 用户文档**。

命名空间规则：`/^[a-z][a-z0-9-]*$/`（小写 kebab-case）。用 `'dsh-drawio'`。

> ⚠️ **schemastery 在这里是非严格的**：`Schema.resolve(..., strict = false)` 会 `merge(result, data)`，
> **未知键会被 merge 进 resolved config 并进入 `describe().user`**。
> → 关键字段用 `.required()`，并像 better-sidebar 那样写一个 `resolveDrawioConfig()` 二次兜底。

> ⚠️ **`ctx.settings.describe()` 没有命名空间白名单**（`exposedNamespaces` 这个机制在整棵树里**不存在**）；
> owner scope 的 `update`/`replace` **不带 revision 守卫**（只有 service 级 `ctx.settings.update(ns, patch, revision)` 带）。
> → 命名空间内容是浏览器可读的，**不要放任何机密**。

### 5.6 其它可选服务

- `ctx.connection.handle('/channel', handler)`：注册一个 prefix RPC 路由，**自带连接层信任围栏与浏览器鉴权**。channel 必须是**单个路径段**（`/^\/[A-Za-z0-9._~-]+$/`，且不能是 `/api`）→ `/drawio` 合法，`/drawio/api` **不合法**。
- `ctx.connection.fetch.register({ path, methods, fetch })`：注册一个**精确路径**的 Fetch 路由，handler 返回 `Response`（可用 `ReadableStream`）。匹配在 `/api` 拦截器之前。先例：`dsh-session-log-export` 的 `/api/session.export`。
- `ctx.fs`（服务名 `'fs'`）：**不是必须的**；better-sidebar 直接用 `node:fs/promises`。`fs-local` 的 `cwd` 只是解析默认值，**不是包含边界**；真正的包含要靠 `dsh-fs-sandbox` + `ctx.sandboxPolicy`，而那是部署级、不是每工作区级。

---

## 6. drawio 集成要点

### 6.1 自托管形态 `[源码/网络核实]`

- 官方仓库 [jgraph/drawio](https://github.com/jgraph/drawio)，**Apache-2.0**。
- 发布物 `draw.war`（GitHub Releases，例如 `v31.4.6` 的 **51.3 MB**）。`.war` 就是 zip。
- **静态服务即可，不需要任何服务端端点**：embed 模式的数据**全部在客户端之间传递**，从不经过 drawio 服务器。`EXPORT_URL = null` 时 PDF 导出走浏览器打印对话框。
- **npm 上没有可打包的 drawio 编辑器**（`@drawio/editor`、`@drawio/drawio`、`@drawio/embed`、`drawio-editor`、`@jgraph/drawio` 全部 404）。唯一的 `@drawio/*` 是 `@drawio/mcp`（MCP server，不是组件）。→ **只能 iframe，没有第二条路。**
- 需要服务的最小集合 ≈ webapp 静态资源全体（`index.html`、`js/`、`styles/`、`images/`、`img/`、`resources/`、`math4/`、`mxgraph/`、`plugins/`、`templates/`）。**可以丢掉** `WEB-INF/`（Java classes + `lib/*.jar`）与 `META-INF/`。没有官方"最小构建"文档。
- **商标**：draw.io 是欧盟注册商标（#018062448），官方要求使用其名称/logo 需事先书面许可。→ UI 用中性名「图表编辑器」，不放 logo，README 里做事实性署名。

### 6.2 embed 协议 `[源码/网络核实]`

iframe URL：

```
/drawio/webapp/index.html?embed=1&proto=json&spin=1&ui=min&libraries=1&configure=1&plugins=0&stealth=1&suppressNewWindows=1&lang=zh
```

**host → iframe（action）**：`load`（带 `xml`、`autosave:1`、`title`、`modified`）、`configure`（`{config:{...}}`）、`merge`、`patch`、`getDiff`、`resetDiff`、`dialog`、`prompt`、`template`、`layout`、`draft`、`status`、`spinner`、`export`、`fit`、`viewbox`、`resetEditor`、`invokeAction`、`textContent`、`viewport`、`snapshot`。

**iframe → host（event）**：`init`、`configure`（需 `configure=1`）、`load`、**`autosave`（带 `xml`）**、**`save`（带 `xml`，点"Save and Exit"时附 `exit:true`）**、**`exit`（带 `modified`）**、`openLink`、`resize`、`export`、`shortcut`、`template`、`draft`、`prompt`、`prompt-cancel`、`merge`。

> 🔴 **没有 `{action:'save'}` 这个 host 动作。** Save 只是 iframe→host 的事件，**host 无法命令 iframe 保存**。
> → 必须靠 `{event:'save', xml}` 拿权威内容；autosave 只用于防抖落盘。UI 上要么保留 drawio 自己的 Save 按钮，要么只靠 autosave + 自己的"保存"按钮写**最后一次收到的 XML**。

**autosave**：靠 `load` 消息里的 `autosave: 1` 开启（**不是 URL 参数**）。
默认延迟 **2000ms**（`DrawioFile.prototype.autosaveDelay`，可在 configure 里用 `autosaveDelay` 覆盖），是**最后一次改动后的防抖**，不是固定轮询。
注意 autosave 也会因**纯视图变化**（网格、参考线、页面视图、背景）触发 → 建议开 `preserveViewState: true`。

**configure 回复**（`configure=1` 时 iframe 会等这个再 init）：

```json
{ "action": "configure", "config": {
  "lockdown": true, "plugins": [], "compressXml": false,
  "autosaveDelay": 1500, "preserveViewState": true,
  "noAutoFocus": true, "compact": true,
  "hideMenuItems": ["plugins", "print"]
} }
```

`lockdown: true` = 切断除"浏览器 ↔ 用户选定存储位置"之外的一切数据传输。
**真正可靠的总闸是 CSP 的 `connect-src 'self'`。**

**origin 校验**：host→iframe 用显式 targetOrigin；iframe→host 官方示例只查 `evt.source === frame.contentWindow`。
→ 我们**两者都查**：`evt.source === iframe.contentWindow && evt.origin === window.location.origin`，并 `try/catch` 包住 `JSON.parse`。

### 6.3 `.drawio` 文件格式 `[源码/网络核实]`

```xml
<mxfile host=".." modified=".." agent=".." version=".." compressed="false">
  <diagram id=".." name="Page-1">
    <mxGraphModel dx=".." grid="1" ...><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
    </root></mxGraphModel>
  </diagram>
</mxfile>
```

**压缩变体**（`@compressed="true"` 或 `<diagram>` 无元素子节点但有文本内容）：

- 编码链：`XML → URL-encode → raw deflate → Base64`
- 解码链：`base64 → zlib raw inflate（windowBits = -15）→ decodeURIComponent`

**判定要用两个独立信号**（结构优先）：

```js
function diagramIsCompressed(diagramEl) {
  if (diagramEl.getAttribute('compressed') === 'true') return true
  return !Array.from(diagramEl.children).some(c => c.tagName === 'mxGraphModel')
         && diagramEl.textContent.trim().length > 0
}
```

**写回时保持原样式**：读进来是压缩的就写压缩的，否则 git diff 会全是噪音。
`compressXml` 只控制**编辑器输出**，落盘形态由我们决定。

> ⚠️ 网上流传的 `<!--[if IE]><meta ...` 是压缩标记的说法**没有证据**，别用。

### 6.4 沙箱限制（实测结论，影响架构）🔴

**draw.io 在 sandbox iframe 里起不来** `[实测]`：

| iframe 配置 | 收到 `{event:'init'}`？ |
|---|---|
| 无 sandbox | ✅ |
| `sandbox="allow-scripts"` | ❌ |
| `sandbox="allow-scripts allow-popups allow-downloads allow-forms allow-modals"` | ❌ |
| `sandbox="allow-scripts allow-same-origin"` | ✅ |
| 嵌套：外层 `allow-scripts` → 内层 `allow-same-origin` | ❌ |

原因（强推断）：opaque origin 下 `localStorage` 抛 `SecurityError`，编辑器内部初始化失败后**静默死掉**，不报错给父窗口。
**且 sandbox 标志会被嵌套 iframe 继承，内层无法自行恢复。**

→ 对本项目的含义：
- better-sidebar 的**文件预览器是主文档里的普通 React 组件**（portal 渲染），**不是** sandbox iframe。
- 所以我们自己创建的 drawio iframe **不在任何 sandbox 子树里** → 不受影响。
- 但**绝不能**把 drawio iframe 放进 better-sidebar 的**浏览器 tab** 或 **HTML 预览器**（那两者是 sandbox iframe）。

### 6.5 CSP / framing `[源码/网络核实]`

- `embed.diagrams.net` 本身可被 iframe（实测能拿到 init）。
- **自托管 webapp 的 `web.xml` 不设 `X-Frame-Options`**，Docker 版注入的 CSP 也没有 `frame-ancestors` → 可被 iframe。
- 但**我们自己的静态路由必须显式发 CSP**（见 PLAN 第三节）。注意 drawio 可能需要 `'unsafe-inline'`（style 与部分 script），**可能需要 `'unsafe-eval'`——必须在 P1 实测**。

---

## 7. 踩坑清单（Checklist：每条都对应一次真实故障）

| # | 坑 | 后果 | 对策 |
|---|---|---|---|
| 1 | 路径穿越检查用 `/` 而不是 `path.sep` | **每个合法子路径都被当穿越拒绝**（Windows 上 `resolve()` 出反斜杠） | 必须用 `sep`；列为单测项 |
| 2 | 硬编码 `/plugins/<id>/client.js` | **真 404**（只服务 combo URL） | 永远从 boot graph 取 URL |
| 3 | 把 drawio webapp 塞进 client bundle | host 内存里留多份 ~100MB 快照；`immutable` 缓存导致永远更新不了 | 走自己的 prefix 路由流式发 |
| 4 | build 脚本 `rm -rf lib` | Windows 上 **EPERM**（DSH 持有文件） | build 不 clean |
| 5 | 重复挂载 / 重复 `(kind,path)` 路由 | `duplicate prefix route` → **整棵插件树启动失败** | 一个 prefix 一个注册点；必要时抄 better-sidebar 的 `!!js` 退让守卫 |
| 6 | 以为 client 半能拿到 config | `apply(ctx)` 第二参恒为 `undefined` | 设置走自己的 host 路由或 `pluginSettings` 缝 |
| 7 | 以为 `ctx.settings` 会过滤命名空间 | 无白名单，**浏览器可读** | 不放机密 |
| 8 | 用 owner scope 的 `update()` 做并发保护 | **不带 revision 守卫，静默丢失保护** | 用 service 级 `ctx.settings.update(ns, patch, revision)` |
| 9 | 以为 schemastery 会拒绝未知键 | 未知键 **merge 进 resolved config** 并进浏览器 | `.required()` + 自己写 `resolve*Config()` |
| 10 | 以为有 `{action:'save'}` | host **无法**命令 iframe 保存 | 靠 `save`/`autosave` 事件 |
| 11 | 给 drawio iframe 加 sandbox 但漏 `allow-same-origin` | **编辑器静默不启动** | 不加 sandbox，或必须含 `allow-same-origin` |
| 12 | 复用 better-sidebar 的 `fs.read` | 512KB 截断 + 相对路径按 git 根 + **无 `isWithin` 围栏** | 自己实现带围栏的读写 |
| 13 | 只依赖 `ctx.sessions` 找历史工作区 | `list()` **只返回活跃会话** | 用 `workspaceRegistry`，且允许它不存在 |
| 14 | 用官方左栏加 tab | **没有 tab 插槽**（52 个 slot 里没有） | 只能走 better-sidebar 服务 |
| 15 | MIME 表照抄 `dsh-host-frontend-static` | 只有 8 个扩展名，**缺 `.png/.woff2/.wasm/.ttf/.cur`** | 自己写全 |
| 16 | 假设 gzip 关着 | 实际 **开着**（level 1，阈值 1024）；Range 响应会被自动排除 | 别对 `.wasm`/`.woff2` 的 CPU 掉以轻心 |
| 17 | 不提交 `lib/` 就想用 git 源安装 | `dsh.client` 要求启动前 `lib/client.js` 存在，否则激活失败 | 提交构建产物 + CI 校验同步 |
| 18 | 用 `--profile web` 装 | 装到了**没有在跑**的 profile | 一律 `--profile desktop` |
| 19 | read-only 沙箱里往会话工作区外写 | 拒绝访问 | 新会话工作区设成 `dsh-drawio` |

---

## 8. 未验证 / 需自行确认

1. 本机 `%TEMP%` 是否可写（沙箱提到"部分平台临时区域可能可写"，未实测）。
2. drawio webapp 是否真的需要 `'unsafe-eval'`（CSP 实测，P1 做）。
3. `draw.war` 里 webapp 的确切布局（根目录 vs `webapp/` 子目录）——解压逻辑要**两种都兼容**。
4. 解压后静态资源的**精确大小**（war 51.3MB 是实测；解压后只有"几十~150MB"的估算）。
5. `dsh-base` 的 patch 是否真的挂了 `dsh-workspace`（未读）；所以要用 `ctx.get('workspaceRegistry')` 并降级。
6. `@deepseek-ai/*` 发行包不含 `.d.ts`，但 `schemastery` / `cordis` / `cordis-plugin-loader` **带原始 `.ts` 源码**，需要类型时去读它们。
7. `dsh.plugin.json` 在本机被 desktop host **读取为空**（死元数据）；不要依赖。但外部市场可能读它。

---

## 9. P0 期间新增核实（2026-09-17，全部 `[实测]`）

> 这一节是实施 P0 时踩到、第 1~8 节没覆盖的事实。后续阶段（尤其"用 Chrome MCP 实测"）**必须先读**。

### 9.1 🔴 用 Chrome MCP 驱动 GUI 需要先过浏览器鉴权

第 1.2 节写的"探活返回 401 属正常"只是现象，**没有说怎么进去**。实际机制（源码在
`dsh-client-connection/lib/index.js` 的 `BrowserAuth`）：

- `GET /` 无凭据 → `401` + 正文 `dsh web authentication required; reopen the URL printed by dsh web.`
- 两种有效凭据：
  1. **launch token**：`GET /?token=<base64url>`（路径必须正好 `/`、`token` 参数**只能一个**）
     → `303` 到 `/` 并 `Set-Cookie`。
  2. **签名 cookie**：`dsh-auth-<base64url(sha256(authority))>` =
     `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, body))>`，
     payload = `{version:1, authority, issuedAt, expiresAt}`。
     `authority` 就是 `Host` 头规范化后的值，例如 `127.0.0.1:43120`。
- launch token 存在 `WeakMap` 里，`encodeBase64Url(randomBytes(32))`，**不落盘、不打日志** → 外部拿不到。
- secret 是**持久化凭据**，在 `$DSH_HOME/.credentials.yaml` 的 `records` 里，
  key 为 `client-connection` / `browser-session`，是 32 字节 base64url 字符串。
  → **可以自己签一个 cookie**，然后在页面里 `document.cookie = '...; path=/'`。
  （cookie 本身标了 `HttpOnly`，但服务端只读 `Cookie` 头，**不校验该标志**。）
  可复用脚本：`.tmp/mint-cookie.mjs`（读 `.credentials.yaml` → 打印 cookie 串）。
- **插件自己的路由默认不过鉴权闸**：`/drawio/ping` 无 cookie 也返回 200。
  鉴权是**逐路由 opt-in** 的（`authorizeIndex` 只挂在 index 上），不要以为整个 host 都被拦。
- `chrome_navigate` **不接受裸 IP**：传 `http://127.0.0.1:43120` 会被拼成
  `Invalid url pattern 'http://www.127.0.0.1:43120/*'`。绕法：先开
  `http://localhost:43120/`（能过），再用页面内 `location.href = 'http://127.0.0.1:43120/'` 跳过去。
  ⚠️ `localhost` 本身拿不到东西（多半解析到 `::1`，而服务只 bind 127.0.0.1）→ 空白页，属正常。
- 用户平时**不在浏览器里开 GUI**（Chrome 历史里除了我这次访问没有任何 43120 记录）；
  GUI 是 DSH Desktop 自己的 Electron 窗口。Electron 侧 cookie 在
  `%APPDATA%\DSH Desktop\Partitions\dsh-desktop-renderer\Network\Cookies`（Chromium 加密）。

### 9.2 `dsh.client.inject` 里解析不到的 id 会被**静默跳过**

`dsh-client-modules/lib/client.js:265`：

```js
for (const packageName of row.inject) {
  const dependency = this.graphRows.get(packageName);
  if (dependency !== void 0) await this.arriveGraphRow(dependency, [], visited);
}
```

`@deepseek-ai/dsh-client-ui-slots` **不是** loader entry（本机组合树里 0 命中），
但第 2.1 节和 dsh-skillui 都把它列在 inject 里且能正常工作——原因就是这条。
→ 往 `dsh.client.inject` 加"未来会用到的包"没有副作用；但**列进去也不会让它存在**。
真正会抛错的是 `require()`：`client-modules: require("<x>") missed the module table …`。

### 9.3 `pnpm install` 会被沙箱的 `spawn EPERM` 打断在安装中途

esbuild 的 postinstall 用 piped stdio 起子进程 → DSH 沙箱拒绝 `spawn` → **pnpm 崩在链接
`node_modules/.bin` 之前**，症状是"包都装了（`.pnpm` 有 400+ 项）但 `.bin` 是空的"。
对策（`pnpm-workspace.yaml`）：

```yaml
allowBuilds:
  esbuild: false
  node-pty: false
```

`@esbuild/win32-x64` 是正常装上的，vite/vitest 走 JS API，**不需要那个 postinstall**。
`node-pty` 只是 `dsh-better-sidebar` 的传递依赖（我们只用它的 `.d.ts`），不建原生模块。

### 9.4 `dsh <profile> --dump-config` 是重启前验证组合树的唯一手段

- 它会**写** `profiles/<name>/cordis.yml`（空根配置，内容恒为 `[]`，每次 boot 重写）
  和 `package.json` → 在工作区外 → 沙箱会 EPERM，需要放行。
- 输出是**组合后的 loader 树**，可以据此确认 `- id: <entryId>` / `  name: <pkg>` 出现了、
  以及有没有**重复 id**。P0 用它提前排掉了 `duplicate prefix route` 的一半风险。
- 它**不 boot**，所以查不出运行期注册冲突；运行期要靠路由探针。

### 9.5 `patchReload: "live"` **不能**免重启挂新 bundle

`dsh/lib/profile-boot-*.js`：`patchReload === "live"` 只做两件事——
按需挂 `cordis-plugin-timer` + `cordis-plugin-hmr`，然后 `watchUserPatches()` 监听
**用户 patch 文件**（`profiles/<name>/cordis.patch.yml` 与 home patch）。
`composeLive()` 里的 `composed.bundlePatches` 是 **boot 时快照**，**不会重读 `dsh.profile.bundles`**。
→ 新装 bundle **必须重启**；且**不要**为了免重启往用户 patch 里再写一行挂载（会双挂载）。
client 半同理：boot graph 是启动时扫的，客户端也别指望刷新就够。

### 9.6 agent 的 shell 就住在 `DSH Desktop.exe` 里

`pwsh` 的父进程链是 `powershell.exe → DSH Desktop.exe → …`。
**重启 DSH Desktop 会杀掉当前 agent turn**（进程没了，turn 就没了），
所以"重启"这一步只能交给用户做，agent 最多把重启前的验证做满再交接。

### 9.7 `pnpm install` 的两个环境坑

- 加依赖时 `pnpm install` 会因为要重建 `node_modules` 而报
  `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`（无 TTY 不敢删）。设 `CI=true` 可过。
- 但 `CI=true` 又会把 `frozen-lockfile` 打开 → 报 `ERR_PNPM_OUTDATED_LOCKFILE`。
  **加依赖时必须 `pnpm install --no-frozen-lockfile`。**

---

## 10. P1 期间新增核实（2026-09-17，全部 `[实测]`）

### 10.1 drawio 资源包的确切事实

| 项 | 值 |
|---|---|
| release tag | `v31.4.6`（`/releases/latest` 302 到这里；api.github.com 在本机被限流 403，改用 `curl -I` 看 302 更省事） |
| URL | `https://github.com/jgraph/drawio/releases/download/v31.4.6/draw.war` |
| war 大小 | `53,762,297` 字节 |
| **war sha256** | `f7798104da17d7e9494ab348c3ba9b2a65640096bd54f704d7a0fa2fab283938` |
| zip 条目数 | 3650（含目录条目） |
| 解压总量 | 149,295,257 字节 ≈ 142.4 MB |
| 落盘文件数 | **3382**（剔除 `WEB-INF/` 70 项 + `META-INF/` 2 项 + 目录条目） |
| **布局** | **webapp 直接在 zip 根**（`rootPrefix: ""`），`index.html` 就在根上；`webapp/` 子目录那套**本版本不存在**，但解压器仍兼容 |
| `index.html` | 2759 字节，只引 `styles/grapheditor.css` + `js/bootstrap.js` + `js/main.js`；**没有 service worker 注册** |
| 扩展名分布 | svg 1772 / png 644 / js 446 / xml 366 / woff2 33 / gif 25 …… **没有 `.wasm`**（GROUND-TRUTH §8.2/§8.3/§8.4 结案） |

### 10.2 drawio 在 embed 模式下的 UI 参数

- **`ui=kennedy` 给出完整编辑器**：工具栏（实测 23 个按钮）、格式面板、形状面板、
  菜单栏全在，`body.className === "geEditor geClassic geEmbed geCompactMode"`。
- **`ui=min` 会砍掉形色面板**，不适合"能拖形状、能改属性"的目标。我们最终用 `ui=kennedy`。
- ⚠️ **窄面板下 drawio 会自己折叠两侧面板**：在 ~537px 宽的侧边栏里，
  `.geFormatContainer` 与 `.geSidebarContainer` 宽度被压到 1px，只剩画布 + 工具栏。
  **这不是 bug**，正是 PLAN §3 让用户"把 tab 拖到主会话区变悬浮窗口（`floatWindows`）"的原因。
  P3 文档要把这句写清楚。
- `App.main()` 在 embed 模式**返回 undefined**；真正拿编辑器实例的把手是
  **`iframe.contentWindow.sb.editorUi`**（`marker → .editor.graph` 就是 mxGraph）。
  自动化验证直接用它：`ui.getFileData(true)` 读回 XML、`graph.insertVertex(...)` 改模型。
  → 这条对 P2/P3 的实测极其有用，别再花时间找 App 实例。

### 10.3 CSP 实测结论（GROUND-TRUTH §8.2 结案）

- **不需要 `'unsafe-eval'`**：用
  `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; … frame-src 'self'`
  加载 drawio v31.4.6，**0 个 CSP 违规、0 个异常**，画布与工具栏正常。
- **`frame-src 'self'` 够用**（PLAN 写的是 `'none'`）：外部 frame 照样全挡，但不误伤 drawio 自己的同源子 frame。
- **`Origin: null` 必须拒绝**：sandbox 化的 frame 发出来的是字面量 `null`，
  我们的围栏按 opaque origin 拒绝（也再次印证 GROUND-TRUTH 6.4：drawio 不能放进 sandbox）。
- **DSH GUI 自身完全没有 CSP**：整个 `@deepseek-ai/*` 里 grep 不到 `content-security-policy`，
  `dsh-web-frontend/dist/index.html` 也没有 CSP meta → 父页面不会挡住我们 frame 编辑器。

### 10.4 离线与保存通道（实测）

- 完整启动 drawio 共 **25 个资源**，**全部**来自本机同一个 host，**外部请求 0**。
- `load` 消息带 `autosave: 1` 后，**模型一改就会收到 `{event:'autosave', xml}`**（约 1.5s 防抖）
  → P2 的落盘触发点已经确认可用，不需要轮询。
- 发给 drawio 的 `load.xml` 会被完整吃下：`ui.getFileData(true)` 能原样读回 `<mxfile><diagram id="…">`。

### 10.5 浏览器 cookie 跨重启有效

9.1 里手工签的 `dsh-auth-*` cookie **在 DSH Desktop 重启后仍然可用**——
secret 持久化在 `~/.dsh/.credentials.yaml`，重启只换 launch token，不换 secret。
24 小时内可以一直用同一个 cookie 驱动 GUI。

---

## 11. P2 期间新增核实（2026-09-17，全部 `[实测]`）

### 11.1 drawio 的压缩编解码器（第 6.3 节得到确认，并补齐细节）

源码位置 `js/grapheditor/Graph.js`：

```js
Graph.compress = function(data, deflate) {          // 不传 deflate → raw
  var tmp = (deflate) ? pako.deflate(encodeURIComponent(data))
                      : pako.deflateRaw(encodeURIComponent(data));
  return btoa(Graph.arrayBufferToString(new Uint8Array(tmp)));
};
Graph.decompress = function(data, inflate, checked) {
  var tmp = Graph.stringToArrayBuffer(atob(data));
  var inflated = decodeURIComponent((inflate) ? pako.inflate(tmp, {to:'string'})
                                              : pako.inflateRaw(tmp, {to:'string'}));
  return (checked) ? inflated : Graph.zapGremlins(inflated);
};
```

- `.drawio` 文件里的 `<diagram>` 压缩走的是**不带 flag 的分支 → `deflateRaw` / `inflateRaw`**
  （`DrawioFile.js:2677 / 2684`、`EditorUi.js:2098 / 2110` 都这么调）。
  第 6.3 节写的 windowBits −15 是**对的**；pako 的 zlib 变体只服务于另一些调用点。
- 因此 Node 侧对应 `zlib.deflateRawSync` / `inflateRawSync`，**不要**用 `deflateSync`。

### 11.2 🔴 **Node zlib 无法复现 pako 的字节**

把 8 个 level × 2 个 memLevel + 3 种 strategy **共 20 组参数全试过，没有一组**
能让 `zlib.deflateRawSync(encodeURIComponent(xml))` 输出等于 drawio `Graph.compress(xml)` 的结果
（同一输入：我们 368 字符，drawio 364 字符，都能正常解回原文）。

**含义**：不要写出"我们自己压一遍再写回"的实现——那会在每次保存时把整份压缩内容换掉，
哪怕只改了一个形状。
**对策（已落地）**：
1. `configure` 里的 `compressXml` **跟着文件的存储样式走**，让 drawio 用自己的 pako 输出压缩内容，
   每个 `<diagram>` 独立压缩 → 没改动的页字节不变。
2. `writeDiagram` 在解码后的文档与磁盘一致时**直接不落盘**。

### 11.3 drawio 保存时会**归一化** `<mxfile>`

`ui.getFileData(true)` 出来的是光秃秃的 `<mxfile>`，**丢掉** `host=` / `agent=` / `version=`
这些属性（我们自己生成的空白模板带着它们）。所以"打开后没改就保存"会在这三个属性上产生一行 diff。
`writeDiagram` 的"未改动就不写"守卫比的是**整篇文档**，因此只在文件本来就是 drawio 归一化形态时命中；
这已经覆盖了"上次由 drawio 保存过"的绝大多数文件（此时连一行 diff 都没有）。

### 11.4 `@deepseek-ai/dsh-atomic-write` 装不上

- DSH Desktop 装的是 `0.1.2-alpha.1`，但 **npm 上根本没有这个版本**
  （`pnpm view ... versions` 只有 `0.1.2-alpha.2` 起；`latest` 还停在 `0.0.1-rc.1`）。
- → 不要 `import` 它。本项目按相同契约把 `writeFileAtomic` 抄进了 `src/net/atomic-write.ts`
  （随机后缀兄弟文件 + `wx` 独占创建 + rename + 失败清理），与第 5.4 节描述的行为一致。

### 11.5 `dsh-client-hmr` 在本机**没有**把 client 半热替换掉

第 3.5 节说改 client 能被 `dsh-client-hmr` 轮询 `lib/client.js` 热替换、**不用刷新**。
**实测不成立**：`pnpm build` 重写了 `lib/client.js` 之后等了 6 秒以上，
页面上仍是旧组件的文案（`保存中…` 而不是新写的 `有冲突`），中间还进行了多次交互；
**只有刷新页面之后新代码才生效**。

（两种解释没能区分开：HMR 根本没换模块，或者模块换了但已挂载的 React 组件实例没有被重挂载。
无论哪种，**以"改完 client 请刷新页面"为准**——刷新很便宜，而且不会被误导。）

### 11.6 GUI 驱动的实际手感（补充 9.1）

- 侧边栏的"刷新"按钮在 `x≈1446,y≈55`（`aria-label="刷新"`），
  外部新增文件后**必须点它**文件树才会出现；单纯展开目录不会重新读盘。
- 编辑器标签页的关闭按钮是 `[class*="tabClose"]`，**不在** `[class*="paneTab"]` 内部，
  按 `x` 坐标顺序与标签栏一一对应，`y=17`。
- 关掉标签页后再从文件树点开，是验证"保存→重开一致"的最短路径。

---

## 12. P3 期间新增核实（2026-09-17，全部 `[实测]`）

### 12.1 `sidebar.footer.action` 是官方左栏唯一的加性席位

声明在 `@deepseek-ai/dsh-client-ui-sidebar/lib/client.js`：

```js
"sidebar.footer.action": { kind: "list", scope: "root" }
```

- 同一张表里其它 4 个席位（`sidebar.brand.mark` / `brand.name` / `workspaces` / `settings`）
  都是 `kind: "single"`，**单个占位者**，注册要抢；只有 `footer.action` 是 `list`，可加条目。
- `list` 必须给 `options.id`（同 id 重复注册会抛）。
- 渲染点是 `renderSlot("sidebar.footer.action", { wide })` —— 组件只拿到 owner prop `{ wide }`。
  **parent 的 `inject` 是 `injectProps`**，所以业务面参数按 scope 决定。

**注册配方**（照抄 `dsh-better-sidebar/src/client/intercept.tsx` 的写法）：

```tsx
export const inject = ['betterSidebar', 'slots'] as const   // 服务名，不是包名

ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
  name: 'sidebar.footer.action',
  id: 'your-plugin:thing',
  order: 100,
  registrant: 'your-plugin',
}, () => <YourButton />)))
```

- **必须用 `slots.inject` 而不是直接 `register`**：slot 由 sidebar 声明，
  注册早于声明会抛 `slot "x" is not declared`；`inject` 会等到声明提交再回调。
- ⚠️ `register` 的 `inject` 选项是**业务面工厂**，和 `ctx.slots.inject(key, cb)` 是**两个东西**，别搞混。
- **`scope: "root"` 意味着组件拿不到 session**。要"当前会话"就自己去
  `ctx.betterSidebar.getSnapshot().sessionId`（dsh-skillui 也是这么做的），
  并用 `subscribeState` 跟着切换走。

### 12.2 🔴 `Config` 走的是 **Standard Schema**，而且未知键直通 `apply`

`@deepseek-ai/cordis` 的 `src/fiber.ts`：

```js
export function resolveConfig(runtime, config) {
  if (!runtime.Config) return config
  const result = runtime.Config['~standard'].validate(config)
  ...
}
```

- schemastery 3.18 **实现了 Standard Schema**（`Config['~standard']` = `{vendor:'schemastery', version:1}`），
  所以 `export const Config = z.object({...})` 能被 Loader 接受。
- **未知键照样漏**：`Config['~standard'].validate({diagramsDir:'figs', bogus:1})` 返回的对象里
  **`bogus: 1` 原样存在**。第 7 节踩坑 #9 因此又多了一层：未知键不只是进 `describe().user`，
  是**直接进 `apply` 的第二个参数**。→ 必须自己写 `resolve*Config()` 二次兜底。
- **schema 是严格的**：`validate({autosaveDelayMs:'nope'})` 返回 `issues`，
  Loader 会判这一行插件校验失败 → **该 fiber 挂不起来**（现象是插件功能静默消失）。
  类型写错的代价是"整行插件没了"，不是"退回默认值"。

### 12.3 better-sidebar 交给 `load()` 的是**绝对路径**

实测（在编辑器路径框里敲 `docs/diagrams/x.drawio` 回车后，viewer 里显示的 `path`）：

```
G:\claude_project\code-agent\dsh-drawio\docs\diagrams/from-path-input.drawio
```

—— cwd 与用户输入**直接字符串拼接**，于是出现**混合分隔符**（`\` 与 `/` 并存）。
所以 host 侧的路径解析必须同时容忍绝对/相对与混合分隔符（`resolve()` + `isWithin()` 已经覆盖）。

另外：**编辑器标签页自带一个路径输入框**（`[class*="editorPathInput"]`，
placeholder `输入文件路径（相对会话目录或绝对路径），Enter 打开`）——
PLAN §6(B) 说的"敲路径回车"入口就是它，不需要我们自己造。

### 12.4 🔴 用 Chrome MCP 驱动这个 GUI 的两个实操陷阱

1. **`chrome_computer type` 会把文字送进会话输入框，而不是你点的那个 input。**
   实测：点中侧边栏路径输入框后 `type`，文本进了主会话的 composer（contenteditable），
   **差一步就被当成给 agent 的消息发出去**。→ 要往 React 受控 input 里写值，
   用原生 setter + 派发事件：
   ```js
   const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
   set.call(input, '新值')
   input.dispatchEvent(new Event('input', { bubbles: true }))
   input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
   ```
   用完记得确认 composer 是空的。
2. **会话越长，GUI 越难驱动。** 到第 8 轮（532 步）时，a11y 树一次就有 476 个节点，
   `chrome_javascript` 里稍微多遍历几个元素就会 16s 超时；左栏还会自己折叠。
   → 用 `chrome_read_page` + ref 定位（它更快），把 JS 查询压到最小，
   并且优先用"路径输入框 / 唯一按钮文案"这类**语义锚点**，别依赖坐标。
