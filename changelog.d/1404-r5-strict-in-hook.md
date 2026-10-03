## Changed

- **R5 文件长度棘轮的硬闸档接进 `pre-commit`**（ISSUE #1404）：D 组那一步从
  `node scripts/check-file-structure.cjs` 改成带 `--strict`，标签随之从
  `文件结构硬规则(R1-R12，R5 只提醒)` 改为 `文件结构硬规则(R1-R12，R5 棘轮硬闸)`。
  为什么现在翻：`--strict` 是唯一会**阻断**的那一档，而它写在帮助文本里的执行者是「CI」——
  那份流水线已随 ISSUE #623 删除，`check:all` 同样没有自动执行者，于是「超 900 行文件」
  这条自 #575 就存在的棘轮**一个自动执行者都没有**。旧口径「本地刻意不带它」的理由是
  「被拦下的动作要求拆分文件，不适合每次提交都挡一次」，而那一档当时挂着 11 个存量；
  钩子注释里自己写的重开条件是「先拆到位、再给这一步加上 `--strict`」。
- **实测 A/B（同一份检出，`src/components/` 放一个 943 行探针，测完即删）**：
  不带 flag 退 **0** 并只打一行「拆分候选(仅提醒)」；带 flag 退 **1** 并点名
  `R5 新增超限文件(src/components/R5Probe.tsx → 943 行,阈值 900)`。
  存量核对：`scripts/.file-size-baseline.json` = `total: 0 / files: {}`，
  同一份 master 上 `--strict` 退 0；台账历史 `total` 依次是 11 → 10 → 1 → 0，
  最后一格由 `c7d59905`（`use-settings-page.ts` 966→837）清掉。
  **成本要说全**：今天拦不到任何东西，但 `src/` 里最长的 `log-store.ts` 已是 893 行，
  距阈值 7 行 —— 它下一次变长就会当场被拦，那是一次有主的拆分（归 studio 线），不是这条判据的假红。
- **shrunk 那一档仍然只提示不阻断**（脚本 ③ 分支不变）：这一步不会因为「有人顺手把文件改短了」
  去要求任何人跑 `--update`。

## Added

- `scripts/check-doc-references.cjs` 新增 `checkGateChecklistMatchesHook()`（= `pnpm doc:check`
  的一条判据，已接入 `main()`）：**§13.1「本地提交前必须通过」那份清单必须与钩子 D 组逐字一致，
  比对整条命令含 flag**。顺带修掉的存量漂移：清单少了 5 步（`check-ps1-consistency.mjs`、
  `check-import-alias.cjs`、`check-ui-customizations.cjs`、`check-doc-references.cjs`、
  `storybook-check.mjs`），并且把 `check-ui-logic-separation.cjs` 的 `--strict` 也补齐了 ——
  同一节还写着「上面那份清单就是全文」，而照清单手跑的人会以为 R5 不拦。
  判据第一次跑就把自己判红了（围栏切在 marker 之前 → 取到 0 条），所以「读不到清单」也判红，
  不让它空转。
- `tests/doc-check-hook-wiring.test.ts` 新增 4 条（该文件在 `FIXED_STRUCTURAL_TESTS` 里，
  也就是改钩子时真的会跑）：结构那一步逐字等于 `node scripts/check-file-structure.cjs --strict`、
  标签与注释不许回到「R5 只提醒」、基线存量必须仍为 0、脚本侧不许把执行者再写成「CI」。
  变异读数：抹掉 `--strict` 红 1 条；把整行注掉红 2 条（步骤缺席 + 「D(27 个判据脚本)」计数错位）；
  标签回退红 2 条；往基线塞一个超限文件红 1 条；脚本注释回退红 1 条。
- `tests/check-doc-references.test.ts` 新增 6 条：接线（含 wired/muted 对照）、存量 = 0，
  以及三个漂移方向各真的判红（抹掉 flag / 漏登记一步 / 清单留着钩子已不跑的命令）。
  探针只改文档、**不改 `.githooks/pre-commit`**：钩子文本被别的用例并发读着，改它等于自造并发假红。

## Fixed

- `tests/check-doc-references.test.ts` 的探针还原：`finally` 里一次 `writeFileSync` 在 Windows 上
  实测抛过 `UNKNOWN: unknown error, open …`（子进程刚读过那份文件），还原失败会把探针文本
  **留在仓库里** —— 本次就留下一条追加进 `docs/guides/DEV-QUERIES.md` 的探针行，
  再被 `doc:render` 连生成态一起写脏。改成写回后读回来核对、不一致就重试（最多 5 次），
  仍然失败则抛出「该文件里可能残留临时文本」，不再静默。
