/**
 * pre-commit D 组里三条「接线本身」的在位判据：
 * `doc:check` 那一步（ISSUE #1371）、R5 棘轮的 `--strict` 硬闸（ISSUE #1404）
 * 与注释语言棘轮（ISSUE #1451）。
 *
 * 第三条的立案现场：`scripts/check-comment-language.cjs` 头部自称
 * 「供 `.githooks/pre-commit` 与 CI 调用」、§12.4.6 也写着它在钩子里报红，
 * 而 `grep -c comment-language .githooks/pre-commit` 一直是 0，CI 又随 ISSUE #623 删除
 * —— 一条基线为 0 的硬闸**一个执行者都没有，文档却说它在执行**。
 * 判据本身是对的（`next-code-frame` 按字节切串，中文注释会让 Rust 侧 panic），
 * 缺的只是执行者，所以这里连着「不准回到那句书面自白」一起钉。
 *
 * 为什么单独成文件、并进 `scripts/affected-tests.mjs` 的 FIXED_STRUCTURAL_TESTS：
 * 这两步的价值都是「每次提交都跑」，而改 `.githooks/**` 会让增量层**放弃收窄、
 * 只跑固定清单**（`mode: "all"`，清单长度由下面那条用例核与钩子注释一致，
 * 所以这里不抄数字）—— 把这类断言留在按路径引用的那份用例里，恰好在本该拦住的
 * 那次改动（有人把某一步摘回手动档 / 抹掉 flag / 改了计数陈述）上一条都不跑，
 * 判据存在但没有执行者，与没有等价。这里只读几份文本、不起子进程，成本可忽略。
 *
 * 为什么解析 D 组步骤而不是 `toContain(那一行)`：变异实测把那行前面加 `# ` 注掉后，
 * `toContain` 仍然命中（注释行里也含同一段字面），只有计数那条会红。
 * 「把这一步静音」正是这一族要拦的动作（同台账 F13「对编译器按下静音键」）。
 *
 * 同一格先例：`tests/shell-gate.test.ts` 的「新增门禁脚本必须同时接进 pre-commit」、
 * `tests/no-platform-ci-config.test.ts` 的「平台侧兜底在不在」。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const HOOK = join(REPO_ROOT, ".githooks", "pre-commit");
const CHECK = join(REPO_ROOT, "scripts", "check-doc-references.cjs");
const STRUCTURE = join(REPO_ROOT, "scripts", "check-file-structure.cjs");
const R5_BASELINE = join(REPO_ROOT, "scripts", ".file-size-baseline.json");

/**
 * D 组步骤 = 钩子里 `  run "<标签>" <命令>` 那些行（两空格缩进是组内 shell 的形态）。
 * 行首锚定只认真调用：`run() { … }` 的函数定义、被 `#` 注掉的行都不算。
 * @param {string} hookText
 * @returns {{label: string, cmd: string}[]}
 */
function dGroupSteps(hookText: string) {
  const re = /^ {2}run "([^"]+)" (.+)$/gm;
  return [...hookText.matchAll(re)].map((m) => ({
    label: m[1] ?? "",
    cmd: m[2] ?? "",
  }));
}

describe("doc:check 接进 pre-commit（ISSUE #1371 翻档的在位判据）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = dGroupSteps(hook);

  it("钩子 D 组真的执行这一步，且调的就是本脚本（被注释掉的行不算在场）", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-doc-references.cjs"),
    );
    expect(hit, `D 组 ${steps.length} 步里没有 doc:check`).toEqual({
      label: "文档引用与权威源一致",
      cmd: "node scripts/check-doc-references.cjs",
    });
  });

  it("脚本头不许回到「不接 pre-commit（避免过度打扰提交）」那句旧签字", () => {
    const script = readFileSync(CHECK, "utf8");
    expect(script).not.toContain("不接 pre-commit（避免过度打扰提交）");
  });

  it("钩子里那句「D(N 个判据脚本)」的 N 与实际步骤数一致（这数字没有别的判据核）", () => {
    const claimed = /D\((\d+) 个判据脚本\)/.exec(hook);
    expect(claimed, "钩子里的判据计数陈述还在吗？").not.toBeNull();
    expect(
      Number(claimed?.[1]),
      `钩子注释写 ${claimed?.[1]}，实际 ${steps.length}`,
    ).toBe(steps.length);
  });
});

/**
 * R5 基线里还剩几个超限文件 —— 读成数字而不是 `JSON.parse` 裸值，
 * 否则类型化 eslint 规则会在这一行报 `no-unsafe-*`（判据自己的红会拦下所有人的提交）。
 * @param {string} raw
 * @returns {{total: number, oversized: number}} 读不到时给 -1（用例据此报「基线形状不对」）
 */
function readR5Ledger(raw: string) {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null)
    return { total: -1, oversized: -1 };
  const rec = parsed as { total?: unknown; files?: unknown };
  return {
    total: typeof rec.total === "number" ? rec.total : -1,
    oversized:
      typeof rec.files === "object" && rec.files !== null
        ? Object.keys(rec.files).length
        : -1,
  };
}

describe("R5 棘轮的 --strict 硬闸在钩子里（ISSUE #1404）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = dGroupSteps(hook);

  it("结构那一步真的带 --strict 执行（抹掉 flag 与把整行注掉都要红）", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-file-structure.cjs"),
    );
    expect(
      hit,
      `结构那一步不在了，或标签 / flag 与预期不符（D 组共 ${steps.length} 步，` +
        "预期命令逐字带 --strict —— 这一档才是 R5 棘轮的阻断档）",
    ).toEqual({
      label: "文件结构硬规则(R1-R12，R5 棘轮硬闸)",
      cmd: "node scripts/check-file-structure.cjs --strict",
    });
  });

  it("这一步的标签与注释不许回到「R5 只提醒」那句旧签字", () => {
    expect(hook).not.toContain("R5 只提醒");
    // 那段「遗留」注释是「零执行者」的书面自白；它回来 = 有人把硬闸又摘回手动档
    expect(hook).not.toContain("--strict 判定不在这里执行");
  });

  it("升硬闸的前提还在：R5 基线的存量为 0（不为 0 就是把超限文件塞回了 master）", () => {
    const { total, oversized } = readR5Ledger(
      readFileSync(R5_BASELINE, "utf8"),
    );
    expect(
      oversized,
      "R5 基线里还有超限文件 —— 带着 --strict 的这一步会把每一个提交都拦下，" +
        "先把它拆掉再谈别的（不是去把 flag 从钩子里抹掉）",
    ).toBe(0);
    expect(total, "基线的 total 与 files 数不一致（棘轮的账记歪了）").toBe(
      oversized,
    );
  });

  it("脚本侧不许把 --strict 的执行者再写成「CI」（那份流水线已随 ISSUE #623 删除）", () => {
    const script = readFileSync(STRUCTURE, "utf8");
    expect(script).not.toContain("`--strict`(CI)");
    expect(script).not.toContain("900 行以上的文件在本仓库只增不减");
  });
});

/**
 * 注释语言棘轮接进 D 组（ISSUE #1451）。
 *
 * 为什么它不是「再抄一遍 §13.1 清单」：这一族要拦的动作恰好是「把某一步摘回手动档 /
 * 抹掉 flag」，而 §13.1 那份**权威清单自己**就漂过 5 步（见 §13.5.10）——抄一份
 * 只会更难保持正确。所以断言形状与上面两条同款：解析 D 组步骤、只认真调用。
 */
const COMMENT_LANGUAGE = join(
  REPO_ROOT,
  "scripts",
  "check-comment-language.cjs",
);

describe("注释语言棘轮在钩子里（ISSUE #1451）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = dGroupSteps(hook);

  it("钩子 D 组真的执行这一步，且调的就是本脚本（被注释掉的行不算在场）", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-comment-language.cjs"),
    );
    // 命令逐字相等，顺带钉住「只接判定档」：`--report` 恒 exit(0)（盘点档，接进来
    // 等于接了个寂寞）、`--update` 会改基线（人的动作）、`--strict`（基线未收紧即失败）
    // 在基线已是 total: 0 时属另一类动作 —— 三者都不许混进钩子。
    expect(
      hit,
      `D 组 ${steps.length} 步里没有注释语言棘轮 —— §12.4.6 写着它在钩子里报红，` +
        "而拆掉这一步之后它一个执行者都没有（平台流水线已随 ISSUE #623 删除）",
    ).toEqual({
      label: "注释语言棘轮",
      cmd: "node scripts/check-comment-language.cjs",
    });
  });

  it("脚本头不许去掉「供 .githooks/pre-commit 调用」这句承诺（它是本次事故的直接判据）", () => {
    // 反向要求：这句话**现在**是真的（钩子里有这一步）。若有人既拆掉钩子里那一步、
    // 又把这句删掉，文档与实现会一起闭嘴，而判据消失本身不会有人发现。
    const script = readFileSync(COMMENT_LANGUAGE, "utf8");
    expect(
      script,
      "头部那句「供 .githooks/pre-commit …调用」是这次事故的判据，别让它消失",
    ).toContain("供 .githooks/pre-commit");
  });
});
