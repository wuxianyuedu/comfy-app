/**
 * ComfyUI 工作流图的「JSON 净化 + 深拷贝」唯一出口。
 *
 * 执行链在派发 / 预览前要对入参图做一份可安全改写的副本，同时借 JSON 序列化
 * 抹掉 undefined / 函数 / 符号等不可落到磁盘的值。此前这件事在 comfyui 域内
 * 被逐字抄了 6 份（raw-overrides ×2 / reference-loader-augment ×2 /
 * reference-loader-chain ×2），按 §12.12 / §12.18 收口到这里：一处实现、一处
 * 评估是否换更快等价实现（如 structuredClone 或按需深拷贝），6 个调用点只 import。
 *
 * 边界：只收口「净化 + 深拷贝」这一层，不碰各调用点后续的 override 应用 / 图增强
 * 逻辑（那是各自业务）。原对象不被修改；返回值是与入参无共享引用的新结构。
 *
 * 纯函数、无 IO、无 Node 依赖 —— 执行链与纯 Node 宿主都能安全 import（不进
 * `server-only`，否则会把不经 Next 打包的宿主一起带崩，见 §18.4；与同域
 * `random-seed` 同形态）。
 *
 * @module comfyui/clone-json-graph — 工作流图 JSON 净化 + 深拷贝唯一出口
 */

/**
 * 对 `value` 做一次 JSON 净化 + 深拷贝，返回 `unknown`（形状由调用点各自收窄）。
 *
 * 用「stringify → parse」而非 `structuredClone`：要的是 JSON 语义的净化
 * （丢弃 undefined / 函数 / 符号、NaN/Infinity 归一成 null；顶层 undefined
 * 原样返回），structuredClone 会保留这些值，行为不等价。代价是两次全量遍历 + 字符串分配；是否在主线程
 * 热点路径上换更快实现，统一在本出口评估，调用点不各自决定。
 */
export function cloneJsonGraph(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return value;
  }
  return JSON.parse(serialized) as unknown;
}
