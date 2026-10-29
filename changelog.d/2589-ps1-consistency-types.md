## Fixed

- **脚本档清账批 9：`scripts/check-ps1-consistency.mjs` 19 格清零，账从 150 处 / 14 份降到
  131 处 / 13 份（ISSUE #2589 / 规范 §13.5.14.1）**：这一份是硬规则 12 那条
  「跨平台动作 = 逻辑写 `.mjs` + 入口 `.ps1` + 登记对照表，只写一侧会被拦」的执行者。
  19 格分成三种，其中**只有一种是真缺陷的形状**：

  ① **按下标取的两类**（9 格）：`matchAll` 的捕获组 `m[1]` 与按索引读的 `lines[i]`，
  在 `noUncheckedIndexedAccess` 下都是「可能 undefined」。这里刻意不写 cast、也不抬严格度，
  而是把空值**在出口处收掉**：`pathsIn()` 与 `parsePairs()` 各加一道
  `.filter((p) => p !== undefined)`（当场实测：本仓钉的 `tsc` 是 **7.0.2**，加上这一道之后
  下游那些 `p.startsWith(…)` / `f.endsWith(".ps1")` 不再逐处报「possibly undefined」，
  即这一步过滤在**这一版的类型系统里**确实把元素收窄成了 `string`），
  收在产生端而不是消费端，是批 2 定下的那条口径。

  ② **元组数组被推成 `(string | undefined)[][]`**（2 格）：README 那两张表原本是裸字面量
  `for (const [section, label] of [[windows, "…"], [cross, "…"]])`，解构出来的
  `section` 带着 undefined 往下走。收成 `Array<[string, string]>` 一处声明解决两个消费点
  （与批 5 那两张表同一形）。

  ③ **剩下的是登记**（8 格）：`read` / `walk` / `definesLiteral` / `readmeSection` /
  `pathsIn` 的形参与返回类型一直没写，`problems` / `out` / `pairs` 三个累加数组也没写 ——
  其中 `walk()` 报的是 `TS7023`（递归函数的返回类型依赖自己的推断结果），与批 7 那个
  生成器同一类：**递归是真的，注解是唯一不改变行为的解**。

  行为恒等的凭据（三条都跑了）：
  ① 它自己的用例 `tests/ps1-consistency.test.ts` 串行复跑 = **17 条全绿**
  （含「真仓库通过」「对照表里登记不存在的脚本 → 失败」「某一行动作只登记了一侧 → 失败」
  「对照表被整体删除 → 失败（门禁不许静默失效）」—— 这三条正是被本次改动碰到的解析路径）；
  ② 真机自跑 `node scripts/check-ps1-consistency.mjs` → `[ps1-consistency] 跨平台动作对照与
  单点定义 OK ✓`；
  ③ `node --check` 通过、`pnpm exec eslint` 对该文件零输出；棘轮 `--update` 后复算 =
  面 214 / 存量 **131** / **13** 份（本批零新格，没有把任何新增登记成已知存量）。

  ⚠️ **订正上一条批记录里的计划**：给 #2589 留的批 8 评论里写了一句「批 9 的凭据 = 它自己的
  用例 + 真机跑一次 `--staged`」。`--staged` 那一档属于 `check-deps-freshness.mjs`（批 8），
  **这份判据没有 `--staged` 形态** —— 实际凭据按上面三条走。计划句写错、落地读数如实。
