/* ── 生成参数取值（未知值 → 可用值）──
 *
 * `Shot.params` / 角色卡 `defaultParams` 这类「推荐生成参数」是 `Record<string,
 * unknown>`：值来自服务端序列化产物、技能种子或用户手改的 JSON，读出来什么都
 * 可能是。内置 txt2img 的入参必须是确定的 `number` / `string`，所以在组装
 * `GenerateInput` 时统一过这里。
 *
 * 为什么收敛到这一处：同样的两个函数此前在工坊里被逐字抄了三份（镜头生图视图、
 * 工坊管线 hook、角色定妆照网络层），缺省值也各写一遍。缺省值一旦要调（例如
 * 换默认采样器），每份都要改，漏掉一份就是「同一次生图里两条链路参数不同」——
 * 这种不一致只会表现为出图结果不同，排查成本极高。
 *
 * 本模块无 React、无副作用（规范 17 §17.2 第①层）。
 *
 * 与 `lib/error-message` 的空串口径一致：「空串 = 没有值」也适用于参数——
 * 参数表里留了个 `""` 通常是用户清空输入框的结果，应落回缺省值。
 */

/** 内置 txt2img 的缺省生成参数：与 `lib/skills-seed.ts` 的技能默认值同口径。 */
export const DEFAULT_GEN_PARAMS = {
  steps: 28,
  cfg: 7,
  sampler: "euler_ancestral",
  scheduler: "normal",
} as const;

/** 取字符串参数：非字符串、空串一律落回 fallback。 */
export function paramString(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

/** 取数值参数：接受数字与数字字符串（参数表可能来自 JSON / 表单），
 *  非有限值（NaN / Infinity / 对象 / 数组 / 布尔）落回 fallback。
 *
 *  空串要显式拦掉再解析：`Number("")` 是 **0** 而不是 NaN，直接解析会把
 *  「用户清空了步数输入框」变成「步数 = 0」（画面全黑），而不是回落到缺省值。 */
export function paramNumber(value: unknown, fallback: number): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string" || !value.trim()) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/** 取整数参数：在 `paramNumber` 之上取整（steps 这类由 ComfyUI 按整数消费）。 */
export function paramInt(value: unknown, fallback: number): number {
  return Math.round(paramNumber(value, fallback));
}
