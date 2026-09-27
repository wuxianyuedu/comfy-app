## Added

- 新增 `~/components/ui/hint` 的 `<Hint>` —— **「给一个控件配悬停提示」的全库单一出口**（P82 的合规出口，shadcn `composition.md` / 规范 §12.18 补地基）。形态是 `<Tooltip>` + `<TooltipTrigger render={…} />`（Base UI render prop，不用 `asChild`）的薄封装，调用点只多一对标签；三个 prop 各挡一类真实场景：
  - `label` 传 `undefined` / `""` / `false` 时整条提示不生效（不渲染浮层、trigger 置 `disabled`）—— 给 `title={cond ? "说明" : undefined}` 这类条件态用，调用处不必写两份 JSX；
  - `accessibleName` 给**纯图标按钮**把 `label` 同时写成子元素的 `aria-label`（子元素已自带则不覆盖）—— 原生 `title` 在图标按钮上兼职充当可访问名，只搬文案不搬名字会撞规范 §6.1「图标按钮必须 aria-label」；
  - `wrap` 把提示挂到一层 `inline-flex` 锚点上 —— `disabled` 的按钮浏览器不发指针事件，trigger 落在按钮本体上提示弹不出来，而「为什么不能点」恰恰是最需要说出口的一句（原生 `title` 反而能弹）。
- `<Hint>` 配 7 条用例（`src/components/ui/hint.test.tsx`）：出得来提示 / 空 label 不出但按钮照常可点 / 补名与不覆盖已有名 / 有可见文字时不补名 / `onClick`+`disabled` 不被 render 接管吃掉 / `wrap` 下禁用按钮仍能问出原因。按 §18.6 在 `vitest.config.ts` **两处同批**登记（`coverage.include` + `thresholds` 实测 100/100/100/100）。

## Changed

- **视图层 `<Button>` 的原生 `title=` 清零**：157 处 / 69 文件改走 `<Hint>`（`components/studio/**` · `components/workshop/**` · `app/(main)/settings/**`）。用 TypeScript 编译器 API 做形态判定与改写（属性段里的 `onClick={() => …}` 会让正则早停，正则不可用），逐处按子节点决定补不补可访问名。
  ⚠️ **157 与基线 78 的差是判据漏计**：棘轮那条 `<Button(?=[\s/>])([^>]*)>` 在箭头函数处截断，`title=` 排在 `onClick={() => …}` 之后的都没被数到（`LogPanel.tsx` 实测 10 处、基线只记 3 处）。治理按 AST 实测清单做，收完之后**两种口径都是 0**，`--update` 因此是一次合法下降（78 → 0）；判据本身换成 brace/quote-aware 的实现放在下一个 PR（与升硬闸同批），否则硬闸会建在看不见的存量上。
- 四处「壳组件」把 `title` prop 一并改名 `hint`（`canvas/CanvasArea` 与 `ScriptMarkdownEditor.parts` 的 `ToolbarButton`、`WorkflowNodeParts.WorkflowNodeActionButton`、`UsageTestDialog.FieldImageButton`），23 个调用点同步 —— 视图层不再留任何「名字暗示原生 title」的按钮 API。
- `ui/tooltip.tsx` 的 `TooltipProvider` 默认 `delay` 0 → **300**：贴近原生 `title=` 的出现节奏，避免鼠标划过密集工具条时浮层连弹（已登记进规范 §16.8 的本地改动台账）。
- 三条与 `title=` 绑定的注释按新形态改写（`SelectedToolbar` 的「只有 title」→「只有悬停提示」、`SaveExportButton` 的「写进 title」、`LogPanel` 的「title 写明范围」）。

## Fixed

- 定位方式跟上新形态的 8 条用例：`LogPanel.test.tsx` 翻页钮改走 `getByRole("button", { name })`（`accessibleName` 补出来的名字），页脚两枚筛选标签改走 `data-testid` + `toBeDisabled()`（「该层筛选已去掉」的表现从「提示消失」换成标签禁用，语义等价且不依赖悬停）；`CanvasNode.test.tsx` 4 条、`SubgraphHeader.test.tsx` 2 条、`MaterialLibraryPanel.test.tsx` 1 条同样从 `getByTitle` 换到 `getByRole`；`SourceModal.test.tsx` 数关闭控件的选择器从 `button[title="关闭"]` 换到 `button[aria-label="关闭"]`（那枚按钮本来就有 `aria-label`，说明文字改由 `<Hint>` 承载）。
- `EncapsulationTestForm.test.tsx` 的「禁用原因」用例改为悬停锚点读浮层（`wrap` 一档的既有语义），不再读 `title` 属性。
- 迁移后 `<Hint>` 成为迭代器最外层元素的 9 处，`key` 从内层 `<Button>` 上移到 `<Hint>`（留在内层等于没给，`react/jsx-key` 当场红）。
- 重生成两份被本次改动改到的快照（`FilmStudio` / `WorkflowSubgraphNode`）。它们同时补齐了此前没跟上的 P75（`data-slot="empty*"`）与 P81（`data-icon`）漂移 —— 这两条在各自 PR 里没重算快照，用例在 `master` 上本就是红的。
