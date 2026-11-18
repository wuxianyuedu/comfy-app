## Added

- **桌包档补 `push` 触发：壳相关内容合入 `master` 即自动构建一次（ISSUE #4326）**：
  此前 tauri 壳只有每日定时档（北京 03:37）与手点 / API 触发口，壳相关改动合入后
  最长要等 24h 才有新壳。现 `.github/workflows/package-desktop.yml` 增加
  `push`（master + paths）触发口：paths 收 `src-tauri/**`、`public/splash.html` 与
  `scripts/build-desktop.mjs` 等装配链脚本 —— 改了「壳或它的装配链」才触发；前端业务
  改动（`src/**`）刻意不进触发面，仍由每日档兜底刷新，不让每次合并都付一次 Windows
  全量构建。定时档保留不动，作 24h 兜底；push 触发与定时 / 手点口共用 `package`
  并发锁，更新的一跑掐掉在跑的旧跑。
  判据：`tests/ci-ga-trigger-map.test.ts` 钉住触发面形状（master + paths 逐条点名）。
