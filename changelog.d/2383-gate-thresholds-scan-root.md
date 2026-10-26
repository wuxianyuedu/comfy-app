## Fixed

- **「判据数值未入账即红」的扫描根扩到门禁链全部判定脚本**（ISSUE #2383）：扫描根原来是
  磁盘上的 `check-*.cjs` 名字族，名字不叫 check- 的链上判据（`shell-gate.mjs` /
  `storybook-check.mjs`，#1444 残活 A / #1451）的顶层数值没有任何东西在守——调松一个都不红。
  现在扫描根 =「门禁链按名字调起的判定脚本 ∪ check-*.cjs 兜底」，链的现算收进
  `scripts/gate-chain-scripts.cjs` **单一定义点**（与 `check-gate-executors.cjs` 共用同一份，
  两处各算一份必然漂）；`.cnb.yml` 平台档调起的 `ci-*.mjs` 与编排器（`ship-*.mjs` /
  `quality-gate.mjs`）留在链外——那是口径（硬规则 7），边界从「本轮刻意」换成更硬的理由
  写进账的 `$notCovered`。新增两条 report 入账（`RULE_VERSION` / `REMOTE_REF_GRACE_MS`，
  后者沿用 STAGE_WALL_CLOCK_MS 的「表达式按头数记、两侧同尺」既定约定）。
