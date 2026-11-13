/**
 * 门禁脚本里写成**字符串字面量**的仓库路径必须真实存在。动因：`check-theme-colors.cjs` 一条豁免指向不存在
 * 的 `src/components/studio/canvas/WorkflowCanvasDecorations.tsx` —— **指错不报错**，只是从此不再豁免任何东西。
 * 口径：只查字符串字面量（注释里旧路径是有意叙述历史）；扫描面自动发现 `check-*.cjs`；产物层按 `PRODUCT_ROOT_LITERALS` 精确配对。
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
  /["'`](?<path>(?:src|tests|scripts|docs|tools|e2e)\/[A-Za-z0-9_./-]*\.(?:ts|tsx|mts|js|jsx|mjs|cjs|json|css|md|py|ps1|rs))["'`]/g;

/**
 * 剥掉块注释与行注释。行注释用「前面不是 `:`/字母」的判据避开 `https://` 这类 URL 里的 `//`；
 * 字符串里的 `#` 与 URL 不参与本判据，所以宁可少剥也不误剥代码。
 */
export function stripComments(text: string): string {
  return text
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/(?<lead>^|[^:\\])\/\/[^\n]*/g, "$<lead>");
}

/** 一份源码里作为字符串字面量出现的仓库路径（已去重）。 */
export function quotedRepoPaths(text: string): Array<string> {
  const out = new Set<string>();
  for (const m of stripComments(text).matchAll(PATH_RE)) {
    const p = m.groups?.path;
    if (p !== undefined && p !== "") {
      out.add(p);
    }
  }
  return [...out];
}

/**
 * 一份门禁脚本**连同它同目录的相对依赖**（`require("./x.cjs")` 递归闭包）。扫描面不能只是 `check-*.cjs`
 * 那层：基础设施层按 R5 拆过（ISSUE #1811 第四刀，PR #1823），拆出去的正是指令路径字面量所在的常量/清单表；
 * 只扫主文件时实测路径字面量从 111 条掉到 40 条，掉的 71 条**没有红**，覆盖面静默缩六成半。
 */
function gateScripts(): Array<string> {
  const roots = readdirSync(SCRIPTS_DIR)
    .filter((f) => /^check-.*\.cjs$/.test(f))
    .map((f) => `scripts/${f}`);
  const seen = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    const src = sourceOf(rel);
    /* 只认同目录相对形态：仓里判据之间的引用全是这一种（口径同
     * `tests/helpers/gate-repo.ts` 的 `copyGateDeps`）。 */
    for (const m of src.matchAll(/require\(\s*"\.\/(?<name>[\w.-]+\.cjs)"\s*\)/g)) {
      const dep = `scripts/${m.groups?.name ?? ""}`;
      if (seen.has(dep) || !existsSync(path.join(ROOT, dep))) {
        continue;
      }
      seen.add(dep);
      queue.push(dep);
    }
  }
  return [...seen].sort();
}

/**
 * 「**产物根**相对」的字面量：仓库里本来没有，是构建期写进产物的。撞上的这一对来自执行器宿主运行时图与构建
 * 清单（登记方 `check-standalone-contents.cjs` 的 `REQUIRED_HOST_FILES`，生成方 `build-executor-host.mjs`）。
 * 按「登记脚本 + 路径 + 生成脚本」三元组精确配对：放宽成「`scripts/` 开头一律放行」会连「抄错的豁免路径」一起放走。
 */
const PRODUCT_ROOT_LITERALS: Array<{
  /** 构建期生成它的脚本：登记理由由它承担 */
  generatedBy: string;
  /** 字面量本身（相对仓库根，但语义上相对产物根） */
  path: string;
  /** 把这条路径当字面量写下来的那份门禁脚本 */
  script: string;
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
 * **「读得到就用、读不到就站下」的条件路径**：仓库里查不到**不是缺陷**（台账只在有站点时才需要）。
 * 表现在是**空的**且空是唯一正确状态：原两条 `LEDGER` 已按 §11.21 / §11.22 落库，留着会让 `existsSync` 第三问红。
 * 合法性由「机制还活着」担保：每条复算 ① 字面量还在 ② 脚本对「路径不存在」站得下（退出码 0）③ 仓库仍无此文件。
 */
const CONDITIONAL_PATHS: Array<{
  /** 字面量本身（相对仓库根） */
  path: string;
  /** 为什么「不存在」是它的正常状态之一 */
  reason: string;
  /** 把这条路径当字面量写下来的那份门禁脚本 */
  script: string;
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
 * 在仓库根跑一份门禁脚本，返回退出码。跑的是**真脚本、真仓库**（不是夹具）：要证的正是「它在仓库当前这个
 * 状态下站得下」。起不来（脚本被删 / 起不来）按**非 0** 记 —— 让断言红，而不是让异常把真问题变「跳过」。
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
    /* 失败形状用运行时守卫取字段，不走 `as` 断言（B5 清账）。 */
    const e: { status?: unknown } = typeof error === "object" && error !== null ? error : {};
    return typeof e.status === "number" ? e.status : -1;
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
        if (isProductRootLiteral(rel, p)) {
          continue;
        }
        // 「条件路径」（台账类：零站点时本就不该存在）同样不参与 —— 它们由下面
        // 那条用例**真跑一次**反向守着，不是声明即放行
        if (isConditionalPath(rel, p)) {
          continue;
        }
        if (!existsSync(path.join(ROOT, p))) {
          dead.push(`${rel} → ${p}`);
        }
      }
    }
    /* 自证：扫描面没匹配到任何路径字面量时，上面的空清单断言是**空转**（同「永远返回空的扫描器会让断言
     * 全绿」）。门槛取 50 —— 掉下去意味着提取形态变了，不是「变干净了」。读数会随扫描面变（ISSUE #1811
     * 第四刀后从 26 份涨到 66 份），它只负责发现「扫描面塌了」，慢漏由 `gateScripts()` 的闭包展开兜。 */
    expect(seen, "一条路径字面量都没扫到：判据形态或写法变了").toBeGreaterThan(50);
    expect(
      dead,
      `这些路径被门禁当数据用（豁免项 / 比对目标 / 改法提示），但仓库里没有：\n  ${dead.join("\n  ")}\n` +
        "要么改成真存在的路径，要么删掉这条已经指不到东西的记录（留着 = 假装在守）",
    ).toEqual([]);
  });

  /**
   * 例外表自己也得是**活的**，三条都得复算：① 登记方脚本里这个字面量还在（不在了 = 空账，该删）；
   * ② 生成方脚本逐字写着这个文件名（不写了 = 产物里不会再有它）；③ 仓库里仍然**没有**这个文件。
   * 没有这条用例，例外表就是一张「加进去就没人再检查」的清单 —— 那正是本文件动因批评的形态。
   */
  it("产物根例外项还在守东西：三条登记理由都能复算", () => {
    expect(PRODUCT_ROOT_LITERALS.length).toBeGreaterThan(0);
    /* 软断言：一张例外表逐条复算 —— 过期的条目要一次全列出，
       否则「删一条、再发现下一条」（§11.18）。 */
    for (const entry of PRODUCT_ROOT_LITERALS) {
      const basename = path.posix.basename(entry.path);
      expect
        .soft(
          quotedRepoPaths(sourceOf(entry.script)),
          `例外失效：${entry.script} 里已经没有字面量 ${entry.path} —— 把这条例外从表里删掉`,
        )
        .toContain(entry.path);
      expect
        .soft(
          sourceOf(entry.generatedBy),
          `例外失效：${entry.generatedBy} 已经不再产出 ${basename} —— 登记理由不成立`,
        )
        .toContain(basename);
      expect
        .soft(
          existsSync(path.join(ROOT, entry.path)),
          `${entry.path} 已经在仓库里了：它现在归本判据正常管，该从产物根例外表里删掉`,
        )
        .toBe(false);
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
      expect
        .soft(
          quotedRepoPaths(sourceOf(entry.script)),
          `例外失效：${entry.script} 里已经没有字面量 ${entry.path} —— 把这条例外从表里删掉`,
        )
        .toContain(entry.path);
      expect
        .soft(
          exitCodeOfGate(entry.script),
          `${entry.script} 在这个仓库里没站下（台账不在本该是它的正常状态）—— ` +
            "要么它已经不是条件路径了（该从本表删掉），要么零站点那条快路径坏了",
        )
        .toBe(0);
      expect
        .soft(
          existsSync(path.join(ROOT, entry.path)),
          `${entry.path} 已经在仓库里了：它现在归本判据正常管，该从条件路径例外表里删掉`,
        )
        .toBe(false);
    }
  });

  /**
   * **条件路径例外机制还在（负对照）** —— 上面那条用例在表为空时是空转的循环。表空是当前事实，但不许让
   * 整套机制跟着消失：这里把三条判定各自反过来走一遍（拿三份真文件当假定例外项），证明它真能拦住过期条目
   * （`existsSync` 由 false 变 true 那形态）。不改表数据：要证的是「判定逻辑在」，不是「表里有东西」。
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
    const wouldPassAsConditional = (p: string) => !existsSync(path.join(ROOT, p));
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
    expect(found).toContain("src/components/studio/canvas/DefinitelyNotThere.tsx");
    expect(found, "注释里的旧路径不该进判据面（那多半是在叙述历史）").not.toContain(
      "src/lib/app-settings.ts",
    );
    expect(found.filter((p) => !existsSync(path.join(ROOT, p))).length).toBe(1);
  });
});
