## Fixed

- **设置页「外观主题」三组的选中档缺了那一半悬停值，划过**已选中**的那一枚时会被改写回「未选中」（ISSUE #1925 第五批）**：
  底是 `Button variant="ghost"`（无条件 `hover:bg-muted hover:text-foreground`），
  而选中档只钉了 `data-checked:border-primary data-checked:bg-primary-soft data-checked:text-*`、
  **没钉悬停值** —— 于是鼠标划过已选中的主题卡 / 「圆角」「标题字阶」chip 时，
  `hover:` 胜出、底色翻成 `muted`、字色翻成 `foreground`，「选中」在悬停期间变回「未选中」。
  - **这一处第一次把特异性算清了**（不再靠「大概会被盖掉」）：`data-checked:*` 编译出的选择器是
    `.data-checked\:bg-primary-soft:where([data-state=checked])` —— `:where()` **零特异性**，
    整条 `(0,1,0)`；而 `hover:bg-muted` 是 `(0,2,0)`。**悬停档稳赢，与两条规则在产物里的先后无关。**
    所以「选中档必须先钉住自己的 `hover:`」不是风格偏好，是被特异性强制的一条判据。
  - 修法是**就地钉** `data-checked:hover:*`（描边 / 底色 / 字色三层同值），不是换 `ui/select-chip`：
    这三组的单选语义与方向键契约由 `RadioGroup` 基元给（roving tabindex + Arrow 移动并选中），
    换成 `SelectChip` 会把那条契约丢掉 —— 与 #1925 第三批 `CanvasPanelToolbar` 同一条取舍。
  - 判据：`AppearanceSection.test.tsx` 新增 2 条（主题卡 1 条 + 两排 chip 1 条，钉选中档三层悬停值俱在）。
    **做了负对照**：把实现 revert 回旧形态，这 2 条全红。

## Changed

- **「一排里选一个」收口第五批（ISSUE #1925 再收一批）—— 从零重推全库，2 处落点，并第一次把这一族的形状判据说清**。

  - **`library/ResourceLibrary` 的作用域切换（本项目 / 跨项目）→ `ui/tabs` 的 `line` 档**。
    它是「下划线页签」那一族的**第五处** —— 与 `HistoryPanel`、`MaterialLibraryPanel` 的作用域切换
    **逐字同形**，只是此前藏在 `ToggleGroup` 里、靠 `after:bottom-[-13px]` 硬凑对齐
    （未选中档不写下划线 ⇒ 两枚不同高、切来切去文字基线上下跳）；语义也错了半格
    （`aria-pressed` 是「这开关开着吗」，可这一排只能选一个）。改用 `ui/tabs` `line` 档后两枚同高同基线。

  - **形状判据从「`Button` + 选中三元」放宽到「一排里选一个是隐藏的取值判据」**：
    `aria-pressed` / `data-pressed` / `after:` 下划线都是它的外衣，**认外衣就会漏**
    —— 这一处正因为穿的是 `ToggleGroup` 那件外衣，前三批沿 `Button` + 三元扫时从没进过视线。

  - **确认 4 类刻意不换的新形态**（不是漏，是判过）：浏览器式页签栏（带关闭按钮 + 拖拽 + `role="tablist"`，
    两形态共用 `.u-tab-active`）、多选 checkbox 行（`role="checkbox"`，多项同时为真）、
    下拉选项行（`role="option"`，已有唯一实现）、已在 P77 收口的 `ToggleGroup`。

  - 判据：`ResourceLibrary.test.tsx` 读法修正 1 条（`role="button"` → `role="tab"`）+
    新增 1 条（钉「不再有 `after:bottom-[-13px]` 那类硬凑偏移」与 `data-active` 驱动的下划线）。

## Docs

- 规范 §16.2.4.75 的落点登记表新增第五批 2 行，并补一条注：这一族的形状判据要放宽到
  「隐藏的取值判据」、选中档钉悬停是被 `:where()` 零特异性强制的一条判据、以及 4 类刻意不换的形态。
