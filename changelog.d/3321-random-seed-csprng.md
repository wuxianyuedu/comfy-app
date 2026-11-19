## Fixed

**采样种子改用 CSPRNG**（code-scanning `js/insecure-randomness`，ISSUE #3321 / 告警 #16）：

- `src/lib/comfyui/random-seed.ts` 的 `randomSeed()` 从 `Math.random` 换成
  `globalThis.crypto.getRandomValues`：`seed` 这个名字会被 CodeQL 当成 cryptographic key
  sink。采样种子本身不需要保密，但换 CSPRNG 后仍产出 `[0, 2^52)` 的非负安全整数 ——
  值域、类型、调用方语义与出图行为均不变，只把不可预测性提到判据要求。
- 同单的 #15（`client.ts` 的探测会话标识）已由 #3353 修复，本碎片只记剩下这一处。
- 读数：`random-seed`/`firstframe`/`orchestrator`/`run-engine`/`raw-overrides` 五份用例
  58 条全绿；`tsc --noEmit` 0；已清零 oxlint 规则集 41 条全仓 0 命中。
