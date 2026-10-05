## Added

- **Badge 尺寸轴补两档胶囊**：`size="pill-sm"`（`h-auto rounded-full px-1.5 py-0.5 text-3xs`）
  与 `size="pill-md"`（同形、`px-2 text-2xs`）。这两档不是新设计，是从调用点量出来的：
  此前 12 处各自手抄 `rounded-full px-1.5/2/2.5 py-0.5/-px text-2xs/3xs`，同一个角色
  三种写法。`badge.stories.tsx` 的尺寸矩阵跟着覆盖这两档。

## Changed

- **12 处手抄胶囊迁到 Badge 基座**（带 tone/size，颜色归到 §4.11.1 治理过的 tone 表 ——
  已签字口径）：`LlmLocalSection`（已覆盖 / 推荐）、`MessageCenterPanel`（新）、
  `NodesTab`（只读 / 有更新）、`WorkshopEncapsulationPanel`（已配置 / 未配置）、
  `WorkflowRunLogModal`（来源标签）、`CanvasSettingsPanel`（v1）、`HistoryPanel`（进行中）、
  `ProjectOutputs`（产出数）、`VideoQueueModal`（进行中数）。
  - 底色 α 从 `/15`、`/18`、`/20`、`/30` 统一成 `/10` ⇒ 背景变浅一档；部分字色换成
    `-strong` 档（更深）。其中「推荐」与「v1」两处原本就与 tone 表同值 ⇒ 零变化。
  - **顺带修掉一处不达标对比度**：来源标签原是 `text-ink-faint`(#a1a1aa) 落在
    `bg-subtle`(#f7f8fa)，算出来 **2.41:1**（连大字号 3:1 都不过）；neutral tone 给的
    `text-ink-muted`(#6b6b76) 是 **4.95:1**，过 AA 正文。
  - 描边：两档 pill 自带 `border-0`。第一版写的是调用点 `border-transparent`，实测
    纠正 —— 透明边框**照样占布局**（同串字 21px vs 19px），而 tone 只给边框色不给宽度，
    所以 `border-0` 不会被顶回来，调用点也不需要任何描边出口。
  - 高度实测（浏览器量计算样式，非推算）：`pill-sm` 对 `py-0.5` 旧站点 **+2px**
    （17→19px，宽度不变）；`pill-md` 对 `px-2.5` 站点高 **+2.5px**、宽 −4px；
    两处 `py-px` 的极紧站点（v1 / 来源标签）**+6px**（13→19px）—— 那 13px 是 inline
    盒的行盒产物，Badge 是 `inline-flex`，压不到行盒以下；试过补第三档 `pill-xs`
    也只能到 17px，为 2 处加第 6 档不值。⚠️ 这两处需要人眼看一次（本轮无法带数据复现）。

## Fixed

- **契约里一处说谎的表格行**：`chip/药丸` 那行原本指向 `.u-chip`，而 `.u-chip` 全仓
  **零消费者**（Known Gaps 已记）—— 把死类当规范写。改指 `ui/badge.tsx` 的 pill 两档。

## 明确排除（分诊实测，别当漏改清掉）

- 纯数字角标 7 处（计数器家族；其中 `SectionHeader.tsx:23` 与 `GroupedControls.tsx:101`
  类名**逐字相同** = 孪生）；序号圆 / 图标圆 6 处（`Workshop` 四个文件里类名逐字相同，
  是另一个孪生家族，需要自己的基元 —— **needs-design-decision**）；媒体/画布浮层字幕 3 处；
  可点 chip 6 处；`avatar` 兜底 1 处。
- 特别一处：`DetailHeader.tsx:147` 用 `ring-1 ring-inset` 而非 `border`，**代码注释写明
  是故意的**（描边不参与布局）。Badge 的 tone 带真边框，迁过去会把它刻意避开的布局位移
  请回来 —— 「形状像徽标」不构成迁移理由。
