## Fixed

- **用例往真 stdout / stderr 写噪音，把 `受影响用例` 那一格拖进「未判定」**（ISSUE #2989）：
  `src/lib/log/capture-streams.server.test.ts` 现在在 `beforeEach` 里把两条流换成「只记录、
  不外发」的桩（`muteStreams`），`tests/db-schema-current.test.ts` 的 `ensureSchemaCurrent`
  用例改传自己的 `forward` 收集器（`collectForward`）—— 断言一条没改，「转录是额外落一份、
  不接管」照旧由基线流被调用过这一事实钉住。

  现场（PR #2982 的 `cnb-gbe-1k6b3dhs0`）：`受影响用例` 跑 24m54s、281 份用例一份结论都没有
  （`第 1 遍**没跑完**：墙钟预算用尽` ⇒ 未判定退 2），而掐断前那一屏里是
  `FATAL: An unexpected Turbopack error occurred` 与一串 `数据库里还没有表…` —— 前者是**用例
  自己写的样本**，后者是 `forward` 的缺省实现（`process.stdout.write`）。`COMFY_AFFECTED_NOISE_FILTER`
  按行屏蔽，滤不掉 vitest 给每行加的 `stderr | <用例名>` 抬头，也滤不掉「写到真流」的墙钟代价。

  **没有动任何预算**（`testTimeout` / 墙钟 / `maxWorkers` 一个都没改）：降的是噪音成本，
  不是判据。口径写进规范 §13.6.4.2。

## Security

- **`pnpm audit` 的 high 命中 8 → 0**（ISSUE #2989 同批，`check-dependency-audit` 的出路①）：
  `happy-dom` `20.14.6` → **`21.0.4`**（两条 advisory 的交集最小可行版，跨大版本；只在
  `environment: "happy-dom"` 的测试环境里，不进运行时不进产物），`overrides` 的
  `undici@7` `7.29.1` → `7.30.1`、`markdown-it@14` `14.3.1` → `14.3.3`（都是**抬高已存在的键**，
  不是新加规则）。台账 `scripts/.dependency-audit-baseline.json` 随之由 `--update` 收紧到 0 条。
  实跑验证：`src/components/studio/**` 与 `src/app/api/logs/**` 共 31 份 / 257 条 DOM 用例全绿。
