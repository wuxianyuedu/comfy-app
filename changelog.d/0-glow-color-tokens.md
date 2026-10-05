## Added

- **`--color-glow-success`（#34d399）/ `--color-glow-danger`（#fb7185）** —— 状态点发光的
  浅彩档。这两颗此前不是没有，而是以裸值 `rgba(52,211,153,0.8)` / `rgba(251,113,133,0.8)`
  散在三处，看起来像「忘了用 token」，其实**是另一档颜色**：基准色 `--color-success` 是
  `#0ea472`、`--color-destructive` 是 `#e7000b`，比它们亮一档。签字口径 = **保住色相、
  把裸值纳入管理**，而不是并回基准色（并回去会同时改掉发光的色相与深浅，那是设计变更）。
  两态同值是刻意的：原裸值本来就没有 `.dark` 分叉，凭空加一档暗色等于改渲染。
  强度**不进 token** —— 由调用处走 `color-mix(in srgb, … N%, transparent)` 决定，
  与 `AuroraGlow`「色相走 token、强度由调用处定」同一条约定。
- **防回潮判据**（`tests/design-md-contract-sync.test.ts`，固定清单成员）：调用点再写
  `rgba(52,211,153…)` / `rgba(251,113,133…)`，或把 hex 包进 `shadow-[…]`，即红；
  `globals.css` 作为定义处豁免，并断言两颗 token 真的在（否则那条会因为「谁都没有」而空绿）。
  范围**钉了两条反向样本**：同一档浅彩在 `canvas-types.ts` / `HomePage.tsx` 是合法的
  **节点/项目类别色** —— 判据第一版把 hex 一并禁掉，当场误报三份与发光无关的文件，
  现在只禁「发光位置」这一种形态。变异验证：往 `BrowserStatusBar` 塞一条裸值 → 该条红并点名文件。

## Changed

- 三条调用点改用 token：`BrowserStatusBar.tsx`（devServer 在线 / 离线两元）、
  `project-canvas/GlobalStepLogPanel.tsx`（SSE 连接点，α 仍是它自己的 0.7）。
  **零像素变化**，由真编译探针验证（不是推理）：`postcss(@tailwindcss/postcss)` 全仓扫一遍
  编出的产物里，两颗 token 各以 `#34d399` / `#fb7185` 落进 `:root`，三条 arbitrary shadow
  类全部生成（Tailwind 还额外给了一份 `@supports (color-mix…)` 之外的兜底值）。

## Added

- **一条会伤到自查的实测事实，记进契约 §Colors**：Tailwind v4 的默认源扫描把 `.md` 与测试
  文件一起当源读 —— **文档里整串照抄一个 arbitrary 候选名（`shadow-[…]` 这种），那条规则
  就真的被生成进产物**。后果是「按产物数硬编码色」的自查会读出一个源码里根本不存在的死类
  （本次探针就撞见一次：旧裸值类仍在产物里，而 `src` 一处都没有，来源正是本文的举例句）。
  写值本身（`rgba(52,211,153,0.8)`）不成候选名，安全；用例里的样本一律拆开拼。

## Known Gaps（收窄，不是新增）

- 状态栏里 `fpsDotColor` 表用的是**基准色**发光（`var(--color-success)`、α=1），而 devServer
  那点用浅彩。两条现在都有名字了，但「整条状态栏统一到哪一档」仍是**没签**的决定 ——
  这一刀刻意不顺手改它的色相。
