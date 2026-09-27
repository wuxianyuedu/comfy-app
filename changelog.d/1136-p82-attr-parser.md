## Fixed

- `scripts/check-ui-primitives.cjs`：P82「视图层 `<Button>` 用原生 `title=`」的判据从**二值**改为**属性解析 + 分档**，修掉粗判据的三类误报/漏报（据 PR #1136 的复核意见）：
  - **属性名整名匹配**：`parseJsxProps()` 把属性段切成属性、按整名取 `title`。旧的 `\btitle\s*=` 会把 `data-title="x"` 与 `aria-label="title=x"` 误判成原生 `title=`（`-` 是非词字符），整名匹配后不再命中。
  - **空值单列 empty**：`title=""` / `title={undefined}` / `title={null}` 有属性但等同没写（不产生原生 tooltip），old 判据把它们当违规 —— 现归 `empty`、**不计违规**。
  - **`{...props}` 展开归 unknown**：`title` 可能由展开带进来、静态判不了，不再静默算作合规，而是单列到 `--report` 的 `P82-unknown` 通道人工抽查（**不计违规**）。
  - **只有真原生 title 计违规**：`static`（`title="文字"`）与 `dynamic`（`title={expr}`，运行时才知值）合计为 `violations`，即硬闸唯一口径。
- `scripts/check-ui-primitives.cjs`：属性段扫描重构为三个各管一件事的小函数 —— `scanJsxAttrs()`（`{}` 计深度、引号与模板串内不判结构、`\` 跳转义、`{}` 内嵌套表达式吃下）、`skipJsxBraceExpr()`（只吃一层平衡 `{…}`，用于属性值 / 展开检测）、`skipJsxString()`（含转义与模板串 `${…}` 插值）；删掉被取代的 `readJsxAttrsPastTag()`。

## Added

- `tests/check-ui-primitives.test.ts`：P82 段新增四条差分回归 —— ①`data-title=` / `aria-label="title="` 不算原生 title（`—— 0 处`）；②空值归 empty、只有 dynamic 计入违规并真被硬闸拦下；③`{...props}` 归 unknown、门禁放行但 `--report` 单列出该文件；④注释里的 `<Button title=>` 不误报。原「计数不再被 `>` 截断」那条断言跟着语义走（四处都有 title = 四处 `static`）。用例 315 → 316。

已知边界（不修，有记录）：**字符串 / 模板字面量里**字面出现的 `<Button title=…>` 仍会被命中 —— 只有 AST（`@babel/parser` 开 jsx 插件或 ts-morph 遍历 `JsxOpeningElement`）能根治；本仓库实测该形态真实出现 **0 处**（落在注释里的已被 `stripComments` 剥掉），故不在扫描器上继续打补丁（§12.18 复用优先 / 不为零命中的形态造第二套判据）。
