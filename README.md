# dsh-drawio

把 **draw.io（diagrams.net）图表编辑器**集成进 [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的侧边栏，图纸以普通 `.drawio` 文件保存在**当前工作区**里。

- 宿主：`dsh-better-sidebar` 的 `ctx.betterSidebar` 服务（注册 `.drawio` 文件预览器）
- 编辑器：**自托管**的 drawio webapp，首次使用时自动下载到 `~/.dsh`，之后完全离线
- 存储：图纸就是工作区里的文件（新建默认落 `<工作区>/docs/diagrams/`），可进 git

> **状态：P3（工作区隔离 + 冷启动入口 + 打磨）已落地。**
> 侧边栏点 `.drawio` 会启动**真正的 draw.io 画布**，编辑自动落盘；外部改动会被冲突检测挡住；
> 压缩存储的图纸能打开并保持样式写回；官方左栏底部有「新建图纸」入口；
> 工作区隔离以会话 cwd 为准，deployment 级配置可调。
> 首次使用自动下载并校验 draw.io 资源包到 `~/.dsh/storages/dsh-drawio/`，之后完全离线。
> 实施计划见 [`docs/PLAN.md`](docs/PLAN.md)，所有已核实的环境与 API 事实（含踩坑清单）
> 见 [`docs/GROUND-TRUTH.md`](docs/GROUND-TRUTH.md)。

---

## 已锁定的决策

| 项 | 决定 |
|---|---|
| 引擎来源 | 自托管 drawio webapp，首次使用时自动下载到 `~/.dsh/storages/dsh-drawio/` |
| 图纸存放 | 固定 `<工作区>/docs/diagrams/`；但**可打开**工作区内任意位置的 `.drawio` |
| 集成形态 | 注册 `.drawio` **文件预览器**（不做独立 Tab） |
| 冷启动入口 | (A) 官方左栏 `sidebar.footer.action` 注册「新建图纸」按钮 + (B) viewer 内「新建/另存为」且打开不存在路径时提示创建 |
| 给模型的工具 | 不做（纯人工编辑） |
| 界面语言 | 中文 |
| 包名 / 仓库 | `dsh-drawio` / `jaikensai888/dsh-drawio` |
| 目标 profile | `desktop`（**不是** `web`） |
| 许可 | MIT（本插件自身）；drawio webapp 运行期下载，不在本仓库分发 |

---

## 使用提示

**侧边栏太窄、形状/格式面板被收起？** 把编辑器的标签页**拖到主会话区域**，
它会变成一个可移动、可缩放、可置顶的悬浮窗口（`dsh-better-sidebar` 0.16+ 的
`floatWindows`），拖回侧边栏即停靠。draw.io 在窄容器里会自己折叠面板，这是它的正常行为，
不是插件的限制。

**新建图纸**有三个入口：

1. 官方左栏底部的「**新建图纸**」按钮 —— 在一张图纸都还没有的新工作区里，这是唯一的入口。
2. 编辑器工具栏的「**新建**」。
3. 在编辑器标签页里打开一个**不存在的路径**时，面板会提供「创建为空白图纸」。

**保存**是自动的：draw.io 每次改动后约 1.5 秒发出 `autosave`，插件再防抖落盘，
工具栏右侧显示 `已同步 / 未保存 / 保存中… / 已保存 / 有冲突`。

**冲突**：如果文件在编辑器之外被改过，保存会被拒绝（HTTP 409），面板顶部出现冲突条，
提供「放弃本地改动，读磁盘」和「用我的版本覆盖」——**不会静默覆盖**。

---

## 安装

```powershell
# git 源安装（零构建：本仓库提交 lib/ 构建产物）
cd $env:USERPROFILE\.dsh
dsh plugin --profile desktop add "github:jaikensai888/dsh-drawio#v0.1.0"
# 然后完全退出并重启 DSH Desktop，浏览器 Ctrl+Shift+R
```

本地开发（`link:` 方式）：

```powershell
cd G:\claude_project\code-agent\dsh-drawio
pnpm install && pnpm build
cd $env:USERPROFILE\.dsh
dsh plugin --profile desktop add "link:G:\claude_project\code-agent\dsh-drawio"
# 重启 DSH Desktop + 刷新页面
```

> **改 client 半请刷新页面。** 本机实测 `dsh-client-hmr` **没有**把 client bundle 热替换掉
> （见 `docs/GROUND-TRUTH.md` §11.5），不要指望省掉刷新这一步。改 host 半则需要重启。

---

## 配置

部署级配置写在 profile 的 `cordis.patch.yml` 里，挂在 `dsh-drawio` 这一行：

```yaml
- insert:
    - id: drawio
      name: 'dsh-drawio'
      config:
        diagramsDir: docs/diagrams
        uiTheme: kennedy
        language: zh
```

| 键 | 默认 | 说明 |
|---|---|---|
| `drawioVersion` | `v31.4.6` | pin 住的 drawio release tag |
| `drawioSha256` | （已 pin） | 该 release `draw.war` 的 sha256；不匹配就拒绝安装 |
| `editorUrl` | `''` | 逃生舱：非空则直接 iframe 这个 URL，跳过自托管安装 |
| `diagramsDir` | `docs/diagrams` | 新图纸落点，相对工作区；含 `..` 或绝对路径会退回默认值 |
| `autosaveDelayMs` | `1500` | 传给 drawio 的 `autosaveDelay` |
| `writeDebounceMs` | `1500` | 插件自己落盘前的空闲延迟；`0` 表示收到就写 |
| `uiTheme` | `kennedy` | drawio `ui` 参数；`min` 会砍掉形状/格式面板 |
| `language` | `zh` | drawio 界面语言 |
| `allowOutsideWorkspace` | `false` | 允许读写工作区之外的路径（默认关；围栏是会话 cwd） |

> schemastery 是**非严格**的，未知键会被 merge 进配置对象，所以这些值在插件里
> 会由 `resolveDrawioConfig()` **重新推导一遍**再使用。
>
> ⚠️ 但 schema 本身是**严格**的：`autosaveDelayMs: "fast"` 这种类型错误会被 Loader
> 直接判为校验失败，**这一行插件会挂不起来**（编辑器标签页随之消失）。改 yaml 时请按上表的类型写；
> 写错了先看 `%APPDATA%\DSH Desktop\logs\dsh-*.log` 里的 validation 报错。

---

## 已知限制

- **压缩存储的 `.drawio`**：能打开、能保持压缩样式写回。但 Node 的 zlib 与 drawio 的 pako
  **压不出相同字节**，所以改了内容的压缩文件会整段重写（未改动则一个字节都不动）。
  想让 diff 友好，建议用未压缩格式保存。
- **面板很窄时**形状/格式面板会被 drawio 收起（见上面的使用提示）。
- **首次使用**需要联网下载约 51 MB 的 drawio 资源包并解压约 147 MB 到
  `~/.dsh/storages/dsh-drawio/`。之后完全离线：实测完整启动只有本机请求，外部请求为 0。
- drawio 资源由本插件打上 CSP（`connect-src 'self'`），编辑器**无法**向任何外部主机发起连接。

---

## 仓库结构

```
dsh-drawio/
├─ package.json          dsh.bundle.patch + dsh.client{platform,inject}
├─ cordis.patch.yml      insert 一行挂载自己
├─ tsdown.config.ts      host→ESM；client→window.__ModuleLoader__ 包装
├─ src/
│  ├─ index.ts           host：name / inject / Config / apply(ctx, config)
│  ├─ config.ts          schemastery Config + resolveDrawioConfig 二次兜底
│  ├─ workspace.ts       工作区身份（workspaceRegistry 可选 + realpath 降级）
│  ├─ routes.ts          单 prefix 路由 /drawio，内部分派
│  ├─ assets.ts          drawio webapp 静态服务（stream + ETag/304 + Range + CSP）
│  ├─ diagrams.ts        会话级 .drawio 读写（围栏 + 原子写 + mtime 冲突检测）
│  ├─ drawio-xml.ts      压缩判定 / 解码 / 保持样式写回
│  ├─ webapp-install.ts  首次使用下载 draw.war → 选择性解压 → ~/.dsh
│  ├─ net/               trust-fence / fs-fence / atomic-write / mime / http
│  └─ client/
│     ├─ index.tsx        注册 .drawio 预览器 + 「新建图纸」footer 按钮
│     ├─ DiagramViewer.tsx
│     ├─ NewDiagramButton.tsx
│     ├─ embed-protocol.ts
│     └─ api.ts
├─ test/                 vitest
├─ lib/                  ★ 构建产物，必须提交（git 源安装无 build 步骤）
└─ docs/
   ├─ PLAN.md
   └─ GROUND-TRUTH.md
```

## 许可与归属

- 本插件代码：MIT。
- drawio 编辑器资源：来自 [jgraph/drawio](https://github.com/jgraph/drawio)（Apache-2.0），
  由本插件在**运行时**下载到用户本机，**不在本仓库分发**。
  draw.io 是注册商标，本项目 UI 使用中性名称「图表编辑器」，不使用其 logo，亦不暗示官方关联。
