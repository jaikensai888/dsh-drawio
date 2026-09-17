# dsh-drawio 实施计划

> **读者**：接手实施的新会话/新 agent。你**没有**上文语境。
> 所有环境与 API 事实已经核实并整理在 [`GROUND-TRUTH.md`](GROUND-TRUTH.md) —— **先读它**，
> 尤其是第 7 节「踩坑清单」。本文只讲**要做成什么样、怎么做、怎么算做完**。

---

## 一、目标与已锁定决策

把 draw.io 图表编辑器集成进 DSH Web GUI 侧边栏，图纸以 `.drawio` 文件保存在当前工作区。

| 项 | 决定 | 说明 |
|---|---|---|
| 引擎来源 | **自托管** drawio webapp，首次使用时自动下载到 `~/.dsh/storages/dsh-drawio/` | 完全离线、图纸不出本机 |
| 图纸存放 | 新建默认落 `<工作区>/docs/diagrams/`；**可打开**工作区内任意位置的 `.drawio` | 围栏是会话 cwd，不是 diagrams 目录 |
| 集成形态 | 注册 `.drawio` **文件预览器**（走 `dsh-better-sidebar`），**不做独立 Tab** | |
| 冷启动入口 | **(A)** 官方左栏 `sidebar.footer.action` 注册「新建图纸」按钮 **(B)** viewer 内「新建/另存为」+ 打开不存在路径时提示创建 | 见第六节 |
| 模型工具 | **不做**（纯人工编辑） | |
| 界面语言 | 中文（`lang=zh` + drawio 自带 i18n） | |
| 包名 / 仓库 | `dsh-drawio` / `github.com/jaikensai888/dsh-drawio` | |
| 目标 profile | **`desktop`** | 不是 `web` |
| 许可 | 本插件 MIT；drawio webapp 运行期下载、不在仓库分发 | |

**非目标**（明确不做，避免范围蔓延）：
给模型的 `drawio_*` 工具、独立的 drawio 侧边栏 Tab、多人协同、drawio 云存储集成、
`.drawio.svg` / `.drawio.png` 变体（可留作后续）、把 drawio 打进 npm 包本体。

---

## 二、架构总览

### 2.1 包结构

```
dsh-drawio/
├─ package.json          main/exports + dsh{bundle.patch, client{platform,inject}}
├─ cordis.patch.yml      insert 一行挂载自己
├─ tsdown.config.ts      host→ESM；client→window.__ModuleLoader__ 包装（抄 dsh-skillui）
├─ tsconfig.json / tsconfig.build.json
├─ src/
│  ├─ index.ts                host 入口：name / inject / Config / apply(ctx, config)
│  ├─ config.ts               schemastery Schema + resolveDrawioConfig() 二次兜底
│  ├─ routes.ts               单 prefix 路由 /drawio，内部二分派
│  ├─ assets.ts               drawio webapp 静态服务（stream + ETag/304 + Range）
│  ├─ diagrams.ts             会话级 .drawio 读写（围栏 + 原子写 + mtime 冲突）
│  ├─ webapp-install.ts       首次使用：下载 draw.war → 选择性解压 → ~/.dsh
│  ├─ drawio-xml.ts           压缩判定 / 解码 / 保持原样式写回
│  ├─ net/
│  │  ├─ trust-fence.ts       抄 isTrustedApiRequest
│  │  ├─ mime.ts              补全的 MIME 表
│  │  └─ http.ts              readJsonBody / writeJson / writeOk / writeError / streamFile
│  └─ client/
│     ├─ index.tsx            inject=['betterSidebar'] → registerFileViewer
│     ├─ DiagramViewer.tsx    工具栏 + iframe + 状态机
│     ├─ embed-protocol.ts    postMessage 协议封装
│     ├─ api.ts               调 /drawio/api/* 的 fetch 封装
│     ├─ NewDiagramButton.tsx 冷启动入口 (A)：sidebar.footer.action
│     └─ icons.tsx
├─ test/                 vitest 单测
├─ lib/                  ★ 构建产物，必须提交
└─ docs/                 PLAN.md / GROUND-TRUTH.md
```

### 2.2 数据流

```
① 用户在 better-sidebar 文件树点 a.drawio
     └─ matchFileViewer(path) → 我们的 viewer（priority 0, exts ['drawio','dio']）
          └─ fetchStrategy: 'custom'
             load(path, scope) → POST /drawio/api/read { sessionId, cwd, path }
                host: cwd = ctx.sessions.get(id)?.header.cwd
                      requireAbsolute(path) + isWithin(cwd, path)  否则 403
                      readFile + stat → { xml, mtimeMs, compressed, size }

② viewer 渲染 <iframe src="/drawio/webapp/index.html?embed=1&proto=json&...">
     （主文档内，**无 sandbox 属性**）
     iframe --{event:'configure'}--> viewer --{action:'configure', config}--> iframe
     iframe --{event:'init'}-->      viewer --{action:'load', xml, autosave:1, title}--> iframe

③ 用户编辑
     iframe --{event:'autosave', xml}--> viewer: 只更新内存 + dirty 标记
     iframe --{event:'save', xml}-->     viewer: 立即落盘
     viewer 自身防抖（空闲 1.5s）→ POST /drawio/api/write { sessionId, cwd, path, xml, ifMtimeMs }
        host: 比对 mtime → 不一致返回 409 CONFLICT
              writeFileAtomic(path, xml, { mode: 0o644 })
              → 返回 { ok:true, mtimeMs }

④ iframe --{event:'exit', modified}--> viewer: flush 后 ctx.betterSidebar.closeTab(tab.id)
```

### 2.3 路由设计（单注册点，零冲突）

**只注册一个 prefix 路由 `/drawio`**，内部按子路径分派：

| 方法 + 路径 | 用途 | 围栏 |
|---|---|---|
| `GET  /drawio/webapp/**` | drawio webapp 静态资源（流式） | 信任围栏；不需会话 |
| `GET  /drawio/webapp/index.html` | 编辑器入口文档 | 同上 + CSP |
| `POST /drawio/api/read` | 读图纸 | 信任围栏 + `isWithin` |
| `POST /drawio/api/write` | 写图纸（原子 + mtime 冲突检测） | 同上 |
| `POST /drawio/api/create` | 新建空白图纸 | 同上（只允许落在 `<cwd>/docs/diagrams/`） |
| `POST /drawio/api/list` | 列 `<cwd>/docs/diagrams/` 下的图纸 | 同上 |
| `POST /drawio/api/exists` | 路径是否存在（打开不存在路径时的创建提示） | 同上 |
| `POST /drawio/api/webapp-status` | 编辑器资源是否已就绪 / 下载进度 | 信任围栏 |

> **为什么只用一个 prefix**：`webServer.register` 对重复 `(kind, path)` 直接抛错，
> 会让**整棵插件树启动失败**。一个注册点把冲突面降到零。

**HTTP 状态码约定**：`200` 正常；`400` 参数/路径非法；`403` 围栏或越界；`404` 文件/方法不存在；`409` mtime 冲突；`500` 内部错误。

**响应信封**（照 better-sidebar 的形状，便于排障）：

```jsonc
{ "ok": true,  "value": { /* ... */ } }
{ "ok": false, "error": { "code": "fs-error", "message": "..." } }
```

---

## 三、关键设计选择

| 项 | 选择 | 理由 |
|---|---|---|
| 路由 | 单 `prefix /drawio` + 内部分派 | 重复 `(kind,path)` 会炸整棵树 |
| 信任围栏 | 把 `isTrustedApiRequest` 抄进自己包里 | `dsh-client-connection` 不导出它；better-sidebar 也只能抄 |
| 读取策略 | `fetchStrategy:'custom'` + 自己的 read 接口 | 不用 better-sidebar 的 `fs.read`（512KB 截断、按 git 根解析相对路径、**无 `isWithin` 围栏**） |
| 会话归属 | `ctx.sessions.get(sessionId)?.header.cwd` 权威，客户端 cwd 仅 hydration 兜底 | `header.cwd` 构造时校验过必须绝对路径 |
| 工作区键 | `workspace?.path ?? realpath(cwd)`，`workspaceRegistry` 可选 | host 侧没有"当前工作区"概念；未注册目录很常见 |
| 写入 | `writeFileAtomic(mode 0o644)` + 写前比 mtime | 崩溃不写坏文件；能发现外部改动 |
| 保存触发 | 保留 drawio 自己的 Save（`{event:'save'}` 给权威 XML）+ autosave 防抖落盘 + 自己的防抖 | **没有 `{action:'save'}`**，host 无法命令 iframe 保存 |
| 编辑器按钮 | 不隐藏 drawio 原生按钮；Exit 由我们接管为 `closeTab` | 最小惊讶；用户熟悉的快捷键仍可用 |
| 静态服务 | `createReadStream().pipe(res)` + ETag/304 | DSH 里**没有任何流式先例**，我们是第一个 |
| 不做独立 Tab | 用 better-sidebar 的文件预览器 | 官方左栏没有 tab 插槽（52 个 slot 已枚举） |
| 放大画布 | **不做自己的弹窗** | better-sidebar 0.16+ 的 `floatWindows`：把编辑器 tab 拖到主会话区域即成悬浮窗口 |

---

## 四、drawio 引擎：自托管 + 首次自动下载

### 4.1 获取流程（`webapp-install.ts`）

```
目标目录：~/.dsh/storages/dsh-drawio/webapp/      （DSH home 由 $DSH_HOME 或 ~/.dsh 解析）
标记文件：~/.dsh/storages/dsh-drawio/.installed.json
          { version, source, sha256, installedAt, size }
```

1. 若 `webapp/index.html` 与标记文件都存在且版本匹配 → 直接就绪。
2. 否则**下载**：`https://github.com/jgraph/drawio/releases/download/v<tag>/draw.war`
   - tag 与期望 sha256 写死在代码常量里（**pin 住**，不要动态查 latest）。
   - 下载到 `~/.dsh/storages/dsh-drawio/.download-<nonce>.war`，校验 sha256，不匹配就删掉报错。
3. **选择性解压**：`.war` 是 zip。
   - **跳过** `WEB-INF/**`（Java classes + `lib/*.jar`）与 `META-INF/**`。
   - **兼容两种布局**：webapp 可能在 zip 根（`index.html`、`js/`…），也可能在 `webapp/` 子目录下。
     判定方式：找到含 `index.html` 的条目，取它所在目录作为**资源根前缀**，之后按相对路径重建。
   - 解压到 `.extract-<nonce>/`，成功后再 `rename` 成 `webapp/`（原子替换，中断不留半个树）。
4. 写标记文件。
5. 全程向前端上报进度（`{phase:'downloading'|'extracting'|'ready', received, total}`），
   viewer 在画布位置显示进度条 —— **首次体验不能是一块白屏**。

> 需要 zip 解压能力：Node 22+ 无内置 zip。用 `adm-zip`（DSH 自身已验证可用）或 `yauzl`（流式）。
> 51MB 体量下**逐条目解压**，不要整体 buffer。

### 4.2 服务方式（`assets.ts`）

- 资源根 = `~/.dsh/storages/dsh-drawio/webapp/`。
- **路径穿越防护必须用 `path.sep`**（Windows 上 `resolve()` 出反斜杠；用 `/` 会把每个合法子路径都当穿越拒绝）：

```ts
const target = resolve(normalize(join(webappRoot, decodedPathname)))
if (target !== webappRoot && !target.startsWith(webappRoot + sep)) → 403
```

- **流式**：`createReadStream(target)` → `pipe(res)`；`res.on('close')` 时销毁流。
- **ETag/304**：按 `mtimeMs + size` 记忆化（不要每次请求都哈希文件），`cache-control: no-cache`。
- **Range**：支持 `bytes=` 单区间 → 206 + `content-range`。
  （`dsh-host-webserver` 的 gzip 中间件会自动排除 `content-range` 响应，交互正确。）
- **MIME 表要补全**（`dsh-host-frontend-static` 的 8 项不够）：
  `.html .js .mjs .css .json .map .svg .png .jpg .jpeg .gif .webp .ico .cur .woff .woff2 .ttf .eot .wasm .xml .txt .md .pdf`

### 4.3 我们发的 CSP（关键安全边界）

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'
```

- **`connect-src 'self'` 是唯一的网络级总闸** —— drawio 就算想外连也发不出去。
- `'unsafe-inline'` 大概率必需（drawio 内联 style/script）。
- **`'unsafe-eval'` 是否必需必须实测**（P1）；若报错就加上，并记进 README 的已知限制。
- **零改动内核文件**：不解压后手改 `PreConfig.js`（否则每次升级都要重打补丁）。
  离线与隐私全靠上面这层 CSP + URL 参数 + `configure` 里的 `lockdown`。

### 4.4 配置项（`Config` / schemastery）

```ts
{
  drawioVersion: z.string().default('v31.4.6'),      // pin 的 release tag
  drawioSha256:  z.string().default('<解压/下载产物的 sha256>'),
  editorUrl:     z.string().default(''),             // 非空则用外部 URL（逃生舱/调试）
  diagramsDir:   z.string().default('docs/diagrams'),// 相对工作区
  autosaveDelayMs: z.number().min(200).max(10000).default(1500),
  writeDebounceMs: z.number().min(0).max(10000).default(1500),
  uiTheme:       z.string().default('min'),
  language:      z.string().default('zh'),
  allowOutsideWorkspace: z.boolean().default(false),  // 越界开关，默认关
}
```

> 因为 **schemastery 非严格**，未知 yaml 键会被 merge 进来 →
> 必须写 `resolveDrawioConfig()` 做二次兜底（照 better-sidebar 的做法）。

---

## 五、工作区隔离如何落地

```
DSH workspace（命名项目目录）  ←→  session.header.cwd
        │
        ├─ 新建落点 = <cwd>/docs/diagrams/      （自动 mkdir -p）
        ├─ 可打开范围 = 整个 cwd 子树           （文件树里任何 .drawio）
        └─ UI 状态 = better-sidebar 已按 sessionId 做 localStorage 隔离，白拿
```

- 切换会话 → better-sidebar 换整套 tab 状态 → viewer 收到新的 `scope` → 重新 `load()` → 显示那个工作区的图纸。
- 每次请求都从 `sessionId` 重新解析 cwd，**不缓存跨请求的 cwd**（会话是活的）。
- `isWithin` 检查在 **read / write / create / list / exists 全部入口**都要做，一个都不能漏。

---

## 六、冷启动入口（你选定的 (A) + (B)）

**问题**：只做预览器 ⇒ 新工作区里一个 `.drawio` 都没有时，插件没有入口。

### (A) 官方左栏底部的「新建图纸」按钮

在 `dsh-client-ui-sidebar` 的 **`sidebar.footer.action`**（kind = **list**，可加项）注册一个小按钮。

- 它住在**官方左栏**（不是 better-sidebar），是那里唯一的加性席位。
- 点击 → `POST /drawio/api/create` 在 `<会话 cwd>/docs/diagrams/untitled-N.drawio` 生成空白图纸
  → `ctx.betterSidebar.openFile(scope, path)` 在侧边栏打开。
- 无会话 / 无 cwd 时按钮置灰并给 tooltip。
- 需要 `inject` 加 `'slots'`，用 `ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({...}, Comp))` 注册
  （`inject` 形式保证不依赖侧边栏的激活顺序）。

### (B) viewer 内的新建 / 另存为

- 工具栏「新建」：生成下一个 `untitled-N.drawio` 并 `openFile` 切换过去。
- 工具栏「另存为」：提示输入文件名 → 写入 `docs/diagrams/` → `openFile`。
- **打开不存在的路径**时：显示「此文件不存在」+「创建为空白图纸」按钮。
  这条让"在编辑器 tab 的路径输入框里敲 `docs/diagrams/x.drawio` 回车"变成可用的新建流程。

---

## 七、风险与对策

| 风险 | 严重度 | 对策 | 何时验证 |
|---|---|---|---|
| drawio 在 sandbox iframe 里静默不启动 | **高** | viewer 在主文档，自己造的 iframe **不加 sandbox**（或必须含 `allow-same-origin`） | P1 实测 `{event:'init'}` 到达 |
| drawio 需要 `'unsafe-eval'` | 中 | 先上紧 CSP 实测；报错再放开并记文档 | P1 |
| 100MB 静态资源服务（DSH 无先例） | 中 | `createReadStream().pipe(res)`；ETag 记忆化；`res.on('close')` 销毁流 | P1 |
| Windows 路径穿越检查写成 `/` | **高（必踩）** | 用 `path.sep`；列单测 | P1 |
| `.war` 内部布局与预期不符 | 中 | 解压器**两种布局都兼容**（自动定位含 `index.html` 的条目作根前缀） | P1 |
| 首次下载体验是一块白屏 | 中 | 分阶段进度上报 + 前端进度条；支持手动重试 | P1 |
| 缺 `.d.ts` 导致类型靠猜 | 低 | `schemastery`/`cordis`/`cordis-plugin-loader` **带原始 `.ts`**，去读它们；better-sidebar 带 `.d.ts` | 全程 |
| 重复挂载 → 整棵树启动失败 | **高** | 单路由注册点；`cordis.patch.yml` 抄 better-sidebar 的 `!!js` 退让守卫 | P0 |
| Windows 文件锁 → build EPERM | 中 | build 不 clean；client 改动靠 `dsh-client-hmr` 热替换 | P0 |
| 提交 `lib/` 与源码漂移 | 中 | CI 跑 `build` 后 `git diff --exit-code lib/` | P4 |

---

## 八、分阶段实施

每阶段都有**独立可验证的完成判据**。不要跳阶段 —— 尤其 P0，它先证管线，再写业务。

### P0 — 骨架跑通（先证管线，不写业务）

1. 按 `dsh-skillui` 抄出仓库骨架：`package.json` / `cordis.patch.yml` / `tsdown.config.ts` / tsconfig / `.gitignore`（**放行 `lib/`**）。
2. host 半：`name` + `inject` + 一个只记日志的 `apply`。
3. client 半：注册一个**恒显示 "hello"** 的 file viewer，`exts: ['drawio','dio']`。
4. `pnpm build` → 确认产出 `lib/index.js` + `lib/client.js`，且 `lib/client.js` 头部是 `window.__ModuleLoader__.load({ id: "dsh-drawio", factory: ... })`。
5. 安装：
   ```powershell
   cd $env:USERPROFILE\.dsh
   dsh plugin --profile desktop add "link:G:\claude_project\code-agent\dsh-drawio"
   ```
   然后确认 `profiles\desktop\package.json` 的 `dsh.profile.bundles` **已自动追加 `dsh-drawio`**。
6. 完全退出并重启 DSH Desktop → 浏览器 `Ctrl+Shift+R`。

**判据**：在侧边栏文件树点一个 `.drawio`（随便造一个空文件），能看到我们的 "hello" viewer；
并且**启动日志里没有 `duplicate prefix route`**。

> 这一步验证了：`dsh` 字段契约、`exports["./client"]`、`__ModuleLoader__` 包装格式、
> `dsh plugin add` 的 bundle 自动 reconcile、client 半能拿到 `ctx.betterSidebar`。**全部一次验完。**

### P1 — 编辑器起得来（最高风险，尽早做）

1. `webapp-install.ts`：下载 + sha256 校验 + 选择性解压（两种布局兼容）+ 标记文件 + 进度上报。
2. `assets.ts`：`/drawio/webapp/**` 静态服务（流式 + ETag/304 + Range + 完整 MIME + `sep` 穿越防护 + CSP）。
3. `client/embed-protocol.ts`：postMessage 封装（双向 origin/source 校验、`try/catch` JSON.parse）。
4. `DiagramViewer.tsx`：iframe（**无 sandbox**）+ configure 往返 + `init` 后 load 一张硬编码空图。
5. 实测确认 `{event:'init'}` 到达、画布出现、无 CSP 报错（必要时加 `'unsafe-eval'`）。

**判据**：在侧边栏里看到**真正可用的 drawio 画布**，能拖形状、能改属性；
DevTools Network 里**没有任何对非 `127.0.0.1` 主机的请求**（证明完全离线）。

### P2 — 读写闭环

1. `diagrams.ts`：`read` / `write` / `create` / `list` / `exists` + `isWithin` 围栏 + `writeFileAtomic` + mtime 冲突 409。
2. `drawio-xml.ts`：压缩判定（结构 + `@compressed` 双信号）、解码链、**保持原样式写回**。
3. viewer：`load()` 走 `/drawio/api/read`；`save`/`autosave` 处理；自身防抖落盘；dirty / saving / saved / failed 状态；冲突弹 UI（重新加载 / 覆盖 / 另存为）。
4. 未保存就关闭 tab / 刷新页面 → `beforeunload` 与 `exit` 事件兜底 flush。
5. 单测：围栏（大小写、混合分隔符、`..`）、`sep` 穿越、压缩判定、解码链、原子写、409 分支。

**判据**：画一个图形→保存→关闭→重开内容一致；
外部用编辑器改同一个文件后再保存 → **报冲突而不是静默覆盖**；
用 VS Code drawio 扩展生成的**压缩格式** `.drawio` 也能正确打开并原样写回。

### P3 — 工作区隔离 + 冷启动入口 + 打磨

1. 工作区键解析（`workspaceRegistry` 可选 + `realpath` 降级）；每个请求重新解析 cwd。
2. 冷启动入口 (A)：`sidebar.footer.action` 的「新建图纸」按钮。
3. 冷启动入口 (B)：viewer 内新建 / 另存为 / 不存在路径的创建提示。
4. 加载态、错误态、空态、首次下载进度 UI、重试按钮。
5. `Config` + `resolveDrawioConfig()`；`pluginSettings` 或 `installSettingsSection` 暴露少量用户可调项
   （主题、字号、autosaveDelay、diagramsDir）。
6. 中文文案；编辑器 `lang=zh`。
7. 文档里写明「把编辑器 tab 拖到主会话区域可变成悬浮窗口放大」（`floatWindows`）。

**判据**：两个不同工作区的会话来回切，各自只看到自己的图纸；
空工作区能一键新建第一张图纸；所有错误路径都有可读中文提示。

### P4 — 交付

1. `README.md`：安装（git 源 + `link:` 开发）、配置项表、已知限制（CSP、trademark、首次下载体积）、
   drawio 来源与 Apache-2.0 归属声明。
2. `LICENSE`（MIT）。
3. 可选 CI：`.github/workflows/ci.yml` → `pnpm typecheck && pnpm build && git diff --exit-code lib/`。
4. 打 tag `v0.1.0`；验证干净安装：
   ```powershell
   dsh plugin --profile desktop add "github:jaikensai888/dsh-drawio#v0.1.0"
   ```
5. 可选：给仓库打 GitHub topic `dsh-better-sidebar`，并向 `omdsh-dev/DSH-better-sidebar`
   提 PR，在 `src/client/plugins-viewers.ts` 加一条 `PluginEntry`（**我们是 viewer，不是 tab**），
   从而出现在设置页「添加插件」的推荐目录里。

**判据**：在一台没装过本插件的环境上，一条命令装完、重启后可直接画图并存盘。

---

## 九、验证手段

- **单测（vitest）**：见 P2 第 5 条 + `sep` 穿越 + MIME 表 + 压缩判定/解码 + 原子写 + 状态码分支。
- **端到端**：可以用 Chrome MCP 直接驱动 `http://127.0.0.1:43120`：
  真实点开 `.drawio` → 画图 → 保存 → 回文件系统核对内容。**不靠推断。**
- **离线验证**：DevTools Network 过滤非本机请求，必须为空。
- **回归**：每次重启后 grep 启动日志确认无 `duplicate prefix route`。
- **隔离验证**：两个工作区各自放一张同名图纸，来回切会话确认不串。

---

## 十、安装与迭代流程

```powershell
# 首次（开发）
cd G:\claude_project\code-agent\dsh-drawio
pnpm install && pnpm build
cd $env:USERPROFILE\.dsh
dsh plugin --profile desktop add "link:G:\claude_project\code-agent\dsh-drawio"
# → 自动追加到 profiles\desktop\package.json 的 dsh.profile.bundles
# 然后：完全退出并重启 DSH Desktop，浏览器 Ctrl+Shift+R

# 日常迭代
pnpm watch        # 只改 client → dsh-client-hmr 轮询 lib/client.js，自动热替换
                  # 不用重启、不用刷新
                  # 改 host → 重新 build + 重启 DSH Desktop
```

**不要把两种挂载方式混用**：既然声明了 `dsh.bundle.patch`，**就不要再往
`profiles/desktop/cordis.patch.yml` 手写挂载行** —— 会导致双挂载、两个 host 半、
`duplicate loader entry id` 直接失败。

---

## 十一、完成定义（Definition of Done）

- [ ] 侧边栏点 `.drawio` 能打开真正的 draw.io 编辑器
- [ ] 编辑后保存，磁盘上的文件内容正确（且保持原有压缩样式）
- [ ] 外部改动后保存会报冲突，不静默覆盖
- [ ] 切换工作区（会话）看到各自的图纸
- [ ] 空工作区能一键新建第一张图纸
- [ ] 全程无外部网络请求（除首次下载 drawio 资源）
- [ ] 中文 UI；错误路径都有可读提示
- [ ] `pnpm typecheck`、`pnpm test` 全绿；`lib/` 已提交且与源码同步
- [ ] README 完整（安装 / 配置 / 已知限制 / 归属声明）
- [ ] tag `v0.1.0` 已推送到 GitHub，git 源安装验证通过

---

## 十二、开放项（实施中再定）

1. drawio release tag 的**具体 pin 版本与 sha256** —— 实施时取当时最新稳定 release 并固化。
2. 是否支持 `.xml` 里的 mxfile（用 `detect` 嗅探 `<mxfile`/`<mxGraphModel>`，priority 高于 `code` 的 -100）。
3. 是否支持 `.drawio.svg` / `.drawio.png` 变体（需要 `detect` + 头部字节嗅探 `mxfile` 标记）。
4. 静态资源是否预生成 `.gz` 兄弟文件（省掉每次请求的 gzip CPU）。
5. 是否给模型加只读工具（当前**决定不做**，但架构上留了 `/drawio/api/*` 这个缝）。
