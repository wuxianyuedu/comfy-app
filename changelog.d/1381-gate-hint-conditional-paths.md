## Fixed

- **门禁路径字面量判据（`tests/gate-hint-targets-exist.test.ts`）补上「条件路径」这个命名空间**，
  消掉一处**判据设计的假阳**：`check-annotate-consumer.cjs` / `check-task-meta-consumer.cjs`
  的 `LEDGER` 常量（`scripts/.annotate-consumers.json` / `.task-meta-consumers.json`）是
  **台账**，只在有站点时才需要，两个门禁的判定口径都明写「零站点 → 通过，本判据是纯闸门」。
  而原判据只问「这个字面量在仓库里存不存在」，问不出这一点。
- 新增例外表 `CONDITIONAL_PATHS`，**登记代价是判据真跑一次该脚本**：它必须对「这个路径不存在」
  站得下（退出码 0）—— 这把「不存在不是缺陷」变成机器判据。哪天有人把零站点那条快路径改成
  先读台账，当场红，而不是让判据悄悄放行一个真失效。另两条复算：注册方脚本里字面量还在、
  仓库里仍然没有这个文件。
- 刻意不做成「以 `scripts/.` 开头的一律放行」（洞比拦下的东西大）或「按 `existsSync` 邻近
  判断」（拿源码形状当语义 —— `check-annotate-consumer.cjs` 内部真有一处 `existsSync` 门槛，
  会连它旁边**真**该存在的路径一起放走）。理由写进判据文件头与规范 12 §12.16。
