## Added

- **`~/components/workshop/IndexDot`**：工坊五个界面里**逐字抄了五份**的那枚序号圆
  （`bg-primary-soft text-primary grid size-6|7 shrink-0 place-items-center rounded-full
  text-xs font-semibold`）收进一个件，两档 `size="sm"`(24px，四处用的那档) /
  `size="lg"`(28px，`FinalComposer` 那一档)，`className` 追加在末尾以便调用点覆盖。
  住在 `workshop/` 而不是提升到 `ui/`：五个消费者全在工坊内，目前看不出第二个域的
  调用点（规范 §12.15 第三条）。
  保留 `grid place-items-center` 不是随手写的居中 —— 契约 §Components「基元纪律 2」：
  `size-*` 对 `display: inline` 不生效，丢了 grid 这个圆会变成约 4×20px 的竖线，
  而原来五处都恰好嵌在 flex 容器里才「碰巧」成立。

## Changed

- 五处调用点改用该件：`CharacterDesigner`、`FinalComposer`(`size="lg"`)、`ShotStudio`、
  `StoryboardPlanner.parts`、`VideoStudio.parts`。`shrink-0` 统一带上（原来三处有一处、
  两处没有）—— 序号圆不该被 flex 压扁；两处新增的站点其兄弟元素都不是截断文本，
  加它只会防止极端宽度下被挤扁，不改变正常排版。

## Added

- **防回潮判据**（`tests/design-md-contract-sync.test.ts`，pre-commit 固定清单成员）：
  那五个类名标记（`bg-primary-soft` / `place-items-center` / `rounded-full` /
  `text-xs font-semibold` / `size-6|7`）**全命中**的文件只许是 `IndexDot.tsx` 一个。
  按「标记集合」判而不是按先后顺序判 —— 实现里 `size-*` 由三元式给出、排在
  `rounded-full` 之后，顺序判据会漏掉实现自己。
