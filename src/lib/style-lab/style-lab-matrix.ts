// ── 风格实验室 · 组合与预算判据（§17.2 第①层：纯函数，无 React / 无 IO）──────
//
// 这一屏在批量扇出之前要把「这套选择会展开成多少格」算清楚并显示出来 —— 因为 GPU 一次
// 只跑一张图：本机执行链的并发上限是 `MAX_CONCURRENCY = 1`（`src/lib/comfyui/runner-state.ts`
// 里那条常量与它的注释），所谓「跑一批」实际是把这些格**串行**排队。用户提交前看不见
// 「N 张、约多久」，就会一次交出去几十格然后卡在队列前等 —— 所以这里的两条预算档位
// （劝退 / 拒绝）与那条实测路径不是装饰，是把「串行」这个物理事实翻译成界面上的数字。
//
// 判据本体全在 `src/lib`（不碰视图），因此可在 node 环境直接断言（规范 17 §17.1 那条
// 「删掉 JSX 还能不能跑测试」）。

import type { StyleLabTraits } from "./style-lab-types";

/* 下面两条是**策略**（人定的档位），不是测量：它们回答的是「这批该不该劝退 / 该不该拦住」，
 * 而「这批要多久」必须由 {@link medianSeconds} 那条**实测**路径回答 —— 拿一个拍出来的
 * 每秒数去换算，界面上那句「约 34 分钟」就是假数（同一个数字既当预算又当 ETA 时，
 * 它改一次、两屏各错一次，而没有任何一处会红）。两条的分工：
 *   · 软上限：只提示、不拦提交 —— 用户知道自己要挂着等，那就让他等（长批是这一屏的正当用法）；
 *   · 硬上限：直接拒绝 —— 超过它时「等着」不再是用户想要的，而是把串行队列压满的事故，
 *     拆成几次才是那批格子应有的形状，所以这里必须有闸。 */

/**
 * 软上限（格）：超过就提示「这批会很久」，但**不拦提交**。
 */
export const MATRIX_SOFT_LIMIT = 24;

/**
 * 硬上限（格）：超过就拒绝这一批，并要求拆成几次（`runBatch` 挡在提交之前）。
 */
export const MATRIX_HARD_LIMIT = 60;

/**
 * 已测出的单张耗时（秒）→ 中位数；**没有样本时返回 `null`，绝不给一个兜底数字**。
 *
 * 为什么是 `null` 而不是某个常数：调用方（界面的 ETA 那一格）需要区分「本机还没跑过图」
 * 与「跑过、大概这么久」。返回 `null` 让前者显示成一句实话（「本机还没有可参考的出图耗时」），
 * 而不是显示一个看起来像测量的假数。
 *
 * 为什么取中位数而不是平均数：单张耗时是个**重尾**分布（首次跑要加载模型、显存不够要
 * 回收、工作流偶尔多一步 upscale），一次异常慢的样本会把平均数抬到不像话，而中位数
 * 描述的是「正常一张要多久」——那正是提交前想问的那件事。
 */
export function medianSeconds(durations: readonly number[]): number | null {
  const n = durations.length;
  if (n === 0) return null;
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  /* 奇数取正中那一枚、偶数取中间两枚的均值（中位数的定义）。
   * 用 slice 取中间段而不是下标取值：下标读在 `noUncheckedIndexedAccess` 下是可空的，
   * 于是要么写 `as number`（eslint 判该用 !）、要么写 `!`（撞本仓 check-non-null-assertions
   * 硬闸，存量已清零）—— 换成切片后这里根本不存在可空索引，两条判据都不碰。 */
  const middle =
    n % 2 === 1 ? sorted.slice(mid, mid + 1) : sorted.slice(mid - 1, mid + 1);
  const sum = middle.reduce((a, b) => a + b, 0);
  return sum / middle.length;
}

/**
 * 某一维参与扇出的取值个数：**没选任何值 = 1（不约束）**，而不是 0。
 *
 * 判据为什么这样定：把「没选」算成 0 会让整个乘积归零，于是「只挑了风格、一维特征都没勾」
 * 这种最常见的形状会被显示成「0 格」—— 而它其实是「这一批不约束特征、每个风格各出一张」。
 * 空维给 1 才是这句话的算术表达。
 */
function axisCardinality(values: readonly string[] | undefined): number {
  return values && values.length > 0 ? values.length : 1;
}

/**
 * 组合数 = 各维取值个数的乘积（空维按 1 计）。
 *
 * 没有任何维度时返回 1（一套风格、不约束特征 ⇒ 就一格），而不是 0 —— 0 会让「只填了
 * 名字什么都没选」的半成品显示成「零格」，与「选了但展开成一格」混为一谈。
 */
export function combinationCount(traits: StyleLabTraits): number {
  let total = 1;
  for (const values of Object.values(traits)) {
    total *= axisCardinality(values);
  }
  return total;
}

/**
 * 枚举全部组合：返回 `Record<维度 id, 选中值>[]`（按 `traits` 的键序展开）。
 *
 * 「不约束」的那一维在结果里落成空串 `""` —— 它是「这一维不进入提示词」的显式标记，
 * 而不是「这一维不存在」（键一直在，值可空），下游拼提示词据此判断要不要带这一段。
 *
 * 结果长度恒等于 {@link combinationCount} 的返回值：这两条判据必须对得上，否则界面上
 * 「K 格」与真正会展开出来的清单会各报一个数（同一个形状写两处就会漂）。
 */
export function enumerateCombinations(
  traits: StyleLabTraits,
): Array<Record<string, string>> {
  const axisIds = Object.keys(traits);
  let combos: Array<Record<string, string>> = [{}];
  for (const axisId of axisIds) {
    const values = traits[axisId];
    // 空维 → 用一个空串占位，保证这一维仍出现在每个组合里、且只贡献一种取值。
    const candidates = values && values.length > 0 ? values : [""];
    const next: Array<Record<string, string>> = [];
    for (const combo of combos) {
      for (const value of candidates) {
        next.push({ ...combo, [axisId]: value });
      }
    }
    combos = next;
  }
  return combos;
}
