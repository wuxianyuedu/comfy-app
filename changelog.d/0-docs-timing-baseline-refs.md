## Fixed

- **一批「在 `F:`/NTFS 上量的绝对耗时」补上出处与失效口径**（开发与 CI 于 2026-10-20 搬到
  `G:`/**ReFS**，两卷同一块 NVMe）：新增
  [`docs/audits/2026-10-21-timing-baseline-refs-volume.md`](../audits/2026-10-21-timing-baseline-refs-volume.md)
  一份逐格复测账（两个臂 + PR 档 31 条 job 的独跑/并发分列 + 本地微成本同尺 A/B），
  §13.5.3.10 那张预算表、§13.5.3.4.1.5 那张三档 IO 表、§13.5.3.4.3 那四个安装读数、
  11 §11.13 那三行预算与 `AGENTS.md` 里「冷装约 8 分钟」那一句都指回它。
  - **结论方向与预期相反**：现盘没有变慢 —— `stat` 77.0µs/文件 vs NTFS 296.7µs、
    `create` 569.2µs vs 1226.5µs（同一份量具、空机），元数据密集那一族快 2–4×；
    真正跨度大的是**冷态与暖态**：同一条「不接槽装依赖」在 25 分钟内是 216s → 88.5s → 48.8s。
    所以本批**不抬也不降任何判据**：四个 `timeout` 预算、`testTimeout 30s` / `hookTimeout 45s` /
    `maxWorkers 8`、`.runtime-budget-baseline.json` 的 win32 基线（新读数 740.1ms / 372.0ms，
    仍在 ×2 预算内）**一条都不动** —— 只有量级读数需要重记，预算需要的是证据。
  - 同时记档三条**与搬盘无关、但正挡着每日档**的在红：接槽形态下 `每日生产构建` 起不来
    （Turbopack 拒绝指向项目根之外的 `node_modules` junction，而不接槽那一臂过了这一关 ⇒
    红归接槽），`bundle-budget` 棘轮 +543 B 且其基线修订号在 CI 浅克隆上不可达，
    `tests/git-dir.test.ts` 在节点身份上把 TEMP 的大小写拼法当成事实。前两条已开成
    **ISSUE #2081**（接槽 × Turbopack）与 **ISSUE #2082**（`bundle-budget` 在 CI 上无法归因却仍然阻断）。
  - 还有一条取数手法的缺口被补上：`cnb build start-build --config <内联 YAML>` 的探针**必须带分支键那一层**，
    且**必须自带独立 `lock.key`**（照抄 `pr-$CNB_PULL_REQUEST_IID` 会在非 PR 事件上退化成 `pr-`，
    被任何一次 push 流水线 `cancel-in-progress` 掐掉——实测死过一次）。
