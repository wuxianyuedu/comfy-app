## Added

- **耗时账人读版加了 Windows 双击入口 `tools/start/view-timing.ps1`**（ISSUE #4766 讨论中的后续诉求）。
  两份耗时账本（`.tmp/timing/comfy-precommit-timing.jsonl` / `comfy-premerge-timing.jsonl`）
  是机器逐次追加写的 JSONL，直接读很难；仓里早有两个人读出口
  （`node scripts/gates/precommit-timing.mjs` / `premerge-timing.mjs`），本次给它们补上
  双击入口与一条 `pnpm` 脚本：
  - `tools/start/view-timing.ps1`：默认两份账按顺序各出一张表；`-Target precommit|premerge`
    选一份，`--last N` / `--json` 等参数原样透传给底层脚本；
  - `pnpm timing:view`：跨平台等价（两份按序各出一张表）；
  - 已登记规范 §9.5 对照表、README 双击入口速查与跨平台表、`tools/README.md` 全目录视图
    （`check-ps1-consistency` 三向对齐的那三处）。
