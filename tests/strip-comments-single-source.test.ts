/**
 * 「拿正则断言源码形状」的门禁用例都需要先去注释，否则会红在一行解释「为什么要这么写」的
 * 注释上（自打自）。这件事的**唯一一份**实现是 `tests/helpers/strip-comments.ts`（§12.18）。
 *
 * 但截至本用例落地，仓里仍有 18 份各自内联的副本（ISSUE #1192 记着它们 —— 那条账原本只记了
 * 3 份，长成 18 份是因为这件事没有机器兜底，本用例就是来补那个兜底的）。它们**语义并不都一样**：
 * 有的只去整行注释（与 helper 等价），有的连行尾注释一起去，还有一份带 HTML 注释开关 ——
 * 所以不能一把梭换成 import（换错方向会让对应判据看到不一样的东西）。
 *
 * 这条判据只做两件事，都是零行为变化的：
 *  ① **不许再长**：新文件里出现本地副本 = 红。存量由各线自己确认后再从台账里删（见 #1192）。
 *  ② **收敛了就要收紧台账**：台账里某份已经没有本地定义了 = 红。不然这张表会变成又一份
 *     「写着但没人核」的清单 —— 那正是本仓反复吃过的那类亏。
 *
 * 外加钉住一条实测出来的缺陷形状（NAIVE 那一型，见下面注释），不改变任何判据，
 * 只是让「再多一处」当场变红。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./helpers/strip-comments";

const ROOT = path.resolve(__dirname, "..");

/** 扫描范围：只有这三层里有人在写「先剥注释再正则」的门禁。 */
const LAYERS = ["src", "tests", "scripts"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "temp",
  "log",
  "public",
  "out",
]);
const SOURCE_EXT = /\.(ts|tsx|cjs|mjs)$/;

/** 唯一实现所在，它出现这个名字是允许的。 */
const CANONICAL = "tests/helpers/strip-comments.ts";

/* 下面两个匹配串都用拼接写出来：本文件自己就是一段源码，
 * 任何「原样写着的被搜串」都会让它把自己算成命中（这条判据的第一个失效模式就是自匹配）。 */
const DEFINITION_MARK = "func" + "tion stripComments(";
/**
 * 「裸的全局去行尾注释」那一型的特征串。实测它会咬坏代码里的 URL：
 * 对 `const url = "http://a"; wfParam(); // 收尾` 这样一行，全局替换之后 `wfParam` 直接消失，
 * 于是「源码里不许出现 wfParam」那类断言**假绿**（helper 只去整行注释，同一行它留得住）。
 *
 * 光凭这个子串会误伤：另有两份也用「到行尾」的全局替换，但正则前面带了 `(^` 形态的护栏
 * （不吃 `://` 那一处），语义是安全的。所以判决是「有这个形状 **且** 没有任何护栏」——
 * 第一版我只查子串，就把那两份安全的误报进来了（误报一片时应当精确化判据，而不是放宽基线）。
 */
const NAIVE_MARK = String.raw`\/\/` + String.raw`[^\n]*/g`;
/** 护栏的特征串（`(^` 开头的锚/排除组）。同样拆开写，避免本文件自匹配。 */
const GUARD_MARK = "(" + "^";

/**
 * 台账：现存本地副本。分层列出，是为了让「谁来收哪一份」一眼可判。
 *
 * `scripts/check-barrel-heavy-deps.cjs`（ISSUE #1777）进这一组：它跑在
 * pre-commit 的 D 组，与其余 `.cjs` 判据同款 —— **不能 import TS 那份 helper**
 *（那是 `tests/helpers/strip-comments.ts`，纯 Node 的 `.cjs` 加载不到）。
 * 它的语义与 helper 等价（只去整块注释与整行 `//`），本批就按这一组登记。
 */
const LEDGER: Array<string> = [
  // —— 与 helper 等价（只去整行注释）：换成 import 是零回归的那一批 ——
  "tests/client-bundle-node-builtins.test.ts",
  "tests/core-barrel-entry-discipline.test.ts",
  "tests/cross-platform-launcher.test.ts",
  "tests/lib-server-imports.test.ts",
  "tests/repository-base-purity.test.ts",
  "tests/single-logger-channel.test.ts",
  // —— 连行尾注释一起去：换 import 会改变该判据看到的文本，要那条线自己确认 ——
  "tests/gate-hint-targets-exist.test.ts",
  "tests/test-mock-targets.test.ts",
  "tests/turbopack-tracing-excludes.test.ts",
  // —— 带 HTML 注释开关的一型 ——
  "tests/shell-self-launch.test.ts",
  // —— 纯 Node 门禁层（不能直接 import TS 那份 helper）——
  "scripts/check-barrel-heavy-deps.cjs",
  "scripts/check-circular-deps.cjs",
  "scripts/check-dead-exports.cjs",
  "scripts/check-overlay-z.cjs",
  "scripts/check-tsc-diagnostic-executors.cjs",
  "scripts/check-theme-colors.cjs",
  /* UI 基元判据的文本引擎：`stripComments` 与那份判据**同批抽取**
   *（ISSUE #1747 的分层）—— 判据脚本已挂文件长度棘轮、到点必须拆，
   *  而「剥注释」是拆得最干净的那一块（不回答「算不算违规」）。
   *  它仍是纯 Node 门禁层，不能 import TS 那份 helper。 */
  "scripts/ui-primitives-engine.cjs",
  "scripts/lib-node-only-scan.mjs",
  // —— 视图层守卫用例里的那一型（就是 NAIVE 台账点名的缺陷形状）——
  "src/components/studio/workflow-editor/fit-viewport-source-guard.test.ts",
  "src/components/studio/workflow-editor/workflow-canvas-io-isolation-guard.test.ts",
];

/** 已经点名的缺陷形状，只准减不准增。 */
const NAIVE_LEDGER: Array<string> = [
  "src/components/studio/workflow-editor/fit-viewport-source-guard.test.ts",
  "src/components/studio/workflow-editor/workflow-canvas-io-isolation-guard.test.ts",
];

function sourceFiles(): Array<string> {
  const out: Array<string> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry) && !entry.startsWith(".")) {
          walk(abs);
        }
        continue;
      }
      if (!SOURCE_EXT.test(entry)) {
        continue;
      }
      out.push(path.relative(ROOT, abs).split(path.sep).join("/"));
    }
  };
  for (const layer of LAYERS) {
    const abs = path.join(ROOT, layer);
    if (statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
      walk(abs);
    }
  }
  return out.sort();
}

/** 排除 helper 本人之后，仍然带着本地定义的文件。 */
const definedIn = sourceFiles()
  .filter((rel) => rel !== CANONICAL)
  .filter((rel) => readFileSync(path.join(ROOT, rel), "utf8").includes(DEFINITION_MARK));

describe("stripComments 的唯一实现（§12.18 复用优先）", () => {
  it("helper 本人在位，且导出 stripComments", () => {
    const src = readFileSync(path.join(ROOT, CANONICAL), "utf8");
    expect(src).toContain("export function stripComments");
  });

  it("扫到的副本数与台账一致（多一处 = 红；少一处 = 收紧台账）", () => {
    expect(
      definedIn.filter((rel) => !LEDGER.includes(rel)),
      `又多出 ${definedIn.filter((r) => !LEDGER.includes(r)).length} 份 stripComments 的本地实现：` +
        `${definedIn.filter((r) => !LEDGER.includes(r)).join("、")}。` +
        "改用 ./helpers/strip-comments（§12.18）；它不满足你的形状就**给它加一个模式**，" +
        "别再抄一份。各份语义差别见 ISSUE #1192 的分层清单。",
    ).toEqual([]);

    const gone = LEDGER.filter((rel) => !definedIn.includes(rel));
    expect(
      gone,
      `台账挂着但本地已经没有定义的 ${gone.length} 份：${gone.join("、")}。` +
        "它已经换成共享件 —— 把它从 LEDGER 里删掉（这条判据要的是「只许降」，" +
        "留着 stale 条目等于让这张表失去记账能力）。",
    ).toEqual([]);
  });

  it("「裸的全局去行尾注释」那一型不许多处扩散（实测会咬坏字符串里的 URL ⇒ 判据假绿）", () => {
    const naive = definedIn.filter((rel) => {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      return text.includes(NAIVE_MARK) && !text.includes(GUARD_MARK);
    });
    expect(
      naive.sort(),
      `出现新的「全局去行尾注释」副本：${naive.join("、")}。` +
        "它会连字符串里的 `http://…` 一起截断 —— 于是「源码里不许出现 X」这类断言，" +
        "X 只要写在那样的行里就再也匹配不到。要判行尾注释请用带 `^` 锚的整行形态" +
        "（helper 那一型），或带字符串状态机的那一型。",
    ).toEqual([...NAIVE_LEDGER].sort());
  });

  it("台账本身不自相矛盾：NAIVE 那两份必须也在总台账里", () => {
    for (const rel of NAIVE_LEDGER) {
      expect(LEDGER).toContain(rel);
    }
    // 台账不许有重复条目（重复会让「少一份就红」这条判决变得不可预期）
    expect(new Set(LEDGER).size).toBe(LEDGER.length);
  });

  /**
   * ISSUE #2925 的两种失效形状各钉一格。它们都不是"写法好不好看"的问题：
   * 甲让**真代码**从判据眼前消失（落在里面的 `not.toMatch` 恒真 = 假绿），
   * 乙让**真注释**留下来被当代码判（反向断言红在文档上）。
   * 旧实现中甲（`/* … *\/` 那段不跟引号状态），本仓修甲的中间版本中乙
   * （正则字面量里一个落单的 `'` 把字符串状态传染到后面几十行）—— 两向都要有钉子，
   * 否则下一次"修得像了"仍然没人拦。
   */
  it("字符串里的块注释起点不许吃掉真代码；正则里的落单引号不许放过真注释", () => {
    const GLOB_INPUT = [
      'const PATTERNS = ["**/*.log", "**/archive/*.md"];',
      "const keepMe = spawnSync(command, args, { shell: false });",
      "cleanup(PATTERNS);",
    ].join("\n");
    const globbed = stripComments(GLOB_INPUT);
    // glob 串里那个 `/*` 不是注释起点 ⇒ 它后面两行真代码都还在
    expect(globbed).toContain("**/*.log");
    expect(globbed).toContain("keepMe");
    expect(globbed).toContain("cleanup(PATTERNS)");

    const REGEX_INPUT = [
      "const RE = /[\"']/gm;",
      '/* 这一段是注释，里面写着 spawnSync("pnpm", {shell:true}) */',
      "const realCode = pnpmInvocation(args);",
    ].join("\n");
    // 反向自证：被禁形状**真在**原文里，否则下面那两条 not 什么都没判
    expect(REGEX_INPUT).toMatch(/shell:true/);
    const afterRegex = stripComments(REGEX_INPUT);
    expect(afterRegex).toContain("realCode");
    expect(afterRegex).not.toMatch(/shell:true/);
    expect(afterRegex).not.toContain("这一段是注释");
  });

  /**
   * 同一格钉在**真对象**上（夹具只能证明机制，证不落在这几份文件上）。
   * 名单就是判据密集的接收者：`standalone-private-inputs.mjs` 一份就有 9 份用例读它，
   * `dev-launcher.mjs` 与 `build-desktop.mjs` 是「起进程不许经 shell 层」那一族的判点。
   * 取法与 #2925 立案时的探针同一份：只数"那一行本身不含 `/*` 也不含 `//`、
   * 也不是注释续行（`*` 起头）"的消失行 —— 那种行只可能是被**别人的**注释吃掉的。
   */
  it("真文件上剥注释不许丢代码（#2925 的落点）", () => {
    const receivers = [
      "scripts/dev-launcher.mjs",
      "scripts/build-desktop.mjs",
      "scripts/standalone-private-inputs.mjs",
      "scripts/run-affected-tests.mjs",
      "scripts/affected-launch-spawn.mjs",
      "src-tauri/src/lib.rs",
      "src/instrumentation.ts",
    ];
    expect(receivers.length, "接收者名单为空 ⇒ 这一格什么都不判").toBeGreaterThan(0);
    for (const rel of receivers) {
      const raw = readFileSync(path.join(ROOT, rel), "utf8");
      const kept = new Set(
        stripComments(raw, { trailing: true })
          .split("\n")
          .map((line) => line.trim()),
      );
      const lost = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(
          (t) =>
            t !== "" &&
            !t.startsWith("*") &&
            !t.startsWith("//") &&
            !t.includes("/*") &&
            !t.includes("//") &&
            !kept.has(t),
        );
      expect(
        lost,
        `${rel}：剥完有 ${lost.length} 行真代码整行消失（#2925 那一形，反向断言会在看不见它的情况下绿）。` +
          `首行：${String(lost[0]).slice(0, 70)}`,
      ).toEqual([]);
    }
  });
});
