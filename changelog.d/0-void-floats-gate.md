## Added

- **`scripts/check-void-floats.cjs` + pre-commit 第 29 步：src/lib `void someFn(...)`
  悬空 Promise 棘轮**。类型安全审查 src/lib 报告 H-6 的机器化收口。PR-4b 加了
  `fireAndForget` 地基，PR-10 逐个审了 lib 里 30+ 处 `void fn()` 把 10 处真漏
  改走 fireAndForget —— 但**人工审计会漂**：下一位写下
  `void persistLogs(taskId)`（若被调方没有内部 catch）就是一颗未来的
  unhandledRejection，pre-commit 不会响。
  判据走 TypeScript AST，**只认**「ExpressionStatement → VoidExpression →
  CallExpression」这一形状；`.catch(...)` 链尾（`void fn().catch(...)`）视为
  **显式**接管了 rejection、跳过；`await someFn()` / 裸 `someFn()` 也不在本判据
  里（前者显式等待、后者是 eslint `no-floating-promises` 完整版的活、一次报
  几百处噪声大于收益）。
  只扫 `src/lib` 下的 `.ts`/`.tsx` 非测试文件：视图层 `void fetch(...)`、
  `void setState(fn())` 在 React 事件处理器里是**表现层职责**，靠 §17 UI/逻辑
  分离去治理（业务逻辑下沉 hooks，`void` 的取舍变成 hook 内部的事）；lib 是
  地基、被跨端共同消费，悬空一次可能污染整条链。
  基线 `scripts/.void-floats-baseline.json` 首建 **14 处 / 5 文件**
  （`enqueue.ts` 4、`executor-scheduler.ts` 3、`runner-state.ts` 3、
  `reaper.ts` 2、`canvas-store.ts` 2）；`--update` 需伴随下降、`--strict`
  强制下降同批收紧；`RULE_VERSION` 变了必须同步改脚本常数。

## Changed

- **pre-commit 从 28 步升到 29 步**：新加的第 29 步紧接「src 非空断言棘轮」之后，
  与 §12.12 / §12.13 / §13.5.6 三条基线棘轮同构。`docs/standards/13-提交与-code-review.md`
  §13.5.7 新增段落解释「为什么走基线棘轮不直接开 eslint」与「为什么只扫 lib
  不扫视图」；清单从「28 步」升到「29 步」；`docs/generated/` 走 `pnpm doc:render`
  重渲染。`tests/check-void-floats.test.ts` 加 5 条用例（AST 认得 `void fn();`
  与 `void obj.fn();` / 不误伤 `.catch(...)` 链与 `await` / 跳过测试与 `.d.ts` /
  `--update` 建立 → 同数 OK → 新增阻断 → `--strict` 下降也阻断 /
  `RULE_VERSION` 变了拒绝放宽）。
