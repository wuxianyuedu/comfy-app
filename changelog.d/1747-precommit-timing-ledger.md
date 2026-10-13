## Added

- **每一次 pre-commit 的耗时留在本机，可回看**（ISSUE #1747 第八笔账）。此前的读数
  全部来自议题讨论里的一次性测量，写完就冻在文档里 —— 「**我这台机器上刚才那次
  多久**」与「**上一次慢在哪一步**」两个问题都没人回答（钩子只把每组一行 `[ok]`
  摘要打出来，逐步骤的时长跑完就没了）。
- 新增 `scripts/precommit-timing.mjs`：记账侧由钩子调用，读账侧给人看
  （最近 N 次的表 / 各组中位数 / D 组最贵的前几步 / `--json` / `--clear`）。
  账本落 **`.git/comfy-precommit-timing.jsonl`**（JSONL 追加写）—— 与
  `comfy-premerge-proof.json` **同一个理由**：它记的是「这台检出这一次提交」，
  写进版本库会让同仓并行检出互相污染。每条记总墙钟 + A/B/C/D 四组墙钟 +
  D 组每一步的墙钟 + 暂存文件数（耗时随改动面涨，只有时长没有面就是半条账）。
- 新增 `.githooks/timing.sh`：毫秒墙钟（GNU `date` 的 `%N`；BSD/macOS 不认它时退到
  「秒 × 1000」）与逐步计时 `timed_step()`。**单独一份**的理由是 D 组跑在 `sh -c`
  起的**新 shell** 里、外层函数看不到，而两份时钟必然漂成两个刻度。
- 钩子接线：`run_group` 记各组墙钟，D 组的 `run()` 走 `timed_step`，记账挂在
  **EXIT trap** 上 —— **被拦下的那次提交恰恰是最该被记的**（拦下走 `exit 1`，
  收尾那一行到不了）。`COMFY_TIMING_SH` 与 `LOGD` 都 `export`（D 组是新 shell）。
- `tests/precommit-timing.test.ts`（11 条）：记账/读账往返、账本落点、追加语义、
  解析失败计数、不在检出里不报错、报告形状、`--last` / `--clear`、半截行容错，
  以及接线四条（两处 source 同一份、`run()` 走 `timed_step`、两个变量都导出、
  trap 顺序）。

## Fixed

- 无。
