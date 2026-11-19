## Security

**CodeQL `js/insecure-randomness`（#15 / #16，high）**：

- #15 `src/lib/comfyui/client.ts`：探测会话标识从 `Math.random()` 换成
  `globalThis.crypto.randomUUID()`。这串只作「静默探测」日志的去重键，换安全随机源
  零成本（Node 24 与现代浏览器都自带 `globalThis.crypto`），功能不受影响。
- #16 `src/lib/comfyui/firstframe.ts:32`：**定位点本身是误报** —— 分析 commit
  `e790424c` 的该文件全文没有 `Math.random`（`git log -S "Math.random"` 也查不到它的
  历史），第 32 行只是 `const { userId, …, seed } = opts` 的解构；`seed` 只进 ComfyUI
  工作流 `values`，不参与鉴权、令牌或口令派生。同批 PR #3357 另把 `randomSeed()` 的
  随机源换成 `crypto.getRandomValues`（值域不变），源码侧的弱随机也随之消除 ——
  新一次 CodeQL 分析（commit `b195e47e`）已判 0 处。
