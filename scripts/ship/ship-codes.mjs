/**
 * ship-codes.mjs — ship 链的**退出码表（唯一出处）**（ISSUE #3083）。
 *
 * 为什么要有这一份：在 #3083 之前全链只有三态（0 绿 / 1 红 / 2 没跑起来），
 * 「PR 冲突平台不跑 CI」「还在排队」「读数缺键」「被守卫拦下」「本地前置不成立」
 * 五种**出口完全不同**的情形全折在同一个 2 里 —— 看到退码不知道是哪件事，
 * 只能回头翻日志。用户拍板：不同情况必须用不同退出码。
 *
 * 兼容口径（不许打乱）：
 *   - `0` 走到终态、且事实为绿（不是「默认值」）；
 *   - `1` 有事实是红的（CI 红 / 平台明确说没合上 / 验证读了数说不在）；
 *   - `2` 没跑起来（**泛化兜底**：执行者不在、cnb 缺席、cancelled、用法错…未细分项）；
 *   - `2` 及以上这一族统称「没跑起来家族」—— 合码时**压过** `1`，`1` 压过 `0`
 *     （与 premerge-check.mjs / base-check.mjs 的三态同口径，2 的压栈语义不变）。
 *   - `3`–`7` 是 ship 对「没跑起来」的细分：CI / 合并自动化可以照旧按「非零即不过」
 *     消费；人看退码直接定位是哪一类。
 *
 * 码表（与 CODE_TABLE 一一对应，对账测试锁死）：
 *   0 GREEN            走到终态且事实为绿
 *   1 RED              有事实是红的（CI 红 / merge-pull 说没合上 / 验真读了数说不在）
 *   2 NOT_RUN          没跑起来（泛化兜底：执行者不在 / cancelled / 归属不到 / 用法错）
 *   3 CONFLICT         PR 与 base 冲突，平台不派生 CI —— 先解冲突再重跑
 *   4 CI_PENDING       CI 无终态（排队 / 在跑超预算 / 签名断流），PR 可合并
 *   5 READOUT_MISSING  关键读数缺失（mergeable_state 缺键 / 回读没跑起来 / 基线取不到）
 *   6 GUARD_REFUSED    守卫拦住这一跳（已随 PR 落地 #2250 / 跑期内分支被切换 #2812）
 *   7 PREFLIGHT        本地前置不成立（非 git 检出 / 在 master 上 / 缺碎片 / 依赖没装）
 */

/**
 * 退出码常量。加新码 = 改这一份 + CODE_TABLE + 对账测试；不许在别处写魔数。
 */
export const CODE = {
  GREEN: 0,
  RED: 1,
  NOT_RUN: 2,
  CONFLICT: 3,
  CI_PENDING: 4,
  READOUT_MISSING: 5,
  GUARD_REFUSED: 6,
  PREFLIGHT: 7,
};

/**
 * 码 ↔ 语义对账表：错误文案、规范 §13.6、SKILL.md 与对账测试共用这一份。
 * `next` 是「下一步干什么」的一句话；长出口命令仍由各出口现拼（参数在调用点）。
 *
 * @type {ReadonlyArray<{code:number, name:string, semantics:string, next:string}>}
 */
export const CODE_TABLE = Object.freeze([
  {
    code: CODE.GREEN,
    name: "GREEN",
    semantics: "走到终态且事实为绿",
    next: "无（不是默认值，是走完且读了数）",
  },
  {
    code: CODE.RED,
    name: "RED",
    semantics: "有事实是红的（CI 红 / 平台明确拒绝 / 验真读了数说不在）",
    next: "按红的那一格修，再重跑",
  },
  {
    code: CODE.NOT_RUN,
    name: "NOT_RUN",
    semantics: "没跑起来（泛化兜底：执行者不在 / cancelled / 归属不到 / 用法错）",
    next: "看日志里第一个「没跑起来」的是哪一格",
  },
  {
    code: CODE.CONFLICT,
    name: "CONFLICT",
    semantics: "PR 与 base 冲突，平台不派生 CI",
    next: "git fetch <远端> && git merge <基线> 逐个解 → push → 重跑 pnpm ship",
  },
  {
    code: CODE.CI_PENDING,
    name: "CI_PENDING",
    semantics: "CI 无终态（排队 / 在跑超预算 / 签名断流），PR 可合并",
    next: "去平台看那一跑；或重跑 pnpm ship 接着等",
  },
  {
    code: CODE.READOUT_MISSING,
    name: "READOUT_MISSING",
    semantics: "关键读数缺失（mergeable_state 缺键 / 回读没跑起来 / 基线取不到）",
    next: "核平台的 PR / build 页；读数补上了再重跑",
  },
  {
    code: CODE.GUARD_REFUSED,
    name: "GUARD_REFUSED",
    semantics: "守卫拦住这一跳（已随 PR 落地 / 跑期内分支被切换）",
    next: "已落地 ⇒ 开新分支；被切换 ⇒ 切回来重跑",
  },
  {
    code: CODE.PREFLIGHT,
    name: "PREFLIGHT",
    semantics: "本地前置不成立（非 git 检出 / 在 master 上 / 缺碎片 / 依赖没装）",
    next: "按预检念的缺什么补什么，再重跑",
  },
]);

/** 码 → 名字（给错误文案带码用；取不到就照实念「?」，不猜）。 */
const NAME_BY_CODE = new Map(CODE_TABLE.map((row) => [row.code, row.name]));

/**
 * 错误文案里的码标签：`退 3 CONFLICT` 这样的短签 —— 看日志第一眼就知道退码
 * 与类别，不用翻到进程退出码。
 *
 * @param {number} code
 * @returns {string}
 */
export function codeTag(code) {
  return `退 ${code} ${NAME_BY_CODE.get(code) ?? "?"}`;
}

/**
 * 把各阶段退出码压成一个：「没跑起来家族」（≥ 2）压过「红」（1），「红」压过「绿」。
 * 理由与三态时代相同：「没拿到测量」与「测量结果是红的」是两件事，混起来就是
 * 静默失效；同族取**最早**那一格（codes 按阶段序排，越靠前越靠近根因）。
 *
 * @param {number[]} codes
 * @returns {number}
 */
export function combineShipCodes(codes) {
  const [firstNotRun] = codes.filter((c) => c >= CODE.NOT_RUN);
  if (firstNotRun !== undefined) {
    return firstNotRun;
  }
  return codes.includes(CODE.RED) ? CODE.RED : CODE.GREEN;
}
