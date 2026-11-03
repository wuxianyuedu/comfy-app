## Changed

- **「执行链」这份面收成一处**（ISSUE #2914）：新增
  `scripts/lib/execution-chain-files.mjs` 作为唯一权威定义，导出两份具名子集 ——
  `CHANNEL_RETIRE_FACE`（通道闸：17 项前缀派生规则 + 历史 emitter 五锚点，派生逻辑逐字保持）
  与 `IN_MEMORY_QUEUE_FACE`（派发闸：5 项登记制，每份进面文件带理由注释）。
  `tests/in-process-event-channel-retired.test.ts` 与
  `tests/dispatch-startup-points.test.ts` 改为 import 同一模块取各自子集，
  判据本体（断言、扫描方式、失败文案）一字未动。两份面**刻意不合并**：通道面要宽
  （反向断言少判 = `not.toMatch` 恒真 = 静默缩小），队列面要窄（多列只是空判，
  且 `queue-status.server.ts` 不在前缀规则里）—— 为什么不同、新文件该登记进哪份面，
  都写在模块文件头。基线对照：改动前后通道面 17 项逐项一致、队列面 5 项逐字相同，
  两闸 26 + 8 条用例改动前后全绿。
