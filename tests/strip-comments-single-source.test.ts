/**
 * 「拿正则断言源码形状」的用例必须先剥注释，否则会红在解释「为什么这么写」的注释上（自打自）；唯一实现是
 * `tests/helpers/strip-comments.ts`（§12.18）。仓里仍有 18 份内联副本且语义不一（ISSUE #1192），不能一把梭换
 * import；故判两件事：新文件不许再长本地副本、台账里已收敛的条目必须删除，否则台账变成没人核的清单。
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
 * 「裸的全局去行尾注释」那一型的特征串：实测会咬坏代码里的 URL（`wfParam` 直接消失 ⇒ 断言假绿；
 * helper 只去整行注释，同一行留得住）。光凭这个子串会误伤另两份带 `(^` 护栏的写法，所以判据是
 * 「有这个形状 **且** 没有任何护栏」—— 第一版只查子串，误报一片后精确化判据而非放宽基线。
 */
const NAIVE_MARK = String.raw`\/\/` + String.raw`[^\n]*/g`;
/** 护栏的特征串（`(^` 开头的锚/排除组）。同样拆开写，避免本文件自匹配。 */
const GUARD_MARK = "(" + "^";
/** 同一护栏的命名组形态（`(?<lead>^|...)`）：B4 清账把匿名捕获组改成命名组后，
 *  判据不能因为「括号后跟的是组名而不是 `^`」就把护栏当成裸剥注释。 */
const GUARD_NAMED_RE = new RegExp(String.raw`\(\?<[\w$]+>\^`);

/**
 * 台账：现存本地副本，分层列出以便「谁来收哪一份」可判。
 * `scripts/check-barrel-heavy-deps.cjs`（ISSUE #1777）归这一组：它跑在 pre-commit 的 D 组，
 * 纯 Node 的 `.cjs` 加载不到 `tests/helpers/strip-comments.ts`；语义与 helper 等价（只去整块/整行）。
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

/**
 * 「形状面」特征串：块注释剥除正则的尾巴，是**内联链式副本**的共同指纹（名字面看不见它；
 * ISSUE #2969 立案：13 份链式副本在名字台账之外，其中一份还是无锚的 NAIVE 形状，两根串都躲过）。
 * 拆成两段拼接是因为本文件自己就是源码，原样写着的被搜串会自匹配。
 */
const SHAPE_MARK = String.raw`[\s\S]*?` + String.raw`\*\/`;

/**
 * 形状台账：带内联剥注释、但**不打算**换成共享件的副本（语义确实不同才登记）。
 * 本轮已把能换的全部换成 `./helpers/strip-comments`（#2969），故为空 ——
 * 但它就是「面外长出新副本」的落点：新增一份必须先在这里登记并写清为什么不能换。
 */
const SHAPE_LEDGER: Array<string> = [];

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
    if (statSync(abs, { throwIfNoEntry: false })?.isDirectory() === true) {
      walk(abs);
    }
  }
  return out.sort();
}

/** 本文件自己：扫描面里排除，免得「写着特征串的判据」把自己算成副本。 */
const SELF = "tests/strip-comments-single-source.test.ts";

/** 排除 helper 与判据本人之后，仍然带着本地定义的文件。 */
const definedIn = sourceFiles()
  .filter((rel) => rel !== CANONICAL && rel !== SELF)
  .filter((rel) => readFileSync(path.join(ROOT, rel), "utf8").includes(DEFINITION_MARK));

/**
 * 名字面的**补集**：带形状指纹、却没有本地定义的那一批（内联链式副本）。
 * 这就是 ISSUE #2969 之前「13 份全在台账之外」的那个面。
 */
const shapedIn = sourceFiles()
  .filter((rel) => rel !== CANONICAL && rel !== SELF)
  .filter((rel) => readFileSync(path.join(ROOT, rel), "utf8").includes(SHAPE_MARK));

/** 判决面 = 名字 ∪ 形状（去重）。NAIVE 那一型必须在这个面上扫，否则双漏复现。 */
const inlineFace = [...new Set([...definedIn, ...shapedIn])].sort();

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

  it("形状面：块注释剥除正则的内联副本同样只许出现在台账里（ISSUE #2969）", () => {
    /* 先证「这根串没写坏」：台账里至少有一份确实带这个指纹。形状串一失效，
     * 下面那条 not.toEqual([]) 的判决就成了恒真空转。 */
    const withShape = LEDGER.filter((rel) =>
      readFileSync(path.join(ROOT, rel), "utf8").includes(SHAPE_MARK),
    );
    expect(
      withShape.length,
      "形状串已经点不到任何一份现存副本 —— 它失效了，「面外长出新副本」这一格等于没判",
    ).toBeGreaterThan(0);

    const unregistered = shapedIn.filter(
      (rel) => !LEDGER.includes(rel) && !SHAPE_LEDGER.includes(rel),
    );
    expect(
      unregistered,
      `名字面之外又长出 ${unregistered.length} 份内联剥注释：${unregistered.join("、")}。` +
        "链式副本不写 `function stripComments(`，名字台账看不见它 —— 这正是 #2969 的漏洞。" +
        "改用 ./helpers/strip-comments；语义确实不同才登记进 SHAPE_LEDGER 并写清理由。",
    ).toEqual([]);

    /* 反向：登记了但已经换走/删掉的，要从 SHAPE_LEDGER 里摘掉（表要能记账）。 */
    const staleShape = SHAPE_LEDGER.filter((rel) => !shapedIn.includes(rel));
    expect(
      staleShape,
      `SHAPE_LEDGER 里已经不存在这类副本的 ${staleShape.length} 份：${staleShape.join("、")}`,
    ).toEqual([]);
  });

  it("「裸的全局去行尾注释」那一型不许多处扩散（实测会咬坏字符串里的 URL ⇒ 判据假绿）", () => {
    /* 扫**判决面**（名字 ∪ 形状），不再只扫名字 —— #2969 立案里那份 NAIVE
     *（`tests/helpers/quality-gate-gates.ts`）正是「两根串都点不到」的双漏。 */
    const naive = inlineFace.filter((rel) => {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      return text.includes(NAIVE_MARK) && !text.includes(GUARD_MARK) && !GUARD_NAMED_RE.test(text);
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
   * ISSUE #2925 的两种失效形状各钉一格：甲让**真代码**从判据眼前消失（`not.toMatch` 恒真 = 假绿），
   * 乙让**真注释**留下来被当代码判（反向断言红在文档上）。旧实现中甲（`/* … *\/` 那段不跟引号状态），
   * 修甲的中间版本中乙（正则里的落单 `'` 把字符串状态传染到后面几十行）。
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
   * 同一格钉在**真对象**上（夹具只证机制）：`standalone-private-inputs.mjs` 有 9 份用例读它，
   * `dev-launcher.mjs` / `build-desktop.mjs` 是「起进程不经 shell 层」那族的判点。取法与 #2925
   * 探针同源：只数本身不含 `/*`、`//`、也不是 `*` 续行却消失的行 —— 只可能被**别人的**注释吃掉。
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
