## Changed

- **`ctx.annotate`：量完决定不铺开，把「怎么用才对」变成判据**（ISSUE #1485）。它是 vitest 5 盘点里最后三条之一。实测四条都反直觉，所以这一件的结论不是「怎么用」，是**先别用**：
  - **① 第二参数是字符串（type），不是对象**：签名 `annotate(message, type?, attachment?)`，照直觉写 `ctx.annotate("理由", { type: "known-failed" })` 会被当成**附件**并抛 `TypeError: Test attachment requires "body" or "path" to be set` —— 报错讲 attachment，真因是参数位置写错，指不出方向。
  - **② 它不改结论**：挂了注释的失败用例仍然 `Tests 1 failed`、退出码仍 1，所以**替代不了** `KNOWN_FAILED_FILES` 那种「先摘掉、再跑」的机制（那一步必须在运行之前）。
  - **③ 绿的用例上完全不可见**：text reporter 只在**失败**时打一行 `↳ known-failed`；给一批当前是绿的用例挂声明等于写在没人会看的纸上。
  - **④ 门禁链读不到它**：`--reporter=json` 产物里既无顶层 `annotations`、`assertionResults[].meta` 也空（逐键核过）；唯一读数通道是 programmatic API `createVitest()` 的 `task.annotations()`，而门禁链跑 vitest 用的是 **CLI spawn**（`run-affected-tests.mjs`），两者天然不兼容。
  - 新增判据 `scripts/check-annotate-consumer.cjs`（pre-commit D 组）：**有站点就必须登记消费方**（`scripts/.annotate-consumers.json`）。零站点是本仓库当前状态（纯闸门）；「挂一把没人读的注释」比不写更坏 —— 它让人以为这件事有人管。判据自己不许静默降级（台账解析不了 / `consumers` 不是数组 → 判失败）。
  - 门禁自测 `tests/annotate-consumer-gate.test.ts` 进 C 组固定清单，跑真脚本、八条口径各一条执行者；变异核过两条：站点正则窄化成行内字面量 → 折行那条红；取消字符串/注释挖空 → 夹具那条红。
  - 规范 11 新增 **§11.21**（四条实测 / 唯一站得住的用法 / 判据 / §11.21.4 三条「不做」——其中一条是**不当 `conditional-skip-registry` 的第二实现**：那一套已经用「档位 + 理由 + 站点数」管着 44 处条件性 skip 且判据在跑，再叠一层并行声明机制会变成两个真相来源，正是 §12.18 要避免的）；§13.1 手跑清单同步。
