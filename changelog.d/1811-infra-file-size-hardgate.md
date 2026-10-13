## Changed

- **基础设施层文件长度从棘轮翻成硬闸：`scripts/check-infra-file-size.cjs` 命中即退 1**（ISSUE #1811 主线的最后一项）。此前它是棘轮 —— 超 900 行的文件记在 `scripts/.infra-file-size-baseline.json`，`--update` 收紧、`--strict` 要求下降，默认档只提示不阻断。存量随 `dev-launcher.mjs` 拆完归零，于是两层都退化：棘轮无事可收紧、默认档恒绿，而留下的是一条「手改那份 JSON 就能把新违规登记成已知存量」的通道 —— 硬闸类本来没有的中间态（规范 §13.6.2）。
  - 删基线文件、删 `--update` / `--strict` 两支；`--report` 与新增的 `--staged` 保留（清零后的自证靠 `--report`，`--staged` 按输入面跳过）。
  - 与 §12.6 R5（`src` 侧同阈值，也已是硬闸）口径一致：「超限就要拆」不该因为文件住在 `scripts/` 还是 `src/` 而分两种态度。

- **`scripts/dev-launcher.mjs` 按主流程阶段拆进 `launcher-core/**`：953 → 753 行**（ISSUE #1811 第五刀）。它是「全平台唯一编排者」，`run()` 一个函数约 490 行，内含 4 处提前返回与一个嵌套自愈函数，此前撞在基础设施层文件长度档上。
  - 拆出四段：`startup-gates.mjs`（孤儿回收 / 环境与工具链门禁 / 依赖对齐 / 备份恢复 / 端口）、`shell-stage.mjs`（桌面壳，含自编排那次不再起第二个壳的判据）、`dev-boot.mjs`（缓存策略 / dev server / 执行器宿主 / 会话锚点 / 后台 schema 同步）、`ready-wait.mjs`（轮询 / 陈旧路由表自愈 / 超时定性）。
  - **依赖靠 `ctx` 注入**（回引主文件会成环，复制模块级状态等于两处各记一半子进程）；顺序仍由主文件那一层定，各段**内部顺序是契约**（换库在开库前、端口族回收每次都跑）。
  - 四份新分件同批补进产物两处白名单（硬规则 17）：`standalone-private-inputs.mjs` 的 `RUNTIME_SCRIPTS` 与 `check-standalone-contents.cjs` 的 `ALLOWED_SCRIPTS` —— 漏登记的表现是桌包重新编排一次就 `ERR_MODULE_NOT_FOUND`（用户只看到「双击没反应」）。

## Fixed

- **判据认实现位置的那几处随拆刀改到正确落点**（它们的 `indexOf` 落空会静默变成空转）：`db-backup-wiring` 的顺序断言、`cross-platform-launcher` / `dev-launcher-toolchain-gate` / `executor-mode-consistency` 的链路源码，改用 `tests/helpers/launcher-source.ts` 的 `launcherChainSource()` **现算闭包**，不再手抄一份文件清单（抄了就会随下一刀再漏一处）。
