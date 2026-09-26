## Fixed

- **日志面板的级别页签在浅色主题下看不出「选中的是哪一项」（ISSUE #609 的回归）**。`src/components/studio/logs/LogFilterBar.tsx` 的级别 `ToggleGroupItem` 此前把选中视觉整个交给基元的 `data-[pressed]:bg-muted`，而 `--color-muted → --color-subtle` 在浅色主题下是 `#f7f8fa` —— 与它所在行头的底色 `bg-surface-1`（同为 `#f7f8fa`）**是同一个值**，于是「选中」在浅色下完全不可见（深色分别是 `#141419` / `#16161c`，也只是勉强看出）。这正是 ISSUE #609 当初报的那件事。
  - 回归是怎么进来的：P77 二批把「手写 `aria-pressed` 的 2–7 项选项组」统一迁到 `ui/toggle-group`（那是对的，a11y 语义归基元），但迁移时把**选中视觉**也一并交给了基元 —— 而 #609 的修法恰恰是「选中态不能只有底色一层」。行为语义统一 ≠ 视觉档位可以退回单层。
  - 修法是**分层**：交互与状态仍由基元持有（`aria-pressed` / `data-pressed` 不动），只把选中档的三层表达挂回 item —— 新增 `FILTER_SELECTED_ITEM_STYLES`（底色 `bg-primary/12!` + 描边 `ring-1 ring-primary/45` + 字重 `font-semibold`），仅在 `option.value === filter` 时挂上。
  - 为什么底色要加 `!`：基元的 `data-[pressed]:bg-muted` 是**属性选择器**（特异性 `(0,2,0)`），裸 utility（`(0,1,0)`）在 CSS 层面就压不过它，与书写顺序无关；描边与字重不参与这场冲突（基元不在 pressed 上设 box-shadow / 字重），照常挂。
- 测试断言**一个字没改** —— `LogPanel.test.tsx` 那条「选中的类别在浅色/深色主题下都看得出（不是只差一个近乎同值的底色）」本来就是红的，它报的是真回归，不是过期断言：改的是代码，改完即绿。
