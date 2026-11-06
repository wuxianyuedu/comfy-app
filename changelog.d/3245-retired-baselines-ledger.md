## Fixed

- CI（GA `fixed-structural-tests`）：`tests/audits-doc-references.test.ts` 的「已删棘轮基线」判据此前用 `git log --all --diff-filter=D -- scripts/` 从**全历史**现算名单。主干 `f7f2ffccf` / #3236 把 `pr-gate.yml` 三个装依赖 job 的检出缩到 `fetch-depth: 2` 之后，那段历史根本不在检出里 ⇒ 名单退化成空集 ⇒ 那条「判据面非空」用例按 §13.6.3 主动判红 ⇒ 所有 PR 的 `GitHub 判决判定` 格跟着 `exit 1`（现场 PR #3239 / #3242：`Test Files 1 failed | 23 passed (24)`，唯一失败 `audits-doc-references.test.ts:158`）。
- 现在把「曾入库、今天已不在」记成**仓内显式台账** `scripts/retired-baselines.json`（20 份 basename，取自改动前那趟全历史读数的真实结果），判据只读当前树、不再问 git 历史。浅检出 / 无 git 沙箱都读得到；退役一份新基线时显式往台账加一行。读不到或形状不对仍退化成空集 —— 那是「判据面为空」不是「全绿」，由对账用例判红。

## Changed

- `tests/audits-doc-references.test.ts`：`retiredBaselineNames()` 改为读台账（类型守卫校验 `retired` 数组、按 `^\.[^/]*baseline[^/]*\.json$` 过滤去重排序）；删掉 `execFileSync` 与为整趟历史遍历抬到 90s 的 `timeout`，用例回到全局 30s 预算；「判据面非空」改成**与当前树对账**（台账非空、含 `.dead-exports-baseline.json`、且每一条今天确实不在 `scripts/` 下），另补一条静态契约用例钉住「不许把全历史扫描加回来」。8 条用例全绿，本机耗时从秒级降到 30ms 档。
- `scripts/fixed-structural-tests.mjs`：第 597–600 行的收录理由同步（从「一次 `git log`」改成「仓内台账」；仍因 `docs/audits/*.md` 文本与数据文件都不在 import 图上而留在固定清单）。
- GA 侧 `pr-gate.yml` 的 `fetch-depth: 2` **不动**：判据不再依赖历史，浅检出优化照旧有效；`GitHub 判决回读` / `GitHub 判决判定` 两格的三态口径、`GitHub 镜像同步` 那条链路也都没动。判据文件在 checkout 出来的工作树里，改完本跑即可转绿，不必等镜像仓默认分支同步 workflow。
