## Added

- **每日失败立案多一节「该有人出面了」**（ISSUE #2639）：每日档过去只回答「预算闸红了 ⇒
  一张单」，而 #2639 记的那六次同一形复发说明还差一层 —— 账被重新签过，旧的那笔既没人认也
  没人压回。现在预算闸那一张单的正文里（读数之后、`## 根因：未判定` 之前）会点名：
  **基线其后提交数 ≥ 15** 或 **预算闸连续红 ≥ 2 天**，并把 §13.5.4 的两条出口（认账：
  before/after + `--allow-increase` 重跑 `--update`；压回：开一条降字节的 PR）念出来。
  判法只读判据自己打的那两句判决行（`违规（阻断）` / `读数（不参与判定）`，与
  `check-bundle-budget.cjs` 源码对账），**不改预算闸的判定**：开发期暂撤（#2634）那一档
  不升级；正文取不到 / 归因行读不出 / 连续天数回看不到一律念「读不出 ⇒ 不构成结论」，
  不许落成 0。两个门限挂在数值账（`scripts/.gate-thresholds.json`），业主改那两条即可。
  连续天数与主取数共用 `fetchBuildsCoveringWindow()`（窗口按门限天数算、`covered` 自证照旧）；
  离线档只从 `stageLogs[sn]` 读正文，连续天数一律「读不出」。

## Fixed

- **脚本档棘轮那一格不再被同一次运行里的 eslint canary 临时样本撞红**（本批落地的并发现场，
  2026-10-30 `受影响用例` 那一格）：`tests/eslint-gate-canary.test.ts` 与
  `tests/scripts-typecheck-ratchet.test.ts` 同在固定清单里、而那一格是 `--maxWorkers=2`
  **并发**跑的；canary 受 eslint@10 的 project service 约束（样本必须落在 tsconfig 项目里，
  `--stdin --stdin-filename` 会报 was not found by the project service），只能在 `scripts/`
  下落一份 `eslint-canary-<pid>-<时间戳>/` 的真样本目录、跑完 `finally` 删 —— 于是棘轮那条
  「盘上没有未入库的 `.mjs`」会撞上兄弟件**正在用**的样本，红了却指不出是谁。现在这一格
  **从 canary 那份源码里对账取回目录前缀**（与拿 `check-bundle-budget.cjs` 源码对账判决行
  同一条口径，两处各写一遍必然漂），认出同跑兄弟件并念出「面外几份不计入」，其余残留照旧
  点名；前缀认不出来 ⇒ 判「没判」而不是「没有残留」。另补一条阳性对照：canary 的样本认得出、
  别的目录与它落在 `tests/` 那一半都不许被豁免。附带把脚本档账本的 `face` 记到 218
  （本批新增的那份 `.mjs`）。
