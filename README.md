# dsh-drawio

在 [DSH](https://github.com/deepseek-ai/deepseek-harness) Web GUI 的侧边栏里直接画 draw.io 图。

[![CI](https://github.com/jaikensai888/dsh-drawio/actions/workflows/ci.yml/badge.svg)](https://github.com/jaikensai888/dsh-drawio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 说明

- 侧边栏点开工作区里的 `.drawio` 文件,就是一个**真正的 draw.io 画布**(形状面板、格式面板、连线都在)。
- 图纸就是**工作区里的普通文件**,能进 git、能被别的工具读写;新建默认落在 `<工作区>/docs/diagrams/`。
- 编辑器**自托管**:首次使用时下载并校验官方资源包到 `~/.dsh`(约 51 MB),之后**完全离线**。
- 改动**自动保存**;文件在编辑器之外被改过时会拒绝覆盖并让你选,不会静默吞掉别人的改动。
- 不给模型任何工具,这是给人用的编辑器。

## 安装

```powershell
cd $env:USERPROFILE\.dsh
dsh plugin --profile desktop add "github:jaikensai888/dsh-drawio#v0.1.1"
```

然后**完全退出并重启 DSH Desktop**(关窗口不算),再在浏览器里 `Ctrl+Shift+R`。

卸载:

```powershell
cd $env:USERPROFILE\.dsh
dsh plugin --profile desktop remove dsh-drawio
```

要求:DSH Desktop 2.0.4+、`dsh-better-sidebar` 0.17.1+;首次使用需要联网,之后离线可用。
想调图纸目录、编辑器地址等参数,写在 profile 的 `cordis.patch.yml` 里(键与默认值见 [`src/config.ts`](src/config.ts))。

## 使用

**打开图纸** —— 在侧边栏文件树里点任意 `.drawio`,它就在编辑器标签页里打开。

**新建图纸** —— 三个入口任选:

1. 左栏底部、**设置上方**的图标按钮(一张图纸都没有的新工作区里,这是唯一入口);
2. 编辑器工具栏的「**新建**」;
3. 在编辑器里打开一个**不存在的路径**时,面板会问你要不要在该路径创建。

**保存** —— 自动的。工具栏右侧显示 `已同步 / 未保存 / 保存中… / 已保存 / 有冲突`。
出现**冲突条**,说明文件被编辑器以外的东西改过;面板提供「放弃本地改动,读磁盘」和「用我的版本覆盖」,
由你决定,插件不会替你选。

**面板太窄** —— draw.io 会自己收起形状/格式面板。把编辑器标签页**拖到主会话区域**,
它会变成可移动、可缩放的悬浮窗口;拖回侧边栏即停靠。

---

许可 MIT。drawio 编辑器资源来自 [jgraph/drawio](https://github.com/jgraph/drawio)(Apache-2.0),
由本插件在运行时下载到本机,**不在本仓库分发**。
实现细节与踩坑记录见 [`docs/PLAN.md`](docs/PLAN.md) 和 [`docs/GROUND-TRUTH.md`](docs/GROUND-TRUTH.md)。
