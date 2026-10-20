// ── 风格实验室 · 组合与预算判据（§17.2 第①层：纯函数，无 React / 无 IO）──────
//
// 这一屏在批量扇出之前要把「这套选择会展开成多少格」算清楚并显示出来 —— 因为 GPU 一次
// 只跑一张图：本机执行链的并发上限是 `MAX_CONCURRENCY = 1`（`src/lib/comfyui/runner-state.ts`
// 里那条常量与它的注释），所谓「跑一批」实际是把这些格**串行**排队。用户提交前看不见
// 「N 张、约多久」，就会一次交出去几十格然后卡在队列前等 —— 所以这里的三条预算线不是
// 装饰，是把「串行」这个物理事实翻译成界面上的劝退阈值。
//
// 判据本体全在 `src/lib`（不碰视图），因此可在 node 环境直接断言（规范 17 §17.1 那条
// 「删掉 JSX 还能不能跑测试」）。

import type { StyleLabTraits } from "./style-lab-types";

/**
 * 软上限（格）：超过就只是「提示一句这批会很久」，不拦提交。
 * 取 24 是「按下面的单张估算约 17 分钟」这一档 —— 还能让人接受「挂着等」。
 */
export const MATRIX_SOFT_LIMIT = 24;

/**
 * 硬上限（格）：超过就拒绝这一批（下一批的扇出入口会用它挡在提交之前）。
 * 取 60 是「约 42 分钟起步」这一档 —— 再长就该拆成几次试，而不是一口气压满串行队列。
 */
export const MATRIX_HARD_LIMIT = 60;

/**
 * 单张出图的粗略耗时估算（秒）。
 *
 * 这是一条**预算口径**而不是测量结果：本机单张文生图从排队到落盘大致这个量级，用它把
 * 「多少格」换算成「大概多久」显示给用户。真正跑起来之后以队列的真实耗时为准（见
 * 队列那一屏），这里只负责提交前的那一句「大概要多久」。
 */
export const SECONDS_PER_IMAGE_ESTIMATE = 42;

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
