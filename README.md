# dsh-drawio

**在 [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的侧边栏里直接画 draw.io 图。**
点开工作区里的 `.drawio` 文件就是一个**真正的 draw.io 画布**；图纸以普通文件躺在工作区里，
能进 git、能被 review、能被其他工具读写。编辑器本体**自托管**：首次使用时下载并做 sha256 校验，
之后**完全离线**运行。

[![CI](https://github.com/jaikensai888/dsh-drawio/actions/workflows/ci.yml/badge.svg)](https://github.com/jaikensai888/dsh-drawio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![target: DSH desktop profile](https://img.shields.io/badge/DSH-desktop%20profile-5b8def)](#环境要求)

> **English.** A self-hosted [draw.io](https://www.drawio.com/) editor embedded in the DSH Web GUI sidebar as a
> `.drawio` file previewer. Diagrams are ordinary workspace files; the editor is downloaded once from the pinned
> upstream release, hash-verified into `~/.dsh`, and then runs fully offline behind a strict CSP. It exposes **no
> model-facing tools** — this is a human-in-the-loop editor.

---

## 目录

- [为什么是"文件预览器"](#为什么是文件预览器)
- [特性](#特性)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [配置](#配置)
- [工作原理](#工作原理)
- [安全](#安全)
- [实测结论](#实测结论)
- [已知限制](#已知限制)
- [排错](#排错)
- [开发](#开发)
- [目录结构](#目录结构)
- [版本与发布](#版本与发布)
- [许可与归属](#许可与归属)

---

## 为什么是"文件预览器"

DSH 侧边栏(`dsh-better-sidebar`)已经有一棵工作区文件树。与其再做一个平行的"图纸仓库"，
不如让 `.drawio` 就是**文件**：侧边栏点它 → 该文件在编辑器标签页里打开 → 保存写回同一个路径。
于是 git diff、外部工具、模型读文件,全都不需要为"图纸"这个概念做任何特殊适配。

| 决策 | 取值 |
|---|---|
| 集成形态 | 注册 `.drawio` **文件预览器**(`ctx.betterSidebar.registerFileViewer`),不做独立侧边栏 Tab |
| 引擎来源 | 自托管 drawio webapp,首次使用时下载到 `~/.dsh/storages/dsh-drawio/` |
| 图纸存放 | 新建默认落 `<工作区>/docs/diagrams/`;工作区内**任意位置**的 `.drawio` 都能打开 |
| 冷启动入口 | 左栏底部图标按钮 + 编辑器内「新建 / 另存为」+ 打开不存在路径时提示创建 |
| 给模型的工具 | **无**(纯人工编辑) |
| 目标 profile | `desktop`(**不是** `web`) |
| 界面语言 | 中文 |
| 许可 | MIT(本插件);drawio webapp 运行期下载,不在本仓库分发 |

## 特性

- **真编辑器,不是只读预览。** 侧边栏里是可交互的 draw.io 画布:形状面板、格式面板、连线、图层都在。
- **图纸即文件。** 自动保存回原路径;新建默认进 `docs/diagrams/`,但任何工作区内的 `.drawio` 都能开。
- **编辑器自托管 + 离线。** 首次使用下载 pin 死的 drawio release 并校验 sha256,之后启动**零外部请求**。
- **不会静默覆盖。** 文件在编辑器之外被改过时,写入被拒(HTTP 409),面板顶部出现冲突条由你决定谁赢。
- **工作区围栏。** 读写以会话 cwd 为边界,越界请求直接 403;deployment 级可显式放行。
- **压缩/非压缩都认。** drawio 的 base64+deflate 压缩存储能打开;未改动的文件一个字节都不会被动。
- **窄面板也能用。** 侧边栏太窄时 drawio 会折叠面板,把标签页拖到主区域即可变成可缩放的悬浮窗口。
- **零构建安装。** 仓库提交了 `lib/` 构建产物,从 git 源安装不需要任何 build 步骤。

## 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| DSH | Desktop 2.0.4+(验证版本) | 目标 profile 是 `desktop` |
| `dsh-better-sidebar` | 0.17.1(验证版本) | 提供 `ctx.betterSidebar` 与 `sidebar.footer.action` 插槽 |
| Node | 22+(仅开发/构建需要) | 安装成品不需要 Node |
| 磁盘 | 约 147 MB | 解压后的 drawio webapp 落在 `~/.dsh`,与工作区无关 |
| 网络 | **仅首次**需要 | 下载约 51 MB(53,762,297 字节)的 `draw.war`;之后完全离线 |

## 安装

### 从 git 源安装(推荐)

```powershell
cd $env:USERPROFILE\.dsh
dsh plugin --profile desktop add "github:jaikensai888/dsh-drawio#v0.1.1"
```

然后 **完全退出并重启 DSH Desktop**(不是关窗口,要退出进程),再在浏览器里 `Ctrl+Shift+R`。

> `#v0.1.1` 可以换成 `#main` 追最新提交,或任意 tag。

### 从源码安装(开发用)

```powershell
git clone https://github.com/jaikensai888/dsh-drawio.git
cd dsh-drawio
pnpm install
pnpm build          # 生成 lib/;不 build 的话 link 安装会加载旧的 lib/
cd $env:USERPROFILE\.dsh
dsh plugin --profile desktop add "link:G:\path\to\dsh-drawio"
```

### 验证安装

1. 重启后侧边栏底部、**设置上方**应出现一个纯图标按钮(悬停提示「新建图纸」)。
2. 点它 → 新建一张 `docs/diagrams/untitled-1.drawio` 并打开编辑器标签页。
3. 首次会看到编辑器资源准备过程;完成后应出现 draw.io 画布。

命令行旁证(插件路由不在 GUI 的登录门后面):

```powershell
curl.exe http://127.0.0.1:43120/drawio/ping
curl.exe http://127.0.0.1:43120/drawio/api/webapp-status
```

### 卸载

```powershell
cd $env:USERPROFILE\.dsh
dsh plugin --profile desktop remove dsh-drawio
```

缓存的编辑器资源在 `~/.dsh/storages/dsh-drawio/`,删掉它不影响你的图纸。

## 使用

### 打开一张图纸

在侧边栏文件树里点任意 `.drawio` / `.dio` 文件,它会在编辑器标签页里打开(优先级 `0`,
即 `.drawio` 的默认预览器)。面板启动后会依次完成 `configure → init → load` 握手,
然后把你文件里的 XML 灌进画布。

### 新建图纸

三个入口,任选:

1. **左栏底部的图标按钮**(在设置上方)。它的图标尺寸跟着左栏展开/收起走,和设置图标一致。
   在一张图纸都还没有的新工作区里,这是唯一的入口。
2. 编辑器工具栏的「**新建**」。
3. 在编辑器标签页里打开一个**不存在的路径**时,面板会提供「创建为空白图纸」。

### 保存与冲突

保存是自动的:draw.io 每次改动后按 `autosaveDelayMs`(默认 1.5 s)发出 `autosave`,
插件再防抖 `writeDebounceMs`(默认 1.5 s)落盘。工具栏右侧显示状态:
`已同步 / 未保存 / 保存中… / 已保存 / 有冲突`。

**冲突**:如果文件在编辑器之外被改过(另一个编辑器、git checkout、模型改的),
写入会被拒绝(HTTP 409),面板顶部出现冲突条:

- **放弃本地改动,读磁盘** —— 用磁盘版本覆盖画布。
- **用我的版本覆盖** —— 强制写回。

插件**不会**替你选。

### 面板太窄

draw.io 在窄容器里会自己折叠形状/格式面板,这是它的正常行为。把编辑器的标签页**拖到主会话区域**,
它会变成一个可移动、可缩放、可置顶的悬浮窗口(`dsh-better-sidebar` 0.16+ 的 `floatWindows`),
拖回侧边栏即停靠。

## 配置

部署级配置写在 profile 的 `cordis.patch.yml` 里,挂在 `dsh-drawio` 那一行:

```yaml
- insert:
    - id: drawio
      name: 'dsh-drawio'
      config:
        diagramsDir: docs/diagrams
        uiTheme: kennedy
        language: zh
```

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `drawioVersion` | string | `v31.4.6` | pin 住的 drawio release tag |
| `drawioSha256` | string | (已 pin) | 该 release `draw.war` 的 sha256;不匹配就拒绝安装 |
| `editorUrl` | string | `''` | 逃生舱:非空则直接 iframe 这个 URL,跳过自托管安装 |
| `diagramsDir` | string | `docs/diagrams` | 新图纸落点,相对工作区;含 `..` 或绝对路径会退回默认值 |
| `autosaveDelayMs` | number | `1500` | 传给 drawio 的 `autosaveDelay` |
| `writeDebounceMs` | number | `1500` | 插件自己落盘前的空闲延迟;`0` 表示收到就写 |
| `uiTheme` | string | `kennedy` | drawio `ui` 参数;`min` 会砍掉形状/格式面板 |
| `language` | string | `zh` | drawio 界面语言 |
| `allowOutsideWorkspace` | boolean | `false` | 允许读写工作区之外的路径(默认关;围栏是会话 cwd) |

> **配置写错的代价不一样。**
> schemastery 会把未知键 merge 进配置对象,所以插件内部用 `resolveDrawioConfig()` **重新推导一遍**所有值,
> 多余的键一律忽略。但 schema 本身是**严格**的:把 `autosaveDelayMs` 写成 `"fast"` 这类类型错误会让
> Loader 判定校验失败,**这一行插件直接挂不起来**(编辑器标签页随之消失)。改 yaml 请按上表的类型写。

## 工作原理

### 两半结构

插件是标准的 cordis 双半结构:host 半跑在 DSH 主进程里,client 半作为 classic script 注入页面。

```
┌─ DSH Web GUI (浏览器) ────────────────────────────────────────────────┐
│  dsh-better-sidebar          文件树   侧边栏底部插槽                  │
│      │ registerFileViewer('.drawio')      │ sidebar.footer.action     │
│      ▼                                    ▼                           │
│  编辑器标签页 (React)  ◀──postMessage──▶  <iframe src="/drawio/webapp">│
│      │ fetch /drawio/api/*                                            │
└──────┼────────────────────────────────────────────────────────────────┘
       │ 同源 HTTP
┌──────▼─ DSH 主进程 (host 半) ─────────────────────────────────────────┐
│  prefix 路由 /drawio  ──▶ routes.ts 内部分派                          │
│      ├── /api/*     → diagrams.ts  (工作区围栏 + 原子写 + mtime 冲突)  │
│      └── /webapp/** → assets.ts    (stream + ETag/304 + Range + CSP)  │
│  首次使用: webapp-install.ts → ~/.dsh/storages/dsh-drawio/webapp      │
└───────────────────────────────────────────────────────────────────────┘
```

host 半只注册**一个** prefix 路由 `/drawio`(重复注册同一个 `(kind, path)` 会抛错并拖垮整棵插件树),
路由之间靠内部分派表区分。client 半只能 `require` 平台表里允许的模块
(`react`、`react/jsx-runtime`、`@deepseek-ai/cordis` 等),在构建期被打成
`window.__ModuleLoader__.load({...})` 包装的 classic script。

### HTTP 路由

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/drawio/ping` | 存活探测:插件名、路由前缀、pid、时间戳 |
| `GET` | `/drawio/api/config` | client 半启动时拉取的界面配置(embed URL、防抖、默认目录) |
| `GET` | `/drawio/api/workspace` | 当前会话的工作区身份(cwd / 显示名 / 是否可写) |
| `GET` | `/drawio/api/webapp-status` | 编辑器资源状态(是否已安装、进度、版本) |
| `POST` | `/drawio/api/webapp-status` | 触发首次下载安装 |
| `POST` | `/drawio/api/read` | 读图纸(XML + mtime) |
| `POST` | `/drawio/api/write` | 写图纸(带 mtime 前置条件,不匹配返回 409) |
| `POST` | `/drawio/api/create` | 在指定路径创建空白图纸(已存在则拒绝) |
| `POST` | `/drawio/api/list` | 列出目录下的 `.drawio` / `.dio` |
| `POST` | `/drawio/api/exists` | 判断路径是否存在 |
| `GET/HEAD` | `/drawio/webapp/**` | drawio 静态资源(ETag/304、Range/206/416、文档 CSP) |

同一个工作区路径**每次请求**都按会话 cwd + 配置现算一遍,不缓存跨会话的结论。

### 首次使用的自托管下载

1. `GET https://github.com/jgraph/drawio/releases/download/v31.4.6/draw.war`
   (tag 与 sha256 都冻结在代码里,上游换包不会悄悄变成"我们的"编辑器)。
2. 流式下载 + 边下边算哈希,不匹配就整包丢弃。
3. 解压到 `~/.dsh/storages/dsh-drawio/webapp`(布局无关,不依赖 war 内的目录形状)。
4. 原子换入并写 `.installed.json` 标记;下次启动直接命中,不再联网。

落点遵循 `DSH_HOME`(默认 `~/.dsh`),所以改了 `DSH_HOME` 的部署,缓存也跟着走。

### `.drawio` 存储格式

`.drawio` 里其实是一个 `<mxfile>`。drawio 可以把它存成**非压缩**(明文 `<mxGraphModel>`)或
**压缩**(`encodeURIComponent → deflateRaw → base64`)两种样式,插件两种都能读。
写回时会**沿用文件原本的样式**:原本压缩的就继续压缩。

## 安全

- **不信任请求来源。** 所有 `/drawio` 路由都过一遍 DNS-rebinding 信任围栏(与 `dsh-better-sidebar` 同款):
  校验 `Host` / `Origin`,防止页面里的第三方脚本把本机端口当内网代理用。
- **工作区围栏。** 读写路径必须落在会话 cwd 之内,`..` 与绝对路径都要过 `isWithin`;
  越界一律 403(`path 越出当前工作区`)。围栏基于 `path.sep` 而不是硬编码 `/`,Windows 上才不会误杀。
- **编辑器跑在严格 CSP 下。** 资源响应带 `connect-src 'self'`,drawio **无法**向任何外部主机发起连接;
  实测完整启动不需要 `'unsafe-eval'`。
- **iframe 不加 `sandbox`。** 这是刻意的:drawio 需要同源脚本与存储访问,`sandbox` 会让画布起不来。
  它靠的是上面两条(同源 CSP + 来源围栏),而不是 iframe 隔离。
- **写入是原子的。** 落盘走 `writeFileAtomic`(同目录临时文件 + rename),不会留下半截文件。
- **不给模型工具。** 插件不注册任何 model-facing tool,模型不能借它改你的图纸。

## 实测结论

以下都是在本机实测过的(Windows + DSH Desktop 2.0.4),不是设计意图:

| 项 | 结论 |
|---|---|
| 画布 | 侧边栏里出现真实 draw.io 画布,握手顺序 `configure → init → load` |
| 离线 | 完整启动共 25 个资源请求,**全部**来自同一个本机 host,外部请求 **0** |
| CSP | 无 CSP 违规;`frame-src 'self'`;不需要 `'unsafe-eval'` |
| UI 参数 | `ui=kennedy`(PLAN 里设想的 `ui=min` 会隐藏形状/格式面板,已否决) |
| 持久化 | 保存 → 关闭标签页 → 重开,内容一致 |
| 冲突 | 外部编辑后保存 → `409 conflict`,磁盘上的外部内容被完整保留 |
| 压缩 | 压缩态文件能打开、能保持压缩样式写回;未改动时**字节不变** |
| 围栏 | 打开工作区外的 `.drawio` 被拒:`path 越出当前工作区：…` |
| 冷启动 | 左栏按钮新建并打开 `untitled-1.drawio`;打开不存在的路径会在该路径创建 |
| 测试 | 120 个单元测试,CI 在 **Linux** 上跑 typecheck + test + build,并校验提交的 `lib/` 与源码一致 |

## 已知限制

- **压缩存储的图纸**能打开、能保持压缩样式写回,但 Node 的 zlib 与 drawio 的 pako **压不出相同字节**,
  所以**改过内容**的压缩文件会被整段重写(未改动则一个字节都不动)。
  想要 diff 友好的仓库,建议用非压缩格式保存。
- **窄面板**下形状/格式面板会被 drawio 自己收起(见[面板太窄](#面板太窄))。
- **首次使用**需要联网下载约 51 MB、解压约 147 MB;离线环境请用 `editorUrl` 指向已有的 drawio 部署。
- **围栏是字符串比较**,工作区内的**符号链接**指向工作区外时仍会被判为"在内"。要堵死需要 realpath,
  而那会误伤 junction 出来的合法工作区,所以留给平台沙箱。
- 目标 profile 是 **desktop**;`web` profile 未做验证。

## 排错

**插件整行挂不起来 / 编辑器标签页消失。**
先看配置类型——这是最常见的原因。日志在 `%APPDATA%\DSH Desktop\logs\dsh-*.log`,搜 `validation`:

```
cd $env:APPDATA\"DSH Desktop"\logs
Select-String -Path dsh-*.log -Pattern 'dsh-drawio|validation'
```

**首次打开一直白屏 / 一直"准备中"。**
① 确认路由活着:`curl.exe http://127.0.0.1:43120/drawio/ping`;
② 看资源状态:`curl.exe http://127.0.0.1:43120/drawio/api/webapp-status`;
③ 强制重下:删掉 `~/.dsh/storages/dsh-drawio/`,重开编辑器。

**下载失败(代理/公司网络)。**
用逃生舱,跳过自托管:

```yaml
config:
  editorUrl: 'https://your-internal-host/drawio/index.html'
```

**侧边栏底部没有「新建图纸」按钮。**
按钮来自 client 半,先 `Ctrl+Shift+R` 刷新页面(本机实测 `dsh-client-hmr` **不会**把 client bundle 热替换掉)。
仍然没有就检查 `dsh.client.inject` 里的 id 是否与已装插件对得上——**对不上的 id 会被静默跳过**,
控制台不会有明显报错。

**保存时反复出现冲突条。**
说明这个文件正在被别的进程改(另一个编辑器 / 正在跑的 `git` / 模型写入)。冲突条提供两个明确选择,
不会自动替你决定。若你确定要保留当前画布,选「用我的版本覆盖」。

**改完 host 半没生效。**
必须**完全退出并重启** DSH Desktop(关窗口不算),只刷新页面不够。

## 开发

```powershell
pnpm install
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest,120 个用例
pnpm build          # tsc 生成 .d.ts + tsdown 打 host/client 两半
pnpm dev            # tsdown --watch
```

两条硬规矩:

- **`lib/` 必须提交。** git 源安装没有 build 步骤,`lib/` 就是产物本身。构建配置里 `clean: false`
  (Windows 上清理会撞 EPERM),CI 会用 `git diff --exit-code -- lib/` 卡住"改了源码忘了重新 build"。
- **不要在 Windows 上用 PowerShell 的 `Get-Content -Raw` / `Set-Content` 往返改源码文件**,
  会把 UTF-8 变成 mojibake 并塞进 BOM。用编辑器的写文件能力。

改动的生效范围:

| 改了什么 | 需要做什么 |
|---|---|
| `src/client/**` | `pnpm build` + **刷新页面**(HMR 对本 bundle 不生效) |
| `src/**`(host 半) | `pnpm build` + **完全重启** DSH Desktop |

## 目录结构

```
dsh-drawio/
├─ package.json          dsh.bundle.patch + dsh.client{platform,inject}
├─ cordis.patch.yml      insert 一行挂载自己
├─ tsdown.config.ts      host→ESM;client→window.__ModuleLoader__ 包装
├─ src/
│  ├─ index.ts           host：name / inject / Config / apply(ctx, config)
│  ├─ config.ts          schemastery Config + resolveDrawioConfig 二次兜底
│  ├─ workspace.ts       工作区身份（workspaceRegistry 可选 + realpath 降级）
│  ├─ routes.ts          单 prefix 路由 /drawio，内部分派
│  ├─ assets.ts          drawio webapp 静态服务（stream + ETag/304 + Range + CSP）
│  ├─ diagrams.ts        会话级 .drawio 读写（围栏 + 原子写 + mtime 冲突检测）
│  ├─ drawio-xml.ts      压缩判定 / 解码 / 保持样式写回
│  ├─ webapp-install.ts  首次使用下载 draw.war → 校验 → 解压 → ~/.dsh
│  ├─ net/               trust-fence / fs-fence / atomic-write / mime / http
│  └─ client/
│     ├─ index.tsx        注册 .drawio 预览器 + 「新建图纸」footer 按钮
│     ├─ DiagramViewer.tsx
│     ├─ NewDiagramButton.tsx
│     ├─ embed-protocol.ts
│     └─ api.ts
├─ test/                 vitest（120 用例）
├─ lib/                  ★ 构建产物，必须提交（git 源安装无 build 步骤）
└─ docs/
   ├─ PLAN.md            分阶段实施计划与验收标准
   └─ GROUND-TRUTH.md    已核实的环境 / API 事实，含踩坑清单
```

## 版本与发布

- `main` 始终可安装;发版打 annotated tag(`vX.Y.Z`)。
- CI(`.github/workflows/ci.yml`)在 **Linux + Node 22 + 固定 pnpm 版本**上跑
  `typecheck → test → build`,再校验 `lib/` 与源码一致。
- 因为仓库提交构建产物,**没有 npm 发布**;安装走 git 源。

## 许可与归属

- 本插件代码:**MIT**(见 [`LICENSE`](LICENSE))。
- drawio 编辑器资源来自 [jgraph/drawio](https://github.com/jgraph/drawio)(**Apache-2.0**),
  由本插件在**运行时**下载到用户本机,**不在本仓库分发**。
- draw.io 是注册商标。本项目 UI 使用中性名称「图表编辑器」,不使用其 logo,也不暗示与官方有关联。
