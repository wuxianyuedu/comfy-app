/**
 * 模型封面的兜底渐变（卡片与详情弹窗共用同一支）。
 *
 * 「没有封面」这件事在两个地方都要被看见，而它们**必须长成同一个样子**：
 * 否则用户会以为详情页换了张图。原先这份色表只长在 `ModelCard.tsx` 里，
 * 详情要复用就得再抄一遍 —— 那就是 §12.12 的孪生对开头。
 */

const GRADIENTS = [
  "linear-gradient(135deg,#7C5CFC 0%,#FF5CA8 100%)",
  "linear-gradient(135deg,#5B8DEF 0%,#7C5CFC 100%)",
  "linear-gradient(135deg,#22C55E 0%,#0EA5E9 100%)",
  "linear-gradient(135deg,#F59E0B 0%,#FF5CA8 100%)",
  "linear-gradient(135deg,#EC4899 0%,#8B5CF6 100%)",
  "linear-gradient(135deg,#0EA5E9 0%,#22D3EE 100%)",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 色表为空时的兜底（正常不会走到；写出来是为了不用非空断言）。 */
const FALLBACK_GRADIENT = "linear-gradient(135deg,#7C5CFC 0%,#FF5CA8 100%)";

/**
 * 按 id 取一支稳定渐变：同一个模型每次渲染、在卡片和详情里都是同一色。
 * 它是**装饰**，不承担状态语义（可用性/类型各有自己的徽标）。
 */
export function modelCoverGradient(id: string): string {
  return GRADIENTS[hash(id) % GRADIENTS.length] ?? FALLBACK_GRADIENT;
}
