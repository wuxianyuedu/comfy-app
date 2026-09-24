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
 * @module comfyui/random-seed — 生成用非负随机种子（纯函数）
 */

/** 与 comfy 前端 seed 量级一致的非负随机种子（`[0, Number.MAX_SAFE_INTEGER)`）。 */
export function randomSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}
