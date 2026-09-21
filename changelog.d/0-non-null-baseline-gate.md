## Added

- **`scripts/check-non-null-assertions.cjs` + pre-commit 第 28 步：src/lib 非空
  断言 `!` 的基线棘轮**。本轮类型安全审查把 lib 里 13 处「filter/map 不
  narrow 病灶」全部消化（PR-1/2/5/8/12），但仍有 ~89 处 `arr[i]!` /
  `match[N]!` 是 `noUncheckedIndexedAccess` 打开后的合法惯用法。**直接开
  eslint `@typescript-eslint/no-non-null-assertion`** 一次会报 102 处、
  评审看下来全是噪声；不开又挡不住下一轮病灶长出。与 §12.12 代码重复 /
  §12.13 函数长度同构的**基线棘轮**是合理路径：
  · 判据走 TypeScript AST 的 `ts.isNonNullExpression`（不用正则——正则会把
  `!==` / `!x` / 注释里的 `!` 全误伤），只扫 `src/lib` 下的 `.ts`/`.tsx`
  非测试文件；
  · 基线 `scripts/.non-null-assertions-baseline.json` 记**每文件**当前计数
  （首轮 102 处 / 40 文件），只挡**新增**、允许逐步下降；
  · `--update` 需**伴随下降**、拒绝放宽；`RULE_VERSION` 变了必须同步改脚本
  常数（否则 `--update` 拒绝），防「顺手把基线调大」的后门；
  · `--report` 只出清单不判失败（盘点用）。

  `tests/check-non-null-assertions.test.ts` 5 条用例把脚本当黑盒跑在临时
  工作区上，覆盖：AST 认出 `arr[i]!` / `match[N]!`、不误伤 `!==` / `!a` /
  注释里的裸 `!`、跳过测试与 `.d.ts`、`--update` 建立 → 同数量 OK → 新增
  阻断 → `--update` 拒绝放宽 → 下降提示可收紧、判据版本不一致直接拒绝。

  规范文档同步更新：`docs/standards/13-提交与-code-review.md` §13.5.6 新增
  一节说明「为什么走棘轮不是直接开 eslint」，pre-commit 清单从 27 步升到
  28 步；`docs/generated/**` 走 `pnpm doc:render` 重渲染。`.githooks/pre-commit`
  全部 `X/27` 编号升到 `X/28`，新加的第 28 步紧接浮层刻度之后。
