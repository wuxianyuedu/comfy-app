## Changed

- **零引用的 UI 基元接上业务，「基元齐全但没人用」这条账开始收**（ISSUE #672，规范 16 §16.2.4.4）：
  体检时 `ui/` 里 29 个基元**只有 3 个被业务真正引用**，`card` / `badge` /
  `input` / `textarea` / `switch` / `separator` 的引用数都是 0。P1/P2/P3 三条棘轮
  对这件事**天然无感** —— 它们数的是「另一种写法出现了几次」，而零引用基元是
  「没有出现」的那一侧。本批把有明确场景的一批接上：`ModelCard` 的卡片外壳与
  封面徽标走 `ui/card` + `ui/badge`，设置页「用量测试」的文本输入走 `ui/input`，
  设置页提示词 / 工作流导入 JSON / 影片剧本与提示词走 `ui/textarea`，影片工作台
  的分隔线走 `ui/separator`，画布设置与项目设置抽屉的开关走 `ui/switch`。
- **新增 `ui/range-slider`**：把四处各写一份的 `<input type="range" className="accent-violet-500">`
  与画布设置里一处自绘渐变的滑块收成一个出口。刻意**不用** `ui/slider`（那是无原生
  input 的 base-ui 复合控件，替换会换掉一套交互与 DOM 结构）—— 本基元只接管取材，
  不接管行为：已填充段用 `background` 渐变画（`accent-*` 表达不了「条上看出取值」），
  颜色经 `color-mix(in srgb, var(--color-*), transparent)` 现取语义 token。
- **`ProjectCanvasSettings` 与 `WorkflowCanvasSettings` 的两个自绘开关改走 `ui/switch`**：
  两处曾是同形的「圆角底 + 绝对定位圆点」各写一份，改一次要点两遍名 —— 开关是状态
  控件，样式改动应当只发生在一处。

## Fixed

- **训练超参的「值」文字在浅色下对比度不足**：`text-violet-700 dark:text-violet-400`
  改为 `text-primary-strong`（token 两态各自取值），四处步进值一并收口。
- **`ErrorPanel` 的错误卡片在浅色下是「浅底浅字」**：整个面板的 `rose-*` 家族
  （24 处）改走 `destructive` / `danger-strong` 语义类名，警告块改走 `warning` /
  `warning-strong`。
- **Toast 的成功/错误/信息三态图标色与描边写死了原生调色板**：改走
  `success-strong` / `danger-strong` / `primary-500`，另修掉信息态描边上那处
  写死的品牌紫。
- **`json-viewer` 的搜索命中高亮写死琥珀字面量**：浅色下是「近白字压浅琥珀底」，
  命中看不出来。新增两态 `--json-view-hit-*` token（浅色深琥珀底 / 深色亮琥珀底），
  命中文字色随之两态化。
- **`WorkflowSourceFilterChip` 的「本机 / 在线」chip 表面色写死**：圆点、文字、
  选中行底色与勾选色改走 `bg-status-online` / `text-primary-strong` /
  `bg-primary-soft`；按 §3.6.1 的边界，这些是**表面与文字语义**（不是端口类型色），
  必须 token 化。
- **影片时间轴片段的底色与字色写死**：改走 `primary-*` / `warning-soft` 语义 token；
  新增 `--color-warning-soft`（深色渐变底上的浅琥珀字，与浅底用的
  `--color-warning-strong` 是两颗 token）。
- **`FilmStudio` 播放按钮的图标色与分隔线**：`<svg fill="#fff">` 改 `currentColor` +
  按钮上给 `text-white`（内联 SVG 的 `#fff` 是「内容色」，不属 token 范围，但也没必要
  写死）；`<hr className="border-border-subtle">` 改 `ui/separator`。
- **子图标题栏与便签的混色兜底值是深色档**：`useCssColorToken` 的 fallback 由
  `#16161e` / `#22222c` 改为 `#ffffff`。它只在挂载前 / token 读不到时生效，而
  「挑一个深色下大概能看的兜底」在浅色主题下就是错的（§3.1.1 末尾同款论证）。

## Added

- **`tests/ui-primitives-coverage.test.ts`**：逐条断言「已接上业务的基元」**至少有一个
  业务消费点**，清单显式（要摘掉一个必须改本文件并在 Review 里讲清理由）—— 把
  「基元齐全但没人用」这条最难收的账变成不可回退的事实。
- **`--color-warning-soft` / `--json-view-hit-*` 两态 token**（`globals.css`）。

## Changed

- **主题色棘轮 142 → 115**（`scripts/.theme-color-baseline.json` 已收紧）。剩下 115 处
  集中在**类型色常量表**上（`workflow-node-palette` 18 / `workflow-utils` 15 /
  `WorkflowNode` 11 / `CanvasNodePrimitives` 10 …）—— 按 §3.6.1 的类型色例外
  **本可豁免**，只是从未登记。规范已写明下一批要做的是「逐条定性」（登记豁免或就地
  token 化），**不留在「未豁免存量」里** —— 那样它既不是豁免、也不是待治理项。
- **`DynamicWorkflowForm/constants.ts` 补出 `SECTION_ACCENT` / `PIN_ACCENT`**：段头与
  组合参数圆点此前在 `DynamicWorkflowFormView`、`IoEndpointsSection`、`GroupedControls`
  三处各写一份与 `ACCENT.text` / `ACCENT.link` 同值的字面量，改走常量并登记豁免。
