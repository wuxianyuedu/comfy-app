## Security

**CodeQL `js/insecure-randomness`（#15 / #16，high）**：

- #15 `src/lib/comfyui/client.ts`：探测会话标识从 `Math.random()` 换成
  `globalThis.crypto.randomUUID()`。这串只作「静默探测」日志的去重键，换安全随机源
  零成本（Node 24 与现代浏览器都自带 `globalThis.crypto`），功能不受影响。
- #16 `src/lib/comfyui/firstframe.ts:32`：**误报**，按 `false positive` 在告警侧处置。
  证据：分析 commit `e790424c` 的该文件里没有 `Math.random`（`git log -S "Math.random"`
  也查不到该文件的历史），第 32 行是 `const { userId, …, seed } = opts` 的解构；
  `seed` 是出图用的艺术参数（调用方 `orchestrator` / `run-engine` 传 `randomSeed()`），
  只进 ComfyUI 工作流 `values`，不参与鉴权、令牌或口令派生 —— 不构成安全上下文。
