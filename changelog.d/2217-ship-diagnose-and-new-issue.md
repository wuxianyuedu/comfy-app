## Added

- **`pnpm ship --diagnose [sn]`：CI 红了先取「哪一格红了 + 失败行 + 完整日志链接」，不再每次手抄 `get-build-stage`（ISSUE #2217）**：
  - 只读：只发 `get-build-logs` / `get-build-status` / `get-build-stage` 三条命令，不重跑、不评论、不改状态；
    排在 preflight 之前，`master` 上、工作树脏、没有碎片时照样能跑。
  - 打印整跑判决（绿 / 真失败 / 被取消 / 还在跑 / 取不到）与平台原因原话、每一格红格的名字 / 流水线 /
    状态 / 时长、**失败行（带完整日志行号）**与末尾若干行（最多展开 3 格）、完整日志链接。
  - 退出码与 `ci-build-readout.mjs` 同一口径：绿 `0` / 真红 `1` / 被取消、还在跑、取不到 `2`（`2` 不是通过）。
    不给 `sn` 时按 HEAD 的 sha 在 `pull_request` 构建里逐字归属，找不到 ⇒ `2`（不拿最新那条顶上）；
    **不归因**（「红是我的还是主干的」仍归 `node scripts/base-check.mjs`）。
  - 两个不报错、只给空读数的形状坑（`pipelinesStatus` 是按 id 索引的对象、格日志 `content` 是带 ANSI
    的行数组）收进 `ci-build-readout.mjs` 的唯一实现，独立 CLI 与 `--diagnose` 共用。
- **`pnpm ship --new-issue "<标题>" --issue-body-file <正文> --priority <P0..P3>`：一步建单（ISSUE #2217）**：
  - 建单 → 补 `提单人:<短名>` 标签 → **独立 `get-issue` 回读**（标题 / 优先级 / 标签）之后才念结论；
    回执不算结论。回读标题不一致或优先级不一致 ⇒ `1`；回读没跑起来 / 标签没落地 ⇒ `2`。
  - 标题与正文是判断，必须由人给（正文末尾的署名行由脚本补）；缺正文或正文为空 ⇒ `2`，一条 `cnb` 都不发。
    `--priority` 只认平台词表 `P0|P1|P2|P3`，不给就走平台默认 `P2`，词表外 ⇒ `2`。
  - `--issue-body-file` / `--priority` 单独出现 ⇒ `2`；与 `--claim` / `--release` / `--claims` 及主流程互斥，
    一次只做一件。
  - `ship` 内部的 build 取数（按 sha 归属 / 轮询签名 / 三态判定 / `asArray`）拆到 `scripts/ship-build.mjs`，
    `ship-core.mjs` 回到 900 行硬闸以内。
  规范 §13.10.12 / §13.10.13、`AGENTS.md` 硬规则 14 与 `ship` Skill 同步；回归见
  `tests/ci-build-readout.test.ts` 与 `tests/ship.test.ts` 的 `--diagnose` / `--new-issue` 组。
