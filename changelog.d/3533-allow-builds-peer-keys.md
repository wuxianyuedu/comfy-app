## Fixed

- **allowBuilds 对账的两个「陈旧检出」形状收口**（ISSUE #3533）。
  判据（`scripts/check-allow-builds.cjs`）按 lockfile 的 `packages` 段先把磁盘上的
  带脚本包分成「当前依赖图里的」与「store 孤儿」：孤儿只落提示档、不参与对账
  （#3523 那一半，本单症状里的 `core-js-pure@3.51.0` 误报即此形）；锁文件键的
  **peer 依赖尾巴**（pnpm 12 形如 `esbuild@0.25.0(unrs-resolver@1.15.0)`）在判归属前
  剥掉——否则在图里的现行依赖永远对不上裸 id、被误判成孤儿落进提示档，它没登记的
  构建脚本就漏了对账（门禁绿了，别人的 `pnpm install --frozen-lockfile` 会
  ERR_PNPM_IGNORED_BUILDS）。脚本半边已随 `fc3f75c8` 在 master；本笔补齐**测试半边**
  （peer 尾巴三形 + 源码钉），夹具档按既有口径在 Windows 节点跳过、由 Linux CI 执行。
