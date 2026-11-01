/**
 * tests/helpers/a11y-effective-config.ts — 门禁自测里「求值 `eslint.config.js`」的唯一入口。
 *
 * ── 为什么需要它（这一份的来由不是「短一点」） ───────────────────────────
 *
 * `scripts/check-a11y-rules.cjs` 的被测输入里最贵的一件就是**那份真的 eslint 配置**：
 * 它 import 了整个 `eslint-config-next`，**首次**求值在干净检出上要 40s+
 * （用户侧实测，8 核 / 16G；被 Next 起过、`.next/` 在时 ~1.1–1.7s）。口径与派生链
 * 见规范 §11.19.1 的档 E。
 *
 * 而 `tests/a11y-rules-gate.test.ts` 要拿十来份台账各判一次。33418b72 把「每条用例
 * spawn 一个子进程」改成了异步 `execFile` + `it.concurrent` —— 稳态（`.next/` 热）
 * 下确实买到了墙钟（19.5s → 6.2s），但**冷检出上它换来的正是最坏的那种形态**：
 * 十来个子进程在同一个 `import()` 上排队，每个都要自己把那份配置求值一遍，于是
 * 「并发」把十来次 40s 的等待首尾相接变成了一起等在同一份加载上 ——
 * 而钩子每次提交都是**新进程、必然冷**（10/10 超时）。
 *
 * ── 这一份给的形状 ────────────────────────────────────────────────────
 *
 * 判据是 **CJS**，于是 `require()` 它拿到的是**同一个模块实例**（与动态 `import()`
 * 也同一个 —— 实测），而 `import()` 对同一个模块只求值一次。所以「进程内共享」这件事
 * 是**免费**的：真求值从「每条用例一次」塌成「整个进程一次」。
 *
 * ⚠️ 只有**同一个 module graph** 才共享。所以约定是：**谁需要，谁就 `import`
 * 这个文件**（静态 `import` 会被提升到 beforeEach 之前），别在这个文件外面
 * 用 `createRequire` / 动态 `import()` 自己拿一遍 —— 那等于绕过缓存，
 * 又把成本乘回去（见本文件最后那一段）。
 *
 * ── 失败路径（这一份的第二个职责） ──────────────────────────────────────
 *
 * 「求值失败」在共进程里**没有身份**：`createRequire` 与动态 `import()` 都会走
 * 该脚本的**模块缓存**，所以一个「在子进程里必然失败、在缓存之后必然成功」的样本
 * （`.next/` 陈旧、`@eslint/compat` 被删掉这类）没法在同一个进程里两种形态各测一次。
 * 于是这一份**故意**不替调用方吞失败：`loadJudgeModule()` 把加载异常原样抛出去，
 * 让用例去断言那个失败路径（判据崩了要 `exit 1`、且不许把半张表当结论用）。
 *
 * 这不是「测不到就拉倒」：**判据**那一侧仍然要正面回答「加载失败时我是不是 1」，
 * 只是回答它的是这里的**抛**、不是子进程 —— 这一格的真站点是
 * `tests/check-a11y-rules.test.ts`（配套的 `a11y-rules-gate.test.ts` 是台账那一批）。
 */
import { createRequire } from "node:module";
import path from "node:path";

/** 判据脚本本体（`scripts/check-a11y-rules.cjs`）。 */
export const SCRIPT = path.resolve(__dirname, "../../scripts/check-a11y-rules.cjs");

/** 真仓库根 —— 判据要读的 `eslint.config.js` 只有真根上有（临时仓库里没有 node_modules）。 */
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
  /** 读一次真的 `eslint.config.js`（扁平配置数组）。 */
  loadEslintConfig: () => Promise<Array<unknown>>;
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

/**
 * 拿判据模块（**整个进程共享同一份**，于是 `eslint.config.js` 只求值一次）。
 *
 * 同步（`createRequire`）而不是 `await import()`：语义在这里一样（同一个模块实例），
 * 而同步的写法让「拿到模块」这一步不必是异步，用例只有真去 `judge()` 时才让出事件循环。
 *
 * 加载失败会**抛**出去 —— 不吞、不返回半张表（判据那边对它的沉默正是要拦的东西，
 * 见文件头「失败路径」）。
 */
export function loadJudgeModule(): A11yJudgeModule {
  return /* SAFETY: 类型断言已复核 */ requireCjs(SCRIPT) as A11yJudgeModule;
}
