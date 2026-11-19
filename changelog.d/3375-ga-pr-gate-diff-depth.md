## Fixed

**GA PR 档两个三点 diff 判据 job 的检出深度回到全历史（ISSUE #3375）**：`pr-gate.yml` 的
`typecheck-db-format` / `affected-tests` 两格 `fetch-depth` 从 `2` 改回 `0`。

- 症状：PR #3366 重跑（`cnb-ukn-1k6sn867h`）在 GitHub 侧两格同时判红，失败行逐字相同 ——
  `262308122060db67debad3bba1a9036fe9a5a9a2 的 diff 没跑起来（浅克隆 / 该 sha 不在本地对象库里；先 fetch 再跑）（退 2 —— 这一格没判，不构成证据）`；红与 PR 代码无关。
- 根因：`--changed` / 受影响用例的基线是 payload 的 `CNB_PULL_REQUEST_TARGET_SHA`（PR 创建事件注入的
  目标分支快照），**不等于**合成 merge 的 base 父。master 在 PR 存活期间前进后，重跑的合成 merge
  base 父比该快照新 3 笔，这批历史落在 `depth=2` 之外 ⇒ `changed-scope.mjs` 按 fail-closed 退 2。
  同日新开的 PR 两 sha 一致、depth=2 够 ⇒ 绿，故只在「老 PR 重跑 + master 已前进」暴露。
- 改法：两格回到 `0`（与 static / heavy 同形态），判据脚本一字不改（退 2 是正确行为）；
  `fixed-structural-tests` 的 `fixed` 段不解析改动面，保持 `2`。同步订正 `pr-gate.yml` 两格注释、
  `docs/guides/ga-migration-checklist.md` 的 G-8（顺带把 #3329 遗留的「fixed 回到 0」对齐到代码实际的 `2`）、
  「被实测证伪的判断」追加本形，以及 `docs/generated/` 镜像（只重渲染动过的那一份）。
- 作用域：`repository_dispatch` 取镜像仓默认分支的 workflow 定义 ⇒ 本修复合进 CNB `master`、
  经「master 合并复核」的「GitHub master 镜像」格推到镜像仓之后，才对后续 PR 的 GA 判据生效；
  已在飞的 PR 需要各自重跑一次。
