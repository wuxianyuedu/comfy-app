## Added

- **UI 基元棘轮新增 P78「视图层裸写 `<label>`」（棘轮，`scripts/check-ui-primitives.cjs`）**：
  与 P23 是同一族账的两层——P23（硬闸、视图层已清零）数的是「`<label>` + 控件
  同文件出现」的**表单行组合形态**，15 处已收口到 `~/components/ui/form-field`
  的 `FormField`；P78（本条，棘轮）数的是**任何** `<label` 起始标签——包含那
  些没配显式控件、只做视觉分组或给 Base UI Checkbox 当点击区的孤立 label。
  这类不该套 `FormField`（它是一行表单），但 shadcn `ui/field` 的 `FieldLabel`
  或 Base UI `Checkbox` 的 children 才是合规出口——裸 `<label>` 缺 `htmlFor`
  时点标签不聚焦控件、读屏器把它读成孤立文本。
  锚点 `<label[\s/>]`，不误伤 `labelClassName` / `label="x"` / `<labeling`
  这类同前缀属性名与字符串字面量；`ui/` 通过 `EXEMPT_DIRS` 天然豁免（
  `ui/label.tsx` 与 `ui/field.tsx` 自身要写 `<label>`）。
  走棘轮：本批评据上线时视图层实测 **22 个文件、33 处** 存量（首轮审计按
  组合形态数到 15 处、P78 的**纯形态**扫多出一批给 checkbox 当点击区的
  孤立 label），`--update` 冻结起点、只许降。下一批按域分片把每个 `<label>`
  迁到 `FieldLabel` / `FormField` / Base UI `Checkbox`（children 形式），
  与 P71 / P76 引入节奏一致。
  差分回归 4 例见 `tests/check-ui-primitives.test.ts`：
  视图裸 `<label>` 阻断 / `ui/` 豁免 / 同前缀不误伤 / `--update` 拦下已有
  rule id 的上升。

## Fixed

- **`--update` 从「总数比较」改成「按 rule id 逐个比较」**
  （`scripts/check-ui-primitives.cjs`）：此前棘轮的 `--update` 逻辑是
  `if (before && after > before) 拒绝`——这条**总数一把梭**的判据会把「新增
  一条判据、把视图层已有存量一次性登记为起点」的正当动作误判成「放宽基线」。
  P76 上线时（`#1001`）能过是因为它引入时的总数还低于既有 P71 冻结的 215；
  P78 上线时把总数从 11 抬到 44，被这条逻辑误拦。
  重构后：
  - 旧基线里已经有的 rule id 上升 → 拒绝、错误消息点名是哪条 rule 上升多少；
  - 旧基线里从没出现过的 rule id（新加判据的起点登记）→ 允许通过、写入基线。
  差分回归覆盖这条分支（新增 test `--update 允许登记新判据起点、但拦下已有
  rule id 的上升`：先 seedBaseline、再往视图目录加一个 P78 违规、`--update`
  必须拒绝且点名 P78）。

## 未做

- **P77 号**（`<Button aria-pressed>` 循环）：**故意跳过**、留给下一批。
  锚点需要「同一 `.map(...)` 里出现 `aria-pressed={...}`」这种跨行组合、
  独立 PR 更稳（判据引入需要配套 3-4 例差分回归：单按钮 `aria-pressed`
  不误伤 / map 内 `aria-pressed` 计入 / `<ToggleGroupItem>` 合规出口豁免 /
  ui/toggle-group.tsx 自身豁免）。
