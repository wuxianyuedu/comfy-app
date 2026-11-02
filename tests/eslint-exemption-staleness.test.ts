/**
 * `scripts/check-eslint-exemptions.cjs` 的用例（ISSUE #2607 第 3 条）。
 *
 * 这份判据要守的那件事很窄：**eslint 的文件级豁免台账里，有没有已经不需要的豁免**。
 * 而它上线前量到的最坏形状不是「判错」，是**「一条都没判」被打成「台账全部陈旧」**：
 * `Linter#verify` 的内联配置写成形（eslintrc 形而非 flat 形）时，对每一份文件都抛错，
 * 取数脚本照样能打出一行「命中 0 处 / 0 份文件」。所以这组用例的重心不在
 * 「陈旧能不能判红」（那是一条过滤），而在**「没判成」会不会被读成结论**。
 *
 * 分工：
 *  · `judge` 那几条是**纯判决**，夹具直接喂三件输入（不碰磁盘，毫秒级）；
 *  · `readFileLevelExemptions` 那两条判「从扁平数组里认出台账」这件事；
 *  · 最后一条是 **bin 形态**：起真子进程跑真配置 —— 新驱动器必须拿它自己跑一遍
 *    （本仓那条口径），它同时是「台账认法在真件上成立」与「退出码形状」的唯一执行者。
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "vitest";

const REAL_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REAL_ROOT, "scripts", "check-eslint-exemptions.cjs");

/** `verify` 的最小形状（本文件只喂它自己造的读数，不依赖 eslint 的消息类型）。 */
type FakeMessage = {
  fatal?: boolean;
  message?: string;
  ruleId?: string | null;
};
type FakeLinter = {
  verify: (code: string, config: unknown, opts: { filename: string }) => Array<FakeMessage>;
};

/** 判据的导出面（与 `scripts/check-eslint-exemptions.cjs` 的 `module.exports` 对齐）。 */
type JudgeModule = {
  FILE_LEVEL_EXEMPTIONS: Array<{ removalCriterion: string; ruleId: string }>;
  isGlobEntry: (entry: string) => boolean;
  judge: (input: JudgeInput) => {
    entries: number;
    failed: Array<{ file: string; why: string }>;
    removalCriterion: string;
    ruleId: string;
    scanned: number;
    stale: Array<string>;
    state: "pass" | "stale" | "inconclusive";
    unresolvable: Array<string>;
    violating: number;
  };
  readFileLevelExemptions: (
    config: Array<{ files?: string | Array<string>; rules?: Record<string, unknown> }>,
    ruleId: string,
  ) => { entries: Array<string>; mentionedAnywhere: boolean };
  scanViolations: (p: {
    files: Array<string>;
    makeLinter?: () => FakeLinter;
    readFile?: (absPath: string) => string;
    root: string;
    ruleId: string;
  }) => {
    failed: Array<{ file: string; why: string }>;
    scanned: number;
    violating: Array<string>;
  };
};

type JudgeInput = {
  entries: Array<string>;
  failed: Array<{ file: string; why: string }>;
  mentionedAnywhere: boolean;
  removalCriterion: string;
  ruleId: string;
  scanned: number;
  violating: Array<string>;
};

/* 与 `tests/helpers/a11y-effective-config.ts` 同一形状：`.cjs` 判据用 `createRequire` 拿，
 * 加载失败**抛**出去不吞（吞了就是把「判据没跑起来」读成「没有陈旧豁免」）。 */
const { judge, isGlobEntry, readFileLevelExemptions, scanViolations } = createRequire(__filename)(
  SCRIPT,
) as JudgeModule;

const RULE = "no-control-regex";
const CRITERION = "改用非正则方案就可以摘掉（夹具文案）";

/**
 * bin 那条的预算。登记的是**实测成本 + 同族件的冷价**，不是给慢用例兜底（口径见 §11.13）：
 * 本机隔离实测这条命令 **10.4 / 10.9 / 11.6s**（三跑），而同一份 `eslint.config.js` 的
 * 求值成本在同族件（`tests/check-a11y-rules.test.ts` 的头注）里记的是
 * **进程内首值 36.4s / 真子进程 57.1s（冷检出 40s+）** —— 那笔钱是这份判据也要付的，
 * 所以取与它同一档余量（默认 30s 会被 CPU 满载时的首值顶穿 ⇒ 假红，§13.6.4）。
 */
const CLI_BUDGET = { timeout: 120_000 };

/** 造一份最小输入（默认「台账三条、三条都真违例」= 相符）。 */
function input(over: Partial<JudgeInput> = {}) {
  const entries = ["a.cjs", "b.ts", "c.mjs"];
  return {
    ruleId: RULE,
    removalCriterion: CRITERION,
    entries,
    violating: [...entries],
    failed: [] as Array<{ file: string; why: string }>,
    scanned: entries.length,
    mentionedAnywhere: true,
    ...over,
  };
}

test("台账与事实相符 ⇒ pass（不因为「都违例」就报任何东西）", () => {
  const v = judge(input());
  expect(v.state).toBe("pass");
  expect(v.stale).toEqual([]);
});

test("台账里有一份现在不再违例 ⇒ stale 点名那一份，且不动还在违例的那些", () => {
  const v = judge(input({ violating: ["a.cjs", "c.mjs"] }));
  expect(v.state).toBe("stale");
  expect(v.stale).toEqual(["b.ts"]);
});

test("⚠ 每一份都没判成 ⇒ 没结论（退 2 那一档），**不许**读成「台账全部陈旧」", () => {
  /* 这一条钉的是本判据上线前量到的那个真实假绿形状：`verify` 全部抛错时命中集合是空的，
   * 而空命中在朴素实现里正好等于「全部都不再违例」= 最刺眼的那个结论。
   * 断言分两半：状态必须是 inconclusive，且 stale 不能被当成结论使（那一份内容也不许是
   * 「三条全陈旧」的那种可用形态 —— 它只是差集，不构成判决）。 */
  const failed = ["a.cjs", "b.ts", "c.mjs"].map((file) => ({
    file,
    why: 'verify 抛错：Key "parser": This appears to be in eslintrc format',
  }));
  const v = judge(input({ violating: [], failed, scanned: 0 }));
  expect(v.state).toBe("inconclusive");
  expect(v.failed).toHaveLength(3);
});

test("有一份读不到（ENOENT）同样是没结论 —— 「取不到」不等于「没有」", () => {
  const v = judge(
    input({
      violating: ["a.cjs", "c.mjs"],
      failed: [{ file: "b.ts", why: "读不到（ENOENT）" }],
      scanned: 2,
    }),
  );
  expect(v.state).toBe("inconclusive");
});

test("扫到的份数与应扫份数不符 ⇒ 没结论（防止「少扫了几份」冒充绿）", () => {
  const v = judge(input({ scanned: 2 }));
  expect(v.state).toBe("inconclusive");
});

test("glob 条目：不进取数，且判「没结论」而不是「这条豁免已经不需要」", () => {
  /* 展开 glob 的那一步没验过，所以不放进承重位：把它当成「这份没命中」就会产出一条
   * 假的陈旧豁免，而它的真意是「本判据认不了这一条」。 */
  const v = judge(
    input({
      entries: ["a.cjs", "tests/helpers/**/*.ts"],
      violating: ["a.cjs"],
      scanned: 1,
    }),
  );
  expect(v.state).toBe("inconclusive");
  expect(v.unresolvable).toEqual(["tests/helpers/**/*.ts"]);
  expect(isGlobEntry("a.cjs")).toBe(false);
  expect(isGlobEntry("tests/helpers/**/*.ts")).toBe(true);
});

test("台账为空要分两种：规则从没出现过 = 无事可判（绿）；出现过但认不出块 = 没结论", () => {
  /* 这一格是本仓「读出 0 条」那一族的正解形状：同一个空集合，成因不同就必须给不同退出码。
   * 全判成绿 ⇒ 有人把那块改成规则级关停（`files` 没了）之后，本判据永远绿而台账确实消失了；
   * 全判成红 ⇒ 规则本来就没被文件级关过的那份配置会被无端拦住。 */
  expect(
    judge(input({ entries: [], violating: [], scanned: 0, mentionedAnywhere: false })).state,
  ).toBe("pass");
  expect(
    judge(input({ entries: [], violating: [], scanned: 0, mentionedAnywhere: true })).state,
  ).toBe("inconclusive");
});

test("readFileLevelExemptions：只认「把这条规则关掉的块」的 files，且区分不出文件级与规则级时不混", () => {
  const entries = readFileLevelExemptions(
    [
      /* 文件级台账（要收） */
      { files: ["x.cjs", "y.ts"], rules: { [RULE]: "off" } },
      /* 同一条规则被另一块开着 ⇒ 不收 */
      { files: ["z.ts"], rules: { [RULE]: "error" } },
      /* 规则级关停（没有 files）⇒ 不收，但要把「出现过」记下来 */
      { rules: { [RULE]: "off" } },
      /* 别的规则的文件级关停 ⇒ 与本判据无关 */
      { files: ["w.ts"], rules: { "no-empty": "off" } },
      /* `files` 写成单串而不是数组（扁平配置合法）⇒ 也要收 */
      { files: "single.cjs", rules: { [RULE]: ["off"] } },
    ] as Parameters<typeof readFileLevelExemptions>[0],
    RULE,
  );
  expect(entries.entries).toEqual(["x.cjs", "y.ts", "single.cjs"]);
  expect(entries.mentionedAnywhere).toBe(true);
});

test("scanViolations：命中 / 未命中 / 读不到 / 解析失败 四种形状各归各位（不靠真读盘）", () => {
  /* 取数层的注入缝让这一条能一次喂齐四种形状。特别是后两种：它们必须落进 `failed`
   * 而不是「没命中」—— 那正是本判据上线前量到的假绿来源（全部抛错却打「命中 0 处」）。 */
  const CONTENT: Record<string, string> = {
    "x.cjs": "const re = /CONTROL/;\n",
    "y.ts": "export const plain = 1;\n",
    "z.mjs": "throwOnParse(\n",
  };
  const { violating, failed, scanned } = scanViolations({
    files: ["x.cjs", "y.ts", "missing.cjs", "z.mjs"],
    ruleId: RULE,
    root: REAL_ROOT,
    readFile: (abs: string) => {
      const key = Object.keys(CONTENT).find((k) => abs.endsWith(k));
      if (!key) {
        throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      }
      const text = CONTENT[key];
      /* 不是走过场：`noUncheckedIndexedAccess` 下按算出来的键取就是 `string | undefined`，
       * 而这里 undefined 只可能是夹具漏配 —— 那要炸得看得见，不能被 `?? ""` 折成
       * 「这份文件是空的、所以没命中」。 */
      if (text === undefined) {
        throw new Error(`夹具没配到这一份：${key}`);
      }
      return text;
    },
    makeLinter: () => ({
      /* 这里把真规则本体换成一个按内容认形状的最小 linter：命中 = 源码里有 CONTROL，
       * 解析失败 = 源码里有 throwOnParse。规则语义本身不由这条用例判（那由 bin 那条判）。 */
      verify: (code: string) =>
        code.includes("throwOnParse")
          ? [{ ruleId: null, fatal: true, message: "Parsing error" }]
          : [{ ruleId: code.includes("CONTROL") ? RULE : null }],
    }),
  });
  expect(violating).toEqual(["x.cjs"]);
  expect(scanned).toBe(2);
  expect(failed).toHaveLength(2);
  expect(failed.map((f) => f.file).sort()).toEqual(["missing.cjs", "z.mjs"]);
  expect(String(failed.find((f) => f.file === "missing.cjs")?.why)).toContain("ENOENT");
});

test(
  "bin 形态：真配置上这份判据跑得起来、退 0，且**读数自证**（台账非空、判过的份数等于台账条数）",
  CLI_BUDGET,
  () => {
    /* 这一条是这份新件的唯一端到端执行者：它同时证明
     *   ① 真 `eslint.config.js` 上那块台账**认得出来**（不是夹具里的形状），
     *   ② 取数**真的跑了每一份**（`判过 N 份` 与 `台账 N 条` 同数 ⇒ 没有静默漏件），
     *   ③ 台账**非空**（读出 0 条 ⇒ 本条红，而不是「绿得毫无意义」），
     *   ④ 退出码形状（今天台账与事实相符 ⇒ 0）。
     * 断言写成「三个数自相一致」而不是「等于 13」：台账是会被正当修改的（摘掉一条真陈旧的
     * 豁免后是 12），把 13 钉死就是在给下一个动台账的人埋一条假红。 */
    const out = execFileSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      cwd: REAL_ROOT,
      maxBuffer: 1 << 26,
    });
    const m = /台账 (\d+) 条 · 判过 (\d+) 份 · 真违例 (\d+) 份/.exec(out);
    /* 用守卫而不是 `!`：拿不到那一行就是要失败，而且失败话里必须带上原文 ——
     * 「读数行没打出来」既可能是判据改了话术，也可能是它压根没跑起来，两种都要看得见。 */
    if (!m) {
      throw new Error(`读数行没打出来：\n${out}`);
    }
    const [entries, scanned, violating] = m.slice(1).map(Number);
    expect(entries).toBeGreaterThan(0);
    expect(scanned).toBe(entries);
    expect(violating).toBe(entries);
  },
);
