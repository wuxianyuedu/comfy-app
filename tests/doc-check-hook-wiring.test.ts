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
import { existsSync, readFileSync } from "node:fs";
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

/** §13.1「本地提交前必须通过」代码块里的命令（`✅ <命令>  # 说明` 的那部分）。 */
const GATE_CHECKLIST_DOC = join(
  REPO_ROOT,
  "docs",
  "standards",
  "13-提交与-code-review.md",
);

/**
 * 读 §13.1 清单里的命令集合。marker 那句写在围栏**里面**，所以取 marker 之后遇到的
 * 第一个 ``` 就是这份清单的收尾（与 `check-doc-references.cjs` 同一份解析，不写第二份）。
 * @returns {Set<string>}
 */
function readChecklistCommands() {
  const text = readFileSync(GATE_CHECKLIST_DOC, "utf8");
  const start = text.indexOf("本地提交前必须通过");
  if (start < 0) return new Set();
  const rest = text.slice(start);
  const close = rest.indexOf("```");
  if (close < 0) return new Set();
  return new Set(
    rest
      .slice(0, close)
      .split("\n")
      .filter((l) => l.startsWith("✅ "))
      .map((l) => (l.slice(2).split(/ +# /)[0] ?? "").replace(/\s+/g, " ").trim()),
  );
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

/**
 * API 文档生成物与源同步接进 D 组（ISSUE #1329 收尾）。
 *
 * 这条与前三条同族但**多一个必须钉住的东西**：它带 `--staged`。这一步的重生成实测
 * 31s，无条件挂上会给每个前端提交加那 31s（然后所有人开始 `--no-verify`，判据归零）。
 * 所以「条件触发」不是优化、是这一步能存在的前提 —— 抹掉 `--staged` 这行在本文件里
 * 与「删掉整步」等价，而同族里没有别的判据会看见这个差异。
 */
const DOCS_API = join(REPO_ROOT, "scripts", "check-docs-api.cjs");
/** 生成物目录（提交进 git，判据对象是它）。 */
const DOCS_API_OUT = join(REPO_ROOT, "docs", "api");

describe("API 文档生成物与源同步在钩子里（ISSUE #1329 收尾）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = dGroupSteps(hook);

  it("钩子 D 组真的执行这一步，且带 --staged 条件触发", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-docs-api.cjs"),
    );
    expect(
      hit,
      `D 组 ${steps.length} 步里没有 docs-api 同步 —— 那 docs/api/** 又回到` +
        "「进 git + 零判据」的过期面（ISSUE #1329 收尾翻出的真残留）",
    ).toEqual({
      label: "API 文档生成物与源同步",
      cmd: "node scripts/check-docs-api.cjs --staged",
    });
  });

  it("生成物仍然提交进 git（判据对象没被 .gitignore 摘掉）", () => {
    // 判据的整个前提是「产物在仓库里」。若有人把它退回忽略态，这一步会找不到目录
    // 而报「不存在」—— 那条报错读起来像配置问题，不像「你把判据对象搬走了」。
    expect(
      existsSync(DOCS_API_OUT),
      `docs/api/ 不在仓库里了 —— 本判据的对象是提交进 git 的生成物；` +
        "要么把它加回来，要么连同这一步一起删（不要留下一个指向空气的判据）",
    ).toBe(true);
    const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(ignore).not.toContain("docs/api");
  });

  it("脚本头承诺「供 .githooks/pre-commit 调用」，与钩子里的在场一致", () => {
    const script = readFileSync(DOCS_API, "utf8");
    expect(script).toContain("供 .githooks/pre-commit");
  });
});

/**
 * 桌面壳门禁接进 D 组（ISSUE #1597）。
 *
 * 立案现场：`shell-gate.mjs` 在钩子里**确实**有一步，但那一格「专守它」的判据没有 ——
 * `tests/shell-gate.test.ts` 只有 `expect(hook).toContain("node scripts/shell-gate.mjs")`，
 * 而 `toContain` 对**注释行**同样命中（同一段字面在注释里也出现）。§13.1 清单与钩子
 * 的双向对账（`scripts/check-doc-references.cjs`）也拦不住：它是「钩子 ⇄ 清单」两份
 * 手抄的互核，把两份**同时**抹掉（顺手把 `D(N)` 计数一起改小）就两边一致、全绿。
 *
 * 于是「把这步摘回手动档」这个动作会静默通过。本条与上面三条同款：解析 D 组步骤、
 * 只认真调用 —— 上面那几条都只钉自己那一步，`shell-gate` 是同一个洞里的第四格。
 *
 * 为什么它值一条判据：这一步是 AGENTS 硬规则 5（改了壳必须重编）的**唯一执行者**，
 * 也是 `src-tauri/src/**` 里那批 `#[test]` 全仓唯一的执行者；静音它 = 回归「判据在
 * 文档里、没人跑」。
 */
const SHELL_GATE = join(REPO_ROOT, "scripts", "shell-gate.mjs");

describe("桌面壳门禁接进 pre-commit（ISSUE #1597）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = dGroupSteps(hook);

  it("钩子 D 组真的执行这一步，且调的就是本脚本（被注释掉的行不算在场）", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/shell-gate.mjs"),
    );
    expect(
      hit,
      `D 组 ${steps.length} 步里没有桌面壳门禁 —— AGENTS 硬规则 5「改了壳必须重编」` +
        "与壳里那批 #[test] 都没有别的执行者",
    ).toEqual({
      label: "桌面壳（改了 src-tauri 才跑）",
      cmd: "node scripts/shell-gate.mjs",
    });
  });

  it("§13.1 清单里也有它（对账的两份手抄不构成执行者，这里显式钉一份）", () => {
    // 判据是「清单里有没有这条命令」本身，不是「清单与钩子一致」——后者两份一起抹
    // 掉就一致了（这正是 check-doc-references.cjs 那条双向对账的边界）。
    const checklist = readChecklistCommands();
    expect(
      checklist.has("node scripts/shell-gate.mjs"),
      "§13.1「本地提交前必须通过」清单里没有桌面壳门禁 —— 照清单手跑的人会以为它不存在",
    ).toBe(true);
  });

  it("脚本头那句「由 .githooks/pre-commit 的 D 组调用」是本次事故的判据，别让它消失", () => {
    // 反向要求：这句话**现在**是真的（钩子里有这一步）。若有人既拆掉钩子里那一步、
    // 又把这句删掉，文档与实现会一起闭嘴，而判据消失本身不会有人发现。
    const script = readFileSync(SHELL_GATE, "utf8");
    expect(
      script,
      "头部那句「由 `.githooks/pre-commit` 的 D 组调用」是这次事故的判据，别让它消失",
    ).toContain("由 `.githooks/pre-commit` 的 D 组调用");
  });
});

/**
 * 两步全库扫描的「输入面跳过」接进 D 组（ISSUE #1747）。
 *
 * 立案现场：pre-commit 的 D 组实测 56 步、热跑约 18.9s，而其中**两步就占 34%**
 * （`check-ui-primitives.cjs` 3.6s、`check-format.cjs` 2.9s）—— 两者都是全库扫描，
 * 而扫描面实际只是全库的一个子集（前者五条根全在 `src/` 下；后者由 `GLOB_RES` 剔掉
 * `IGNORE_GLOBS` 之后只剩 `src/**` 与 `.storybook/**`）。于是「只加 changelog 碎片 /
 * 只改文档 / 只动 `scripts/` 或 `tests/`」这一大类高频提交在这两步上白付 6.5s。
 *
 * 同族里 **`--staged` 就是这一步能存在的前提**（与上面 docs-api 那条同一口径）：
 * 抹掉 flag 在本文件里与「让全库扫描回到无条件执行」等价，而**没有任何别的判据**
 * 会看见这个差异 —— 它只会让每次提交慢一点，慢不会让任何人报错。
 *
 * 这两条与 docs-api 那条一样，只读几份文本、不起子进程。
 */
const FORMAT_GATE = join(REPO_ROOT, "scripts", "check-format.cjs");
const UI_PRIMITIVES = join(REPO_ROOT, "scripts", "check-ui-primitives.cjs");

describe("全库扫描的输入面跳过接进 D 组（ISSUE #1747）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = dGroupSteps(hook);

  it("prettier 格式棘轮在钩子里带 --staged 条件触发", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-format.cjs"),
    );
    expect(
      hit,
      `D 组 ${steps.length} 步里没有 prettier 格式棘轮，或它丢了 --staged —— ` +
        "后者会让全库扫描回到无条件执行（每次提交白付 2.9s 热缓存 / 17.6s 冷缓存）",
    ).toEqual({
      label: "prettier 格式棘轮",
      cmd: "node scripts/check-format.cjs --staged",
    });
  });

  it("UI 基元复用棘轮在钩子里带 --staged 条件触发", () => {
    const hit = steps.find((s) =>
      s.cmd.includes("scripts/check-ui-primitives.cjs"),
    );
    expect(
      hit,
      `D 组 ${steps.length} 步里没有 UI 基元复用棘轮，或它丢了 --staged —— ` +
        "后者会让全库扫描回到无条件执行（每次提交白付 3.6s，D 组单项最贵）",
    ).toEqual({
      label: "UI 基元复用棘轮",
      cmd: "node scripts/check-ui-primitives.cjs --staged",
    });
  });

  it("两个脚本都实现了 --staged 这一档（不是只在钩子里写了个 flag）", () => {
    // 钩子里的 flag 与脚本里的实现是两件事：只写 flag 而脚本不认它，会被解析成
    // 未知参数（多数脚本忽略）⇒ 条件触发**静默失效**，退回无条件全库扫描。
    const cases = [
      ["check-format.cjs", FORMAT_GATE],
      ["check-ui-primitives.cjs", UI_PRIMITIVES],
    ] as const;
    for (const [name, file] of cases) {
      const script = readFileSync(file, "utf8");
      expect(
        script.includes('ARGS.has("--staged")'),
        `${name} 没有 --staged 这一档 —— 钩子里那个 flag 会变成静默失效的条件触发`,
      ).toBe(true);
    }
  });

  it("判据面由扫描配置现算，没有第二份手抄的目录清单", () => {
    // 这是本步能「不漂移」的前提：判据面必须从既有配置（`IGNORE_GLOBS` / `SCAN_DIRS`）
    // 现算，抄一份就会漂 —— 抄的那份多收一个目录，那类文件的违规从此没人查，
    // 且形态是静默的（§12.12 / §12.18）。
    const fmt = readFileSync(FORMAT_GATE, "utf8");
    expect(
      fmt.includes("GLOB_RES.some") && fmt.includes("IGNORE_RES.some"),
      "check-format.cjs 的扫描面判定没有由 GLOBS / IGNORE_GLOBS 现算 —— " +
        "手抄一份目录清单就会与 IGNORE_GLOBS 漂移",
    ).toBe(true);
    const ui = readFileSync(UI_PRIMITIVES, "utf8");
    expect(
      ui.includes("skipUnlessStagedTouches({ roots: SCAN_DIRS"),
      "check-ui-primitives.cjs 的扫描面判定没有把 SCAN_DIRS 交给共享件 —— " +
        "手抄一份目录清单就会与 SCAN_DIRS 漂移",
    ).toBe(true);
  });
});

/**
 * 第二梯队全库扫描的「输入面跳过」接进 D 组（ISSUE #1747 续）。
 *
 * 立案现场：D 组里除两步最贵的（`check-ui-primitives` / `check-format`）之外，
 * 还有第二梯队 14 步各自「扫全库的一个子集」，单项 0.27–1.85s，合计 ≈8.5s
 * （实测热缓存 8 核）。它们的扫描面全是**固定前缀**（`src/`、`src/lib`、
 * `src/components`+`src/app`、`src-tauri/src` ……），于是「只加 changelog 碎片 /
 * 只改文档 / 只动 `scripts/` `tests/`」这一大类提交（实测占最近 60 次提交的 57%）
 * 在这些步上白付 —— 与 #1798 那两步同源，同一套口径（§13.5.8.2）。
 *
 * 为什么这条判据必须存在：抹掉一个 `--staged` 在本文件里与「让那一步回到无条件
 * 全库扫描」等价，而**没有任何别的判据**会看见这个差异 —— 它只会让每次提交慢一点，
 * 慢不会让任何人报错。同族先例是 #1798 那两条，本条把第二梯队 14 步一次钉住。
 *
 * 三条都只读几份文本，不起子进程。
 */
const SECOND_TIER: ReadonlyArray<readonly [string, string, string]> = [
  // [标签, 脚本名, 期望命令里带 --staged 的形态]
  ["React 函数式 updater 纯净性", "check-react-updater-purity.cjs", "node scripts/check-react-updater-purity.cjs --staged"],
  ["标题行让位硬规则", "check-title-bar-clearance.cjs", "node scripts/check-title-bar-clearance.cjs --staged"],
  ["import 别名统一(~ 前缀)", "check-import-alias.cjs", "node scripts/check-import-alias.cjs --staged"],
  ["内联样式注入", "check-inline-style.cjs", "node scripts/check-inline-style.cjs --staged"],
  ["跨文件重复块", "check-code-duplication.cjs", "node scripts/check-code-duplication.cjs --staged"],
  ["函数长度(硬闸，>400 行即阻断)", "check-function-length.cjs", "node scripts/check-function-length.cjs --staged"],
  ["模块循环依赖(硬闸)", "check-circular-deps.cjs", "node scripts/check-circular-deps.cjs --staged"],
  ["地基层零消费导出(硬闸)", "check-dead-exports.cjs", "node scripts/check-dead-exports.cjs --staged"],
  ["浮层层级刻度棘轮", "check-overlay-z.cjs", "node scripts/check-overlay-z.cjs --staged"],
  ["src 非空断言棘轮", "check-non-null-assertions.cjs", "node scripts/check-non-null-assertions.cjs --staged"],
  ["src/lib void 悬空 Promise 棘轮", "check-void-floats.cjs", "node scripts/check-void-floats.cjs --staged"],
  ["TS 重复属性判定", "check-ts-duplicate-keys.cjs", "node scripts/check-ts-duplicate-keys.cjs --staged"],
  ["FormField 标签⇄控件接线（§16.2.4.26）", "check-form-field-wiring.cjs", "node scripts/check-form-field-wiring.cjs --staged"],
  ["非原生元素点击的键等价物（§6.11）", "check-click-keyboard.cjs", "node scripts/check-click-keyboard.cjs --staged"],
];

describe("第二梯队全库扫描的输入面跳过接进 D 组（ISSUE #1747 续）", () => {
  const hook = readFileSync(HOOK, "utf8");
  const steps = dGroupSteps(hook);

  it.for(SECOND_TIER)("%s 在钩子里带 --staged 条件触发", ([label, , expected]) => {
    const hit = steps.find((s) => s.label === label);
    expect(
      hit,
      `D 组 ${steps.length} 步里没有「${label}」—— 判据从门禁链里被摘掉了`,
    ).toBeDefined();
    expect(
      hit?.cmd,
      `「${label}」丢了 --staged —— 全库扫描会回到无条件执行：这一大类高频提交` +
        "（只加 changelog 碎片 / 只改文档 / 只动 scripts 或 tests）在它上面白付",
    ).toBe(expected);
  });

  it.for(SECOND_TIER)("%s 的脚本真的实现了 --staged", ([, script]) => {
    // 钩子里的 flag 与脚本里的实现是两件事：只写 flag 而脚本不认它，会被解析成未知
    // 参数（多数脚本忽略）⇒ 条件触发**静默失效**，退回无条件全库扫描。
    const text = readFileSync(join(REPO_ROOT, "scripts", script), "utf8");
    expect(
      text.includes("skipUnlessStagedTouches("),
      `${script} 没有实现 --staged —— 钩子里那个 flag 会变成静默失效的条件触发`,
    ).toBe(true);
  });

  it("短路点在重活之前（不是在 main() 末尾）", () => {
    // 这一条接的是本轮实测出来的坑：`--staged` 若落在 `main()` 里、或落在
    // `require("typescript")` / 预加载 IIFE 之后，跳过那一支**照样付**那笔开销
    // （TS 模块加载 ≈180ms、`check-dead-exports` 的语料预加载 ≈340ms），
    // 「跳过」就成了形式上的绿、没有省下任何东西 —— 而退出码看不出差别。
    //
    // 判据形态：短路语句的行号必须**小于**该脚本里第一次出现
    // `require("typescript")` 那一行（没有就 <= `require("node:fs")` 之后即可）。
    for (const [, script] of SECOND_TIER) {
      const text = readFileSync(join(REPO_ROOT, "scripts", script), "utf8");
      const lines = text.split("\n");
      const skipAt = lines.findIndex((l) => l.includes("skipUnlessStagedTouches("));
      expect(skipAt, `${script} 找不到 --staged 短路语句`).toBeGreaterThanOrEqual(0);
      // 只认**真的** require 行：注释里出现的同一段字面不算（本仓的风格是
      // 在文件头解释「为什么这样加载」，那条注释必然含 `require("typescript")`）。
      const tsAt = lines.findIndex(
        (l) =>
          !/^\s*(\/\/|\*|\/\*)/.test(l) &&
          /require\(\s*"typescript"\s*\)/.test(l),
      );
      if (tsAt === -1) continue; // 该步不加载 typescript
      expect(
        skipAt,
        `${script} 的 --staged 短路在第 ${skipAt + 1} 行、` +
          `而 require("typescript") 在第 ${tsAt + 1} 行 —— 跳过档照样付 ≈180ms 的模块加载，` +
          "「跳过」等于没省；短路必须提到它前面",
      ).toBeLessThan(tsAt);
    }
  });
});
