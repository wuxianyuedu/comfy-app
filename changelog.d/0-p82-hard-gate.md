## Changed

- `scripts/check-ui-primitives.cjs`：P82「视图层 `<Button>` 用原生 `title=`」的**判据换成平衡扫描**并**从棘轮升为硬闸**（`HARD_GATE_RULES` 加 `"P82"`），与 P70/P71/P72/P73/P75/P76/P77/P78/P79/P80/P81 同批。
  - 新属性段读取函数 `readJsxAttrsPastTag()`：`{}` 计深度、引号与模板串内不判结构、`\` 转义跳一格，扫到深度 0 的收尾 `>` 为止。
  - 为什么要换：引入时（#1123）用的是粗锚 `<Button(?=[\s/>])([^>]*)>`，属性段里箭头函数（`onClick={() => a > b}`）、比较表达式（`disabled={count > 0}`）、带 `>` 的字面量值（`aria-label="a>b"`）都会让它早停 —— 粗锚在真实库上数到 **78**，用 TypeScript AST 复扫同一作用域是 **157**（`LogPanel.tsx` 单文件粗锚记 3、实有 10）。棘轮阶段漏计不假红，但「清零 + 升硬闸」必须建立在看得见全部存量的判据上。
  - 顺序是刻意的：**#1135 先把 157 处全治干净**（两种口径都归 0），**本 PR 才让判据变严并冻结为 0** —— 反过来就会把硬闸建在看不见的存量上、且此后新写的同类违规仍会漏网。
- 合规出口的指引改指 `<Hint>`：P82 的 `label` 与判据注释此前写的是「`<Tooltip>` + `<TooltipTrigger render={<Button …/>}>` 三件套」，#1135 之后单一出口是 `~/components/ui/hint` 的 `<Hint label=…>`（薄封装、支持条件态与图标补名）。
- `scripts/.ui-primitives-baseline.json` 由 `--update` 重刷：P82 从 `rules` 表移除（硬闸不进基线），`total` 保持 0。

## Added

- `tests/check-ui-primitives.test.ts`：P82 段新增一条「**计数不再被属性段里的 `>` 截断**」的差分回归 —— 同一个文件里摆四种形态（箭头函数在前 / 表达式里带比较 / 引号里带尖括号 / 本来就能计到的），走 `--report` 解析 `—— 4 处 / 1 文件`，钉住粗锚只数到 1 的那个缺口被闭死；另把「不误伤」那条扩成同时覆盖 `<Hint>` 与 `<Tooltip render={<Button/>}>` 两种合规出口。用例 311 → 312。
- 原有用例断言跟上硬闸形态：命中行是 `P82 → path（N 处）`、不是棘轮的「新增 P82」，改判 `toMatch(/P82\s*→/)`（与 #1120 的 P71/P79 同一手法）。

顺带：P82 注释块重写后，`scripts/check-ui-primitives.cjs` 里未登记的英文注释行数从 11 降到 9（该文件剩余的是上游 `composition.md` 的原文引用）。`tests/comment-language.test.ts` 在 `master` 上本就红（9 文件 22 行未登记），登记与否另 PR 处理、这里不放宽基线。

引入 → 治理 → 升硬闸的完整节奏：#1123 P82 引入（粗锚冻结 78）→ #1135 AST 复数 157、抽 `<Hint>` 一次清零 → 本 PR 判据换平衡扫描 + 升硬闸。
