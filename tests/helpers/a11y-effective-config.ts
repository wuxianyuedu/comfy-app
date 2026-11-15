/**
 * tests/helpers/a11y-effective-config.ts — 门禁自测里求值判据配置（`oxlint.parity.config.mjs`）的唯一入口。
 * 并发只让所有用例排队等同一份加载，而钩子必冷；CJS `require`/`import()` 共享模块实例，进程内只求值一次。
 * 谁需要就直接 import 本文件，别在外面绕缓存；`loadJudgeModule()` 故意抛出加载异常，失败路径由 `check-a11y-rules.test.ts` 断言。
 */
import { createRequire } from "node:module";
import path from "node:path";

import { isRecord } from "~/lib/is-record";

/** 判据脚本本体（`scripts/check-a11y-rules.cjs`）。 */
export const SCRIPT = path.resolve(__dirname, "../../scripts/check-a11y-rules.cjs");

/** 真仓库根 —— 判据要读的 `oxlint.parity.config.mjs` 只有真根上有（临时仓库里没有 node_modules）。 */
export const REAL_ROOT = path.resolve(__dirname, "../..");

/** 判据的导出面（`scripts/check-a11y-rules.cjs` 的 `module.exports`）。 */
/** 判据归一的台账形状（`readLedger` 的产物，也是 `judge` 的入参）。 */
export type Ledger = {
  dialect: Array<{ decision: string; keeper: string; rule: string; why: string }>;
  inlineExemptions: Array<{
    file: string;
    keeper: string;
    rule: string;
    why: string;
  }>;
};

/** `judge()` 的判决结果（bin 形态再把它翻成退出码）。 */
export type JudgeVerdict = {
  /** 生效的 jsx-a11y 规则表（`--report` 那一支要逐条打印它）。 */
  effective: Record<string, unknown>;
  /** 问题清单（空 = 通过）。 */
  problems: Array<string>;
  /** 那句一行汇总。 */
  summary: string;
};

export type A11yJudgeModule = {
  /** 生效的 jsx-a11y 规则表（规则名 → 档位）。 */
  effectiveRules: () => Promise<Record<string, unknown>>;
  /** 判一份台账，返回问题清单与汇总 —— bin 形态再用它算退出码。 */
  judge: (ledger: Ledger) => Promise<JudgeVerdict>;
  /** 读一次真的判据配置（`oxlint.parity.config.mjs` 的 `overrides` 形状）。 */
  loadOxlintConfig: () => Promise<unknown>;
  /** 规则档位的归一（`"error"` 与 `["error"]` 同义、`["error", 5]` 不同）。 */
  normalize: (setting: unknown) => string;
  /** 官方 recommended 的有效集合（去 off，带每条 options）。 */
  officialRecommended: () => Promise<Record<string, unknown>>;
  /** 插件全部规则 + 废弃标记。 */
  officialRuleMap: () => Promise<Map<string, { deprecated: boolean }>>;
  /** 读一份台账文件并归一到 `Ledger`（读不到 = 空台账，`--ledger` 的路径由调用方给）。 */
  readLedger: (ledgerPath: string) => Ledger;
  /** 官方两份配置都没提到的规则名。 */
  rulesInNeitherConfig: () => Promise<Array<string>>;
  /** 本脚本对外公开的面（键 = 上面的函数名），用来核「导出面 ⇄ 执行者」。 */
  VERIFIED_SURFACES: Record<string, string>;
};

const requireCjs = createRequire(__filename);

/** 判据模块的消费形状守卫（B5 清账）：八个函数 + 一张表逐个对型。 */
function isA11yJudgeModule(value: unknown): value is A11yJudgeModule {
  if (!isRecord(value)) {
    return false;
  }
  const fns = [
    "effectiveRules",
    "judge",
    "loadOxlintConfig",
    "normalize",
    "officialRecommended",
    "officialRuleMap",
    "readLedger",
    "rulesInNeitherConfig",
  ];
  return fns.every((key) => typeof value[key] === "function") && isRecord(value.VERIFIED_SURFACES);
}

/**
 * 拿判据模块（**整个进程共享同一份**，判据配置只求值一次）。用同步 `createRequire` 而非 `await import()`：
 * 语义相同（同一模块实例），同步写法让取模块这一步不必异步，用例只有真 `judge()` 时才让出事件循环。
 * 加载失败**抛出**、不吞也不返回半张表（判据对它的沉默正是要拦的，见文件头「失败路径」）。
 */
export function loadJudgeModule(): A11yJudgeModule {
  const mod: unknown = requireCjs(SCRIPT);
  if (!isA11yJudgeModule(mod)) {
    throw new Error("check-a11y-rules.cjs 的导出面形状变了 —— 重读该脚本再改这份守卫");
  }
  return mod;
}
