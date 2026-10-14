## Changed

- **「一排里选一个」的 chip 收口到 `ui/select-chip`（ISSUE #1925 的余量）**：继上一批修掉历史页状态筛选页签的「幽灵类名」之后，把同一个形状**剩下的四处**一次收口 —— `model/ModelLibrary` 类型筛选、`studio/ModelLibrary` 的私有 `FilterChip`、`studio/project-canvas/HistoryPanel` 的类型筛选（都换成 `SelectChip`），以及同一文件里的作用域切换（换成 `ui/tabs` 的 `line` 档）。
  - 根因是同一个**看不见的接缝**：手搓的选中三元只写了「未选中之外」的那一半，而 `Button variant="outline"` 自带 `hover:bg-muted hover:text-foreground` —— 划过**已选中**的那一枚时悬停档胜出，紫色选中的 chip 变成白字灰底，看上去像「未选中」（用户原话「悬浮和非悬浮一个紫色，一个白色」）。逐个调用点看不出来，缺的那一半在 `buttonVariants.outline` 里。
  - 作用域切换另有布局缺陷：选中给 `border-b-2`、未选中**不给**，两枚不同高，切换时文字基线上下跳。换成 `ui/tabs` 的 `line` 档后由 `data-active` 驱动（字色 + 下划线两层），两枚同高。
  - 语义一并回到正确的**单选**：类型筛选从 `aria-pressed` 按钮回到 `radiogroup` + `radio`（`aria-checked` 驱动视觉与可访问性，同一入参不可能只改一半）。
  - 判据：`model/ModelLibrary.test.tsx` 改 3 条 + 新增 2 条、`HistoryPanel.test.tsx` 新增 5 条、`studio/ModelLibrary.integration.test.tsx` 新增 1 条。三处都做了**负对照** —— 把实现 revert 回去，新用例分别红 5 / 5 / 1 条，证明它们抓的是真东西而不是巧合。
  - 刻意**不新增扫描器**：「一排里选一个」在文本上退化成「一个 `<Button>` + 一个三元」，与「一排并列但各自独立动作」的普通工具条同形，机器分不出单选还是多动作；按类名字面量扫会命中 `OptionListPopover` 的行与本就该有底色的显示态 chip，等于逼人把正确的代码改成错的。取舍与已收口落点记在规范 §16.2.4.75。

## Docs

- 规范 §16.2.4 台账新增一行「一排里选一个的 chip」+ 新增 §16.2.4.75（20 处同形的接缝、`SelectChip` 的四层选中态与 `shape` 轴、下划线页签走 `ui/tabs` 的理由、以及「为什么不成机器判据」的明确取舍与落点登记表）。
