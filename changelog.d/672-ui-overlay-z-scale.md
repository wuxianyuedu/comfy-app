## Changed

- **浮层层级从「两条刻度」补成一张刻度表**（ISSUE #672 P4，规范 16 §16.2.5）：
  `globals.css` 的 `@theme` 与 `src/lib/shell/overlay-z.ts` 同步新增/重排六档 ——
  `base`(10) 局部叠层下限、`canvas-ui`(20) 画布 chrome、`canvas-max`(30) 画布最上层、
  `modal`(90) 模态与抽屉、`popup`(100) 挂在 `body` 的浮层、`toast`(1000) 全局提示。
  `zClass(tone)` 由档名派生工具类名，不手抄第二份 `z-*` 字符串表；
  `Z.overlay` 保留为 `modal` 的旧名（同值，不是第二档）。
- 三条关系写进契约测试：**档与档严格递增**、`modal` 不进 1000~1200（React Flow 节点
  选中态与悬浮态的位置）、**`popup` 高于 `modal`**（挂在 `body` 的下拉由模态内的控件
  打开，低于模态就等于「点得开、点不中」）。
- `ui/dialog` / `ui/sheet` 走 `z-modal`，`ui/popover` / `ui/dropdown-menu` /
  `ui/select` / `ui/tooltip` 走 `z-popup`，`ui/dialog-overlay` 的遮罩走 `z-modal`。

## Fixed

- **清零 7 处自成一档的 z 魔数**：视频队列模态 `z-9998`、底部状态栏 `z-[10000]`、
  消息中心 `z-[10020]`、产出抽屉 `z-80`/`z-90`、编辑器崩溃回退 `z-60`、
  日志面板 `z-99` + 弹层 `z-200`。其中日志面板的层级契约改为直接取刻度表的
  `Z.modal` / `Z.popup` —— 此前同一件事（一条模态遮罩）在库里有两个值。
- **11 处行内数字 `zIndex` 改走刻度表**（画布节点构建、子图卡片、锚柱圆柱、
  组底板、便签、节点内浮标）；节点内部的相对关系改用本模块具名常量表达，
  不再写裸数字。
- **69 处刻度之外的裸数字档改为具名档**：全屏视图与模态 → `z-modal`、
  画布工具栏/侧栏/面板/角标 → `z-canvas-ui`、画布最上层（IO 预览、底部工具栏、
  固定触发钮）→ `z-canvas-max`、下拉/气泡/右键菜单 → `z-popup`、
  画布内元素与卡片内遮罩 → `z-base`、底部状态栏 → `z-toast`。
- **2 处任意值写法清零**：`z-[10000]` / `z-[10020]`（规范 03 §3.2 已禁 arbitrary）。

## Added

- **`scripts/check-overlay-z.cjs`（`pnpm ui:overlay-z`，pre-commit 第 27 步）**：
  三条判据 —— Z1 行内数字 `zIndex`、Z2 任意值写法（**全库清零，硬闸**）、
  Z3 刻度之外的裸数字档（按文件记棘轮，只许降不许升，基线
  `scripts/.overlay-z-baseline.json`）。豁免显式：`ui/`（shadcn 工具生成、
  尽量不手改的目录，机械换算只会算错）、`<feature>/hooks/**`、测试文件。
- 契约测试 `tests/check-overlay-z.test.ts`（11 条：三条判据各自阻断、四类豁免、
  注释剥离、只降不许升、`--update` 拒绝放宽、`--report` 不判失败、治理后收紧）。
