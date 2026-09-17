# dsh-drawio

把 **draw.io（diagrams.net）图表编辑器**集成进 [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的侧边栏，图纸以普通 `.drawio` 文件保存在**当前工作区**里。

- 宿主：`dsh-better-sidebar` 的 `ctx.betterSidebar` 服务（注册 `.drawio` 文件预览器）
- 编辑器：**自托管**的 drawio webapp，首次使用时自动下载到 `~/.dsh`，之后完全离线
- 存储：图纸就是工作区里的文件（新建默认落 `<工作区>/docs/diagrams/`），可进 git

> **状态：P2（读写闭环）已落地。** 侧边栏点 `.drawio` 会启动**真正的 draw.io 画布**，
> 编辑会自动落盘到工作区文件；外部改动被 mtime 冲突检测挡住，**不会静默覆盖**；
> 压缩存储的图纸能打开并**保持压缩样式**写回。
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

## 计划中的安装方式

```powershell
# git 源安装（零构建：本仓库提交 lib/ 构建产物）
cd $env:USERPROFILE\.dsh
dsh plugin --profile desktop add "github:jaikensai888/dsh-drawio#v0.1.0"
# 然后完全退出并重启 DSH Desktop，浏览器 Ctrl+Shift+R
```

本地开发（`link:` 方式）见 [`docs/PLAN.md`](docs/PLAN.md) 第九节。

---

## 仓库结构（目标）

```
dsh-drawio/
├─ package.json          dsh.bundle.patch + dsh.client{platform,inject}
├─ cordis.patch.yml      insert 一行挂载自己
├─ tsdown.config.ts      host→ESM；client→window.__ModuleLoader__ 包装
├─ src/
│  ├─ index.ts           host：name / inject / Config / apply(ctx, config)
│  ├─ routes.ts          单 prefix 路由 /drawio，内部二分派
│  ├─ assets.ts          drawio webapp 静态服务（stream + ETag/304）
│  ├─ diagrams.ts        会话级 .drawio 读写（围栏 + 原子写 + mtime 冲突检测）
│  ├─ webapp-install.ts  首次使用下载 draw.war → 选择性解压 → ~/.dsh
│  ├─ net/               trust-fence / mime / http 工具
│  └─ client/
│     ├─ index.tsx       inject=['betterSidebar'] → registerFileViewer
│     ├─ DiagramViewer.tsx
│     └─ embed-protocol.ts
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
