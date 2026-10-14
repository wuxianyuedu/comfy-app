## Changed

- **client chunk 体积预算基线抬高（ISSUE #1916）**：`scripts/.bundle-budget-baseline.json`
  记的实测初值从 `gzip 2227.3 KB / 215 文件`（基线 `f03ccf0e`）抬到
  `gzip 2272.1 KB / 221 文件`（本检出 HEAD `8d15f9fe`），走 §13.5.4 的例外流程认账
  （`--update --allow-increase`）。

  **为什么是「认账」而不是「找人收」**：逐档二分复算了 `f03ccf0e..HEAD` 这 71 次提交的
  产物读数，涨幅既不是抖动、也不是换名或重排 —— 按内容指纹对齐后，净增
  `+44.8 KB gzip / +6 文件` 里约 **93% 来自两次提交**：

  | 提交 | 主题 | 涨幅 |
  | ---- | ---- | ---- |
  | `1c020599` | 整屏路由页自带精简标题行（新增 `WindowControls` / `WindowTitleBar` / `ShellFullPage`，重写 `login/page.tsx`） | `+17 KB / +1 文件` |
  | `23c9c534` | ComfyUI 运行态独立成页（ISSUE #1900：新增 `ComfyuiControlView` / `use-comfyui-control` / `comfyui-control-config`，并把 `RuntimeLogBox` 一族搬到共用目录） | `+25 KB / +5 文件` |

  这两次各带 ~800 / ~1050 行客户端源码，且新页的视图经 `lazyView` 动态分包
  （`WorkspaceViewStack.tsx`）—— **没有可回收的浪费字节**，「找人收」没有落点。
  其余 69 次提交合计净增约 `+3 KB`。

  **本仓库的 bundle 预算从来不是「不许涨」而是棘轮**：判红的正当出路就是在 PR 里贴
  before/after 两档读数 + 说明为什么值这个体积，评审确认后认账。本次即该流程。
