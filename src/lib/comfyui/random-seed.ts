/**
 * 生成用的非负随机种子（ComfyUI 风格，落在 JS 安全整数范围内）。
 *
 * 「种子」是自主生成链路的通用能力：Agent 逐镜生图、成片视频 autopilot 每次自主
 * 出图都要一个新随机 seed（同提示词也能换图）。此前这份 `Math.floor(Math.random()
 * * Number.MAX_SAFE_INTEGER)` 在多处各抄一遍（run-engine、raw-overrides），按 §12.18
 * 「跨模块通用能力补进地基写一次」收在这里，两处自主出图循环一律 import。
 *
 * 纯函数、无 IO、无 Node 依赖 —— 客户端与服务端都能安全 import（不进 `server-only`，
 * 否则会把启动/构建链路的纯 Node 宿主一起带崩，见 §18.4）。
 *
 * 随机源用 `globalThis.crypto.getRandomValues` 而不是 `Math.random`：`seed` 这个名字
 * 会被 CodeQL 的 `js/insecure-randomness` 判成 cryptographic key sink（ISSUE #3321 /
 * 告警 #16）。采样种子本身不需要保密，但换 CSPRNG 后值域与类型不变 —— 仍是
 * `[0, 2^52)` 的非负安全整数，对调用方与出图结果没有行为差异。
 *
 * @module comfyui/random-seed — 生成用非负随机种子（纯函数）
 */

/** 高 32 位左移 20 位 ⇒ 与低 20 位拼成 52 位（`2^52 - 1` 仍在安全整数内）。 */
const HI_WEIGHT = 1_048_576;

/** 与 comfy 前端 seed 量级一致的非负随机种子（`[0, 2^52)`，安全整数）。 */
export function randomSeed(): number {
  const words = globalThis.crypto.getRandomValues(new Uint32Array(2));
  const hi = words.at(0) ?? 0;
  const lo = words.at(1) ?? 0;
  return hi * HI_WEIGHT + (lo >>> 12);
}
