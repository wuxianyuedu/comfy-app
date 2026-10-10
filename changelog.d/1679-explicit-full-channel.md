## Added

- **提交门槛增量层有了「按名字要全量」的显式档**：`node scripts/run-affected-tests.mjs --full`
  （承接 #1679 的「增量 / 全量两档」一问；ISSUE #1393 写下的那个重开条件）。`affected-tests.mjs` 命中公共地基时**放弃收窄**、只跑固定
  清单 68 个，而这条兜底此前**没有具名出口** —— 规范那句「翻兜底的前置是先造一条显式的全量
  通道」说的就是这个洞。本档跳过暂存区解析、不拼位置参数（由 vitest 自行收集全部），并**复用**
  同一条判决链（`runChunk([], …)`），所以超时形态照样走「等负载回落 + `--no-file-parallelism`
  隔离复跑」、`COMFY_PRECOMMIT_MAX_WORKERS` 照样认。

  **与「谁都没筛过」的意外空集是相反方向的两件事**：后者仍然阻断（`return 1`），话术里指出
  另一档就是它 —— 两者在退出码与日志上必须可分辨，否则这一档会变成「静默放行全体」的后门。
  本档**不接进钩子**（钩子只有增量档），与 `pnpm test:full`（保留 `KNOWN_FAILED_FILES`、
  用来复现基线失败）是两件事。`wideFallbackNote()` 的宽收窄话术现在指名这条命令，由
  `tests/hook-affected-launch.test.ts` 两半一起钉（话术里有这条出口 **且** 入口认这个旗标）。
