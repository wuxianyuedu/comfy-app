/**
 * 门禁脚本里写成**字符串字面量**的仓库路径，必须真实存在。
 *
 * 动因（本轮真实撞到的两类，都不是假想）：
 *   · `check-theme-colors.cjs` 的色值豁免清单里有一条指向
 *     `src/components/studio/canvas/WorkflowCanvasDecorations.tsx` —— 那个路径下从来没有
 *     文件（真身在 `src/components/studio/` 下，另有一条给它的豁免）。**豁免项指错不会
 *     报错**：它只是从此不再豁免任何东西，而下一次有人把那个组件改名搬走，清单上这条
 *     依旧「看起来在守着什么」。这类静默失效和「登记的基线红路径写错」是同一种病。
 *   · `check-ui-primitives.cjs` 的改法提示里曾写着「Empty / Field 基元未装 → 去
 *     `shadcn add`」，而两个基元早就装好 —— 提示会指挥人做错事。
 *
 * 三条判据口径：
 *   1. **只看字符串字面量、剥掉注释**。注释里出现旧路径往往是**有意叙述历史**
 *      （如「自某次拆分起 `src/lib/app-settings.ts` 拆成目录」），那不是缺陷；
 *      写成字符串的路径则是要拿去比对/豁免/提示的，指错就是失效。
 *   2. **扫描面自动发现**（`scripts/check-*.cjs` 全量），不维护清单 —— 手写清单
 *      本身就是会漂的那类东西。另留一组锚点字面量，既证明「自动发现真的收到了这些
 *      脚本」，也让提交前的增量测试层在改到它们时把本文件拉进 C 组（§13.5.8 的
 *      「按路径引用」判据）。
 *   3. **命名空间要分开**：本判据问的是「**仓库**里有没有这个文件」，而产物层门禁里
 *      有一批字面量问的是「**构建产物**里有没有」。那两个命名空间会撞（实测撞上的就是
 *      执行器宿主的运行时图与构建清单），撞上的按下面 `PRODUCT_ROOT_LITERALS` 精确配对
 *      放行，**并且例外项自己也要能被复算**（见「例外项还在守东西」那条用例）——
 *      否则这张表就退化成「谁都能往里加一条」。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS_DIR = path.join(ROOT, "scripts");

/** 锚点：只用于「自动发现没漏」与增量层的显式绑定，不作为扫描面的来源。 */
const ANCHOR_SCRIPTS = [
  "scripts/check-theme-colors.cjs",
  "scripts/check-ui-primitives.cjs",
  "scripts/check-dead-exports.cjs",
  "scripts/check-file-structure.cjs",
];

const PATH_RE =
  /["'`]((?:src|tests|scripts|docs|tools|e2e)\/[A-Za-z0-9_./-]*\.(?:ts|tsx|mts|js|jsx|mjs|cjs|json|css|md|py|ps1|rs))["'`]/g;

/**
 * 剥掉块注释与行注释。
 *
 * 行注释用「前面不是 `:`/字母」的判据避开 `https://` 这类 URL 里的 `//`；
 * 字符串里的 `#` 与 URL 不参与本判据，所以宁可少剥也不误剥代码。
 */
export function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

/** 一份源码里作为字符串字面量出现的仓库路径（已去重）。 */
export function quotedRepoPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of stripComments(text).matchAll(PATH_RE)) {
    if (m[1]) out.add(m[1]);
  }
  return [...out];
}

function gateScripts() {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => /^check-.*\.cjs$/.test(f))
    .map((f) => `scripts/${f}`);
}

/**
 * 「**产物根**相对」的字面量：仓库里本来就没有这些文件，是构建脚本在构建期写进产物的。
 *
 * 实测撞上的这一对来自执行器宿主的运行时图与构建清单（登记方是产物层门禁
 * `check-standalone-contents.cjs` 的 `REQUIRED_HOST_FILES`，生成方是
 * `build-executor-host.mjs`）。**登记的代价由下面那条用例承担**，这张表不是免检名单。
 *
 * 为什么按 `登记脚本 + 路径 + 生成脚本` 三元组精确配对，而不是「以 `scripts/` 开头的
 * 一律放行」或「整份脚本豁免」：那两个都会把判据的扫描面开个洞 —— 门禁里真正会犯的错
 * 恰好就是「把要豁免的源码文件路径抄错」（本文件动因第一条那次就是这么静默失效的），
 * 而抄错的路径同样长得像产物路径。
 */
const PRODUCT_ROOT_LITERALS: Array<{
  /** 把这条路径当字面量写下来的那份门禁脚本 */
  script: string;
  /** 字面量本身（相对仓库根，但语义上相对产物根） */
  path: string;
  /** 构建期生成它的脚本：登记理由由它承担 */
  generatedBy: string;
}> = [
  {
    script: "scripts/check-standalone-contents.cjs",
    path: "scripts/executor-host.runtime.mjs",
    generatedBy: "scripts/build-executor-host.mjs",
  },
  {
    script: "scripts/check-standalone-contents.cjs",
    path: "scripts/executor-host.build.json",
    generatedBy: "scripts/build-executor-host.mjs",
  },
];

/**
 * **「读得到就用、读不到就站下」的条件路径**：仓库里查不到**不是缺陷**。
 *
 * 与上面那张产物根表不同形：产物根那份是「文件由构建期生成，仓库里本来没有」；
 * 这份是「文件是**台账 / 登记表**，只在有站点时才需要，零站点时它本就不该存在」。
 *
 * ── 这份表现在是**空的**，而空是它当前唯一正确的状态 ──────────────────────
 *
 * 它原本登记着两条：`check-annotate-consumer.cjs` / `check-task-meta-consumer.cjs`
 * 的 `LEDGER` 常量（`scripts/.annotate-consumers.json` /
 * `scripts/.task-meta-consumers.json`）—— 当时那两份台账**还不存在**，两个门禁的
 * 判定口径又明写「零站点 → 通过，本判据是纯闸门」。
 *
 * 后来台账按 §11.21 / §11.22 的固化形状**落库了**（零站点这个结论要由
 * 「台账在、只是 `consumers` 为空」担保，而不是由「文件根本没有」担保 ——
 * 后者在第一次有人挂注释时就分叉，那一侧此前没有任何执行者）。台账一旦在仓库里，
 * 这两条就不再是「条件路径」了：它们是**真文件**，该回到被上面那条判据正常管着的
 * 状态。表里留着它们，本条用例的第三问（`existsSync` 必须为 false）就会红 ——
 * 这正是本条用例存在的意义，而它就真的红过：那次改动**没有同批删这两条例外**，
 * 于是这条红在 `master` 上躺到下一次有人跑全量（平台侧 squash 合并不跑本地钩子，
 * §13.6.2 那族）。
 *
 * 空表现在是合法状态，但**合法性由「机制还活着」担保，不由「清单为空」担保** ——
 * 这就是不在本用例里写 `expect(CONDITIONAL_PATHS.length).toBeGreaterThan(0)` 的理由：
 * 那条断言会把「表空了」判成故障，而表空恰恰是当前的事实；而放宽成「空就跳过」
 * 又会把「哪天有人把这三问整段删掉」也一起放行（同 §11.21「零站点通过由
 * 『台账在』担保」那条口径，换到这里就是「零例外由『例外机制可复算』担保」）。
 * 下面那条 `条件路径例外机制还在（负对照）` 用例承担这件事。
 *
 * **登记的代价是下面那条用例真的去跑一次**：本表不算「声明即放行」，每一条都要
 * 复算三件事，缺一条红（`reason` 本身不参与判定，只给人看）：
 *   ① 登记方脚本里这个字面量还在（不在了 = 这条例外是空账，该删）；
 *   ② **该脚本在一条真仓库里对「这个路径不存在」是站得下的**（退出码 0）——
 *      这正是「它不是缺陷」的机器判据。哪天有人把零站点那条快路径改成先读台账，
 *      这条会当场红，而不是让本判据悄悄放行一个真失效；
 *   ③ 仓库里仍然**没有**这个文件（哪天它入库了，就该从本表删掉，回到被本判据
 *      正常管着的状态）。
 *
 * 为什么不做成「以 `scripts/.` 开头的一律放行」或「按 `existsSync` 邻近判断」：
 * 前者的洞开得比它拦下的东西大（`check-theme-colors.cjs` 那次静默失效的豁免项
 * 就是 `scripts/` 之外的源码路径，而这类清单里最会犯的错恰好是把路径抄错）；
 * 后者是拿源码形状当语义 —— 一行 `existsSync` 相距多远都算「条件」，而
 * `check-annotate-consumer.cjs` 里真有一处 `if (!fs.existsSync(abs)) return null;`，
 * 判据会连它旁边那条**真**该存在的路径一起放走。
 */
const CONDITIONAL_PATHS: Array<{
  /** 把这条路径当字面量写下来的那份门禁脚本 */
  script: string;
  /** 字面量本身（相对仓库根） */
  path: string;
  /** 为什么「不存在」是它的正常状态之一 */
  reason: string;
}> = [];

/** 读一份仓库内脚本的源码（读不到即返回空串，让断言去报「指不到东西」）。 */
function sourceOf(rel: string): string {
  const abs = path.join(ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : "";
}

function isProductRootLiteral(script: string, p: string): boolean {
  return PRODUCT_ROOT_LITERALS.some((e) => e.script === script && e.path === p);
}

function isConditionalPath(script: string, p: string): boolean {
  return CONDITIONAL_PATHS.some((e) => e.script === script && e.path === p);
}

/**
 * 在仓库根跑一份门禁脚本，返回退出码。
 *
 * 跑的是**真脚本、真仓库**（不是夹具）：本判据要证的正是「它在仓库当前这个状态下
 * 站得下」，而那个状态就是「台账不在」。跑不起来（脚本被删 / 起不来）按**非 0** 记 ——
 * 让断言去红，而不是让异常把一个真问题变成「跳过」。
 */
function exitCodeOfGate(rel: string): number {
  try {
    execFileSync(process.execPath, [path.join(ROOT, rel)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return 0;
  } catch (error) {
    const code = (error as { status?: number | null }).status;
    return typeof code === "number" ? code : -1;
  }
}

/** 排除「产物根」命名空间之后，某份门禁脚本里真正该存在的仓库路径字面量。 */

describe("门禁脚本里的路径字面量必须存在", () => {
  const scripts = gateScripts();

  it("扫描面自动发现，且锚点脚本都在其中", () => {
    /* 现实测 26 条；门槛取 20：门禁脚本只会增多，掉下来说明发现逻辑或
     * `check-*` 命名约定变了 —— 那时本判据的扫描面就是空的。 */
    expect(scripts.length).toBeGreaterThan(20);
    for (const anchor of ANCHOR_SCRIPTS) {
      expect(scripts, `锚点脚本没被自动发现：${anchor}`).toContain(anchor);
    }
  });

  it("全部 check-*.cjs 的路径字面量都解析得到", () => {
    const dead = [];
    let seen = 0;
    for (const rel of scripts) {
      const all = quotedRepoPaths(sourceOf(rel));
      seen += all.length;
      // 「产物根」命名空间的字面量不参与本判据（构建期才存在的文件名，仓库里查不到
      // 不是缺陷）；它们由下面那条用例反向守着，不许变成免检洞
      for (const p of all) {
        if (isProductRootLiteral(rel, p)) continue;
        // 「条件路径」（台账类：零站点时本就不该存在）同样不参与 —— 它们由下面
        // 那条用例**真跑一次**反向守着，不是声明即放行
        if (isConditionalPath(rel, p)) continue;
        if (!existsSync(path.join(ROOT, p))) dead.push(`${rel} → ${p}`);
      }
    }
    /* 自证：扫描面没匹配到任何路径字面量时，上面的空清单断言是**空转**
     * （同 `check-dead-exports` 对「清单为空」的警惕，也同本仓库那条
     * 「永远返回空的扫描器会让断言全绿」）。实测 26 个 check-*.cjs 里共
     * 111 条路径字面量，门槛取 50 —— 掉下去意味着提取形态变了，不是「变干净了」。 */
    expect(seen, "一条路径字面量都没扫到：判据形态或写法变了").toBeGreaterThan(
      50,
    );
    expect(
      dead,
      `这些路径被门禁当数据用（豁免项 / 比对目标 / 改法提示），但仓库里没有：\n  ${dead.join("\n  ")}\n` +
        "要么改成真存在的路径，要么删掉这条已经指不到东西的记录（留着 = 假装在守）",
    ).toEqual([]);
  });

  /**
   * 例外表自己也得是**活的**，三条都得复算：
   *   ① 登记方脚本里这个字面量还在（不在了 = 这条例外已经是空账，该删）；
   *   ② 生成方脚本逐字写着这个文件名（不写了 = 产物里不会再有它，登记理由失效）；
   *   ③ 仓库里仍然**没有**这个文件（哪天改成入库，就该从例外表里删掉，让它回到
   *      被本判据正常管着的状态）。
   * 没有这条用例，例外表就是一张「加进去就没人再检查」的清单 —— 而那正是本文件
   * 动因里被批评的形态。
   */
  it("产物根例外项还在守东西：三条登记理由都能复算", () => {
    expect(PRODUCT_ROOT_LITERALS.length).toBeGreaterThan(0);
    /* 软断言：一张例外表逐条复算 —— 过期的条目要一次全列出，
       否则「删一条、再发现下一条」（§11.18）。 */
    for (const entry of PRODUCT_ROOT_LITERALS) {
      const basename = path.posix.basename(entry.path);
      expect.soft(
        quotedRepoPaths(sourceOf(entry.script)),
        `例外失效：${entry.script} 里已经没有字面量 ${entry.path} —— 把这条例外从表里删掉`,
      ).toContain(entry.path);
      expect.soft(
        sourceOf(entry.generatedBy),
        `例外失效：${entry.generatedBy} 已经不再产出 ${basename} —— 登记理由不成立`,
      ).toContain(basename);
      expect.soft(
        existsSync(path.join(ROOT, entry.path)),
        `${entry.path} 已经在仓库里了：它现在归本判据正常管，该从产物根例外表里删掉`,
      ).toBe(false);
    }
  });

  /**
   * 条件路径例外表：每条都要复算三件事，**其中 ② 是真跑一次脚本** ——
   * 这是「不存在不是缺陷」的机器判据，也是这张表不是「免检名单」的原因。
   */
  it("条件路径例外项还在守东西：三条登记理由都能复算", () => {
    /* **本表当前为空，而空是合法状态** —— 所以这里刻意**不写**
       `expect(CONDITIONAL_PATHS.length).toBeGreaterThan(0)`：那条断言会把
       「表空」判成故障，而表空恰恰是事实（那两条台账已落库、回归正常管辖）。
       但也不能就此跳过 —— 那样「哪天有人把这三问整段删掉」与「表本来就是空的」
       在读数上完全一样。所以「机制还在」由下面那条负对照用例担保。 */
    /* 软断言：一张例外表逐条复算 —— 过期的条目要一次全列出，
       否则「删一条、再发现下一条」（§11.18）。 */
    for (const entry of CONDITIONAL_PATHS) {
      expect.soft(
        quotedRepoPaths(sourceOf(entry.script)),
        `例外失效：${entry.script} 里已经没有字面量 ${entry.path} —— 把这条例外从表里删掉`,
      ).toContain(entry.path);
      expect.soft(
        exitCodeOfGate(entry.script),
        `${entry.script} 在这个仓库里没站下（台账不在本该是它的正常状态）—— ` +
          "要么它已经不是条件路径了（该从本表删掉），要么零站点那条快路径坏了",
      ).toBe(0);
      expect.soft(
        existsSync(path.join(ROOT, entry.path)),
        `${entry.path} 已经在仓库里了：它现在归本判据正常管，该从条件路径例外表里删掉`,
      ).toBe(false);
    }
  });

  /**
   * **条件路径例外机制还在（负对照）** —— 上面那条用例在表为空时是个空转的循环。
   *
   * 表空是当前事实，但「空」不许让整套机制跟着消失：本用例把**三条判定各自反过来**
   * 走一遍（拿三份真文件当假定例外项），证明这套判据真的能拦住过期条目 ——
   * 而它拦的正是那两条台账曾经触发过的形态（`existsSync` 由 false 变 true）。
   *
   * 为什么不用「把表临时改成非空再跑」：那要改被测数据，代价与收益不成比例，
   * 而这里要证的是「判定逻辑在」，不是「表里有东西」。
   */
  it("条件路径例外机制还在（三条判定各有一个反向执行者）", () => {
    /* ① 登记方脚本里必须有那个字面量 —— 反过来用一份不存在的路径，
       与上面的 `toContain` 同口径（不同路径不同脚本）。 */
    expect(
      quotedRepoPaths(sourceOf("scripts/check-annotate-consumer.cjs")),
      "登记方脚本里认不出台账字面量了：招牌由这句『路径必须被真读』撑着",
    ).toContain("scripts/.annotate-consumers.json");

    /* ② 判定②问的是「脚本对『路径不存在』站得下吗」。本仓库现在站得下 ——
       用的是真脚本、真仓库（同上面那几个 `exitCodeOfGate` 调用）。 */
    expect(
      exitCodeOfGate("scripts/check-annotate-consumer.cjs"),
      "零站点那条快路径坏了：台账在、脚本仍须退 0（条件路径的登记理由已不成立）",
    ).toBe(0);

    /* ③ 判定③是这套机制里唯一会**随现实漂**的一问：`existsSync` 必须为 false。
       反向执行者 = 拿一份**真存在**的路径走同一条判定，必须判成「该从表里删掉」
       （台账落库那次，这一问就是这样红的 —— 那两条例外当时没被同批删掉）。 */
    const wouldPassAsConditional = (p: string) =>
      !existsSync(path.join(ROOT, p));
    expect(
      wouldPassAsConditional("scripts/check-annotate-consumer.cjs"),
      "真存在的路径被判成『条件路径』了：这一问再也不会拦住过期例外",
    ).toBe(false);
    expect(
      wouldPassAsConditional("scripts/.definitely-absent-probe.json"),
      "不存在的路径判不成『条件路径』了：机制整个失效",
    ).toBe(true);
  });

  it("假路径判为不存在、真路径判为存在（上面那条不是空转）", () => {
    const src = [
      'const ok = "scripts/check-ui-primitives.cjs";',
      'const gone = "src/components/studio/canvas/DefinitelyNotThere.tsx";',
      "// 注释里的历史路径不算：src/lib/app-settings.ts",
      'const url = "https://example.com/src/not/a/path.ts";',
    ].join("\n");
    const found = quotedRepoPaths(src);
    expect(found).toContain("scripts/check-ui-primitives.cjs");
    expect(found).toContain(
      "src/components/studio/canvas/DefinitelyNotThere.tsx",
    );
    expect(
      found,
      "注释里的旧路径不该进判据面（那多半是在叙述历史）",
    ).not.toContain("src/lib/app-settings.ts");
    expect(found.filter((p) => !existsSync(path.join(ROOT, p))).length).toBe(1);
  });
});
