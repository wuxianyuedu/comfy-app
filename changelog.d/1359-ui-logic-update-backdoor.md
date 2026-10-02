## Fixed

- `scripts/check-ui-logic-separation.cjs`（AGENTS 硬规则 10「视图层不得新增 IO」在 pre-commit 的
  执行者）的 `--update` **在基线总数为 0 时照收新增**（ISSUE #1359）。根因是一行的短路：

  ```js
  if (before && after > before) {
    /* 拒绝放宽 */
  }
  ```

  `before === 0` 时整个条件短路，上升检查根本不执行。而本仓今天的基线正是
  `total: 0 / files: {}`（2026-09-04 建基线 104 处，随后治理到 0）—— 也就是**做完治理的那一刻
  这扇门开着**：往视图层新写一条 `fetch(`、跑一次 `--update`，就以「0 → 1」收进基线。
  实测（一次性 workspace + 真基线副本）：`[ui-logic] 基线已更新：0 → 2`、退 0。
  总数口径还有第二个洞：修掉 A 的一处、同时新写 B 的一处，总数不变也通过 —— 所以「持平」不是
  安全状态。同总数换文件与从 0 放大，现在都拒。

- 现在 `--update` 与非 `--update` **共用同一个 `diffAgainstBaseline(baseFiles, nowFiles)`**：
  逐 `(文件, 指标)` 比，新增条目与计数上升一律算放宽（拒，并列出被拒的具体条目），只允许下降与
  条目消失。两条路径各比各的，就会长出「检查说没事、收口说有事」和反过来这两种都难归因的红。
  首次建基线（基线文件不存在）仍然允许 —— 那是记账起点，不是放宽；这个区分靠
  `readBaselineFiles()` 分别返回 `null`（没有文件）与 `{}`（有一份写着 0 的基线）。

## Added

- `tests/check-ui-logic-separation.test.ts`（13 条）：这条门禁此前**零执行者**
  （`grep -rl "check-ui-logic-separation" tests/` = 0），所以「它到底认不认」从来没有被证明过。
  形状照 `tests/check-code-duplication.test.ts`（把脚本复制进一次性 workspace 的 `scripts/` 再
  `execFileSync`；脚本按 `__dirname/..` 定根 —— 绝不往真仓库 `src/` 种探针文件，本机有并行会话共用
  同一份检出）。覆盖：三条指标 S1/S2/S3 各认、三类豁免（`src/app/api/`、`*/hooks/`、`*.test.tsx`）
  各不计入、`src/lib` 引 React 的 H2 硬规则、S4 只提示不计数、基线缺失判红并指路、计数上升报出
  「1 → 2」、下降未收紧在 `--strict`（pre-commit 用的那档）与非 strict 下的两种结果、
  `--update` 五格（从 0 拒绝 / 同总数换文件拒绝 / 真下降放行并写盘 / 首次建基线放行 / 有硬违规拒绝）。
- 一条**取向**被钉住而不是修掉：注释里出现的 `fetch(` 也计入 S1。匹配式不看注释，看似噪声，但
  本仓已经量过「裸的全局去行尾注释会造假绿」（`const url = "http://a"; wfParam();` 被剥完就消失，
  记在 #1192 的台账落地记录里）。对这条棘轮，多报是几分钟解释成本，漏报是硬规则 10 失守 ——
  所以保守侧是设计，写进用例免得下次被当 bug「优化」掉。

## Verified

- 修前 / 修后的四格对照（都在一次性 workspace，用真仓库那份 `total: 0` 基线）：
  从 0 放宽 由「0 → 1，退 0」变成「拒绝把放宽写进基线 · 新增 S1 → …，退 1」；
  同总数换文件由通过变拒绝；真下降仍是「基线已更新：1 → 0」退 0；首次建基线仍退 0。
  拒绝之后**基线文件必须没被改写**（用例里直接读回来断言仍是原样，防「一边红一边已经写进去」）。
- 真仓库行为不变：`node scripts/check-ui-logic-separation.cjs` 仍报
  「当前违规合计 0 处，涉及 0 个文件」+ `[ui-logic] OK`、退 0。
- **变异验证**：把 `--update` 退回旧的总数口径（`total(baseFiles) && total(now) > total(baseFiles)`）
  ⇒ 恰好红「从 0 拒绝」与「同总数换文件拒绝」两条，其余 11 条不受影响；还原后 13 条全过。
- 文档：`17-UI与逻辑分离.md` 的命令段把 ② 的口径改对、补上后门的成因与本条用例位置，
  `--strict` 那行由「CI 用」改成「pre-commit 用的就是这一档」（CI 自 ISSUE #623 起已删）；
  基线史末尾那句「护栏退化为纯 H1/H2 硬规则守卫」订正 —— 记到 0 不等于退化，
  那句话本身就像在给 `--update` 后门发邀请。同批 `pnpm doc:render` 并提交 `docs/generated/`。
