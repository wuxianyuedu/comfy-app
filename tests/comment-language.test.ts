/**
 * 提交门槛自检：注释语言判据（ISSUE #678 / #1811，规范 §12.4.6）。#1811 收尾时从棘轮翻硬闸：基线已删、
 * `--update`/`--strict` 断头，用例改判「命中即退 1」。两个方向都要证（永远返回空会让「无违规」全绿），
 * 真脚本 + 临时工作区。白名单必须只定义一次：分散两份时表现为「文档说允许、判据说违规」（§12.18），由 doc-facts 反向解析锁住。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, "scripts", "check-comment-language.cjs");

const { test, expect } = defineGateRepo({
  script: "check-comment-language.cjs",
  dirs: ["src/lib"],
  /* 脚本 `await import("./doc-facts.cjs")` 去读文档事实 —— 同级动态导入只能
   * 把那份模块也拷到工作区（真实布局就是 scripts/ 下这两份并排）。 */
  copy: [{ from: "scripts/doc-facts.cjs", to: "scripts/doc-facts.cjs" }],
  /* `docs/reference-facts.md` 里那一行是白名单的唯一来源；隔离环境里也得在，
   * 否则脚本读不到名单。默认给一个**空名单**的版本（等价于此前 `beforeEach`
   * 里那句 `seedFactsDoc([])`）；要造白名单档的用例再覆盖它。 */
  files: {
    "docs/.keep": "",
    "docs/reference-facts.md":
      "# refs\n\n| `comment.language.asciiOnly` |  | 白名单 | 本行 | 解析本行 |\n",
  },
});

/** 跑门禁：直接在本仓库工作区跑（验「仓库里的基线 ⇄ 仓库里的代码」）。 */
function runInRepo(args: Array<string> = []): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    /* SAFETY: 类型断言已复核 */
    const e = error as {
      status?: number;
      stderr?: string;
      stdout?: string;
    };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

/**
 * 白名单的权威定义在 `docs/reference-facts.md` 的那一行，脚本用
 * `scripts/doc-facts.cjs` 反向解析它。临时工作区里没有那篇文档，因此这里放一份
 * 最小替身（只含被解析的那一行），把「脚本从哪里读名单」这件事在隔离环境里钉住。
 */
function seedFactsDoc(repo: GateRepo, modules: Array<string>): void {
  const row = `| \`comment.language.asciiOnly\` | ${modules
    .map((m) => `\`${m}\``)
    .join("、")} | 白名单 | 本行 | 解析本行 |`;
  repo.write("docs/reference-facts.md", `# refs\n\n${row}\n`);
}

const CHINESE = "/** 组合输入参数：取值失败时回落缺省值。 */\nexport const a = 1;\n";
const ENGLISH =
  "/** Combine the input parameters and fall back to defaults. */\nexport const a = 1;\n";

describe("注释语言判据（硬闸，规范 §12.4.6）", () => {
  test("全中文注释 → 通过", ({ repo }) => {
    repo.write("src/lib/ok.ts", CHINESE);
    const r = repo.run();
    expect(r.code).toBe(0);
  });

  test("新增带英文注释的文件 → 阻断，并点名文件与总口径", ({ repo }) => {
    repo.write("src/lib/fresh.ts", ENGLISH);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/fresh.ts");
    expect(r.output).toContain("注释一律中文");
  });

  test("同一文件的英文注释有 1 行也阻断（硬闸：没有存量额度）", ({ repo }) => {
    repo.write("src/lib/legacy.ts", ENGLISH);
    const one = repo.run();
    expect(one.code).toBe(1);
    expect(one.output).toContain("注释一律中文");
  });

  test("合规时放行（反向：判据不是恒红）", ({ repo }) => {
    repo.write("src/lib/legacy.ts", CHINESE);
    const r = repo.run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("无英文注释");
  });

  test("翻硬闸后 --update / --strict 是断头的（不许有隐藏放宽通道）", ({ repo }) => {
    /* 少了这一格，「删了 --update」与「--update 还在但没人调」看起来一样。
     * 这里刻意留一份**违规**：两个旗标都不得把它判绿，也不得落盘任何基线。 */
    repo.write("src/lib/legacy.ts", ENGLISH);
    for (const flag of ["--update", "--strict"]) {
      const r = repo.run([flag]);
      expect(r.code, `${flag} 不该放行违规`).toBe(1);
    }
    expect(repo.exists("scripts/.comment-language-baseline.json")).toBe(false);
  });

  test("分隔线 / 标签 / 两词以内英文（TODO）不计入判定", ({ repo }) => {
    // 这些行不是「英文写的注释」，混进计数会让数字失去意义。
    repo.write(
      "src/lib/noise.ts",
      [
        "// ---------- 分隔线 ----------",
        "// TODO: check",
        "/** 见 docs/standards/12-代码组织与文件结构.md */",
        "export const a = 1;",
        "",
      ].join("\n"),
    );
    expect(repo.run().code).toBe(0);
  });

  test("工具指示注释（@vitest-environment / @ts-* / eslint-disable）不参与统计", ({ repo }) => {
    // 它们不是给人读的注释，而是工具按**字面量**解析的指令：
    // 改成中文不是报错，而是静默失效（用例悄悄跑回默认环境）。
    repo.write(
      "src/lib/tool-directives.test.ts",
      [
        "// @vitest-environment jsdom",
        "// @ts-expect-error upstream types are wrong here",
        "// eslint-disable-next-line no-console",
        "/** 中文说明。 */",
        "export const a = 1;",
        "",
      ].join("\n"),
    );
    expect(repo.run().code).toBe(0);
  });

  test("turbopackIgnore 指令行不参与统计（Turbopack 按字面量解析）", ({ repo }) => {
    // Turbopack 的静态分析豁免指令按字面量解析：改写成中文即静默失效
    // （那一处的静态追踪豁免会丢失）。
    repo.write(
      "src/lib/turbopack-directive.ts",
      [
        'import fs from "node:fs";',
        "export function read(p: string) {",
        '  return fs.readFileSync(/*turbopackIgnore: true*/ p, "utf-8");',
        "}",
        "",
      ].join("\n"),
    );
    expect(repo.run().code).toBe(0);
  });

  test("JSDoc 结构行（只有类型语法，无散文）不参与统计", ({ repo }) => {
    // `@param {T}` / `@returns {T}` / `@typedef {…}` 这类行只含类型语法与标识符，
    // 是类型声明而非「用英文写的说明」。逐行塞中文会破坏语法。
    repo.write(
      "src/lib/jsdoc-structural.ts",
      [
        "/**",
        " * @param {string} candidate",
        " * @returns {Promise<ProbeResult>}",
        ' * @typedef {"ok" | "no-version"} ProbeReason',
        " * @param {ProbeOptions} [options]",
        " */",
        "export function probe(candidate: string) { return candidate; }",
        "",
      ].join("\n"),
    );
    expect(repo.run().code).toBe(0);
  });

  test("参数名恰好是英文虚词（from / to / at）的结构行不参与统计（实测误报 3 处）", ({ repo }) => {
    // 判据真实缺陷：`@param {string} from` 剥掉类型块剩 `from`，落在英文虚词表里 —— 纯类型语法行
    // （零英文说明字）被判成「英文说明句」。实测全仓 3 处：`run.mjs` 的 `@param {Date} at` /
    // `@param {string} from` / `@param {string} to`；该文件当时无执行者（ISSUE #1451 现场），
    // 接进钩子后拦住从 master 分出的每一个提交。修法 = 先剥「@tag + 类型块 + 参数名」再判虚词。
    repo.write(
      "src/lib/jsdoc-prose-param-name.ts",
      [
        "/**",
        " * @param {Date} at",
        " * @param {string} from",
        " * @param {string} to",
        " * @returns {void}",
        " */",
        "export function copy(from: string, to: string, at: Date): void {",
        "  void from;",
        "  void to;",
        "  void at;",
        "}",
        "",
      ].join("\n"),
    );
    expect(repo.run().code).toBe(0);
  });

  test("参数名是虚词、后面**真有**英文说明 → 仍被统计（豁免不放过散文）", ({ repo }) => {
    // 上一条的反向锚点：剥参数名之后剩下的若真是说明句，虚词照旧命中。
    repo.write(
      "src/lib/jsdoc-prose-param-name-prose.ts",
      "/** @param {string} from the source label */\nexport const a = 1;\n",
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/jsdoc-prose-param-name-prose.ts");
  });

  test("@property 的**字段名**恰是英文虚词时同样豁免（`@property {string} note`）", ({ repo }) => {
    // 与上面那条同因的另一半：名字位置的剥除原先只覆盖 `@param` / `@arg` /
    // `@argument`，`@property` 漏在外面 —— 于是 `@property {string} note`
    // （`note` 在虚词表里）这条**纯结构行**被判成英文散文。
    // 现场：ISSUE #2589 批 6 给 `ci-probe-lock-readout.mjs` 补 `Reading` typedef 时，
    // 硬闸当场拦下（存量已清零 ⇒ 新增即阻断），而它拦的是一行没有英文说明的字。
    repo.write(
      "src/lib/jsdoc-prose-property-name.ts",
      [
        "/**",
        " * 一跑的读数。",
        " *",
        " * @typedef {Object} Reading",
        " * @property {string} sn",
        " * @property {string} note",
        " * @property {string} [did]",
        " */",
        "export const keep = 1;",
        "",
      ].join("\n"),
    );
    expect(repo.run().code).toBe(0);
  });

  test("@property 后面**真有**英文说明 → 仍被统计（豁免不放过散文）", ({ repo }) => {
    // 上一条的反向锚点：剥掉字段名之后剩下的若真是说明句，虚词照旧命中 ——
    // 豁免面只到「@tag + 类型块 + 名字」那三段为止。
    repo.write(
      "src/lib/jsdoc-prose-property-name-prose.ts",
      "/** @property {string} note the reason the reading was unavailable */\nexport const a = 1;\n",
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/jsdoc-prose-property-name-prose.ts");
  });

  test("JSDoc 结构块的**续行**（多行类型）同样不参与统计", ({ repo }) => {
    // 多行 typedef 只有第一行带 tag，其余行只剩类型语法。
    // 不豁免续行的话，`version: string | null }} ProbeResult` 这类行会被当成英文注释。
    repo.write(
      "src/lib/jsdoc-continuation.ts",
      [
        "/**",
        " * @typedef {{ ok: boolean, command: string | null,",
        " *             version: string | null }} ProbeResult",
        " */",
        "export const a = 1;",
        "",
      ].join("\n"),
    );
    expect(repo.run().code).toBe(0);
  });

  test("JSDoc 续行里的英文说明句仍会被统计（豁免不放过散文）", ({ repo }) => {
    // 反向锚点：续行豁免以「不含英文虚词」为准，说明句一定含虚词。
    repo.write(
      "src/lib/jsdoc-continuation-prose.ts",
      [
        "/**",
        " * @param {string} candidate",
        " *   the command to probe, which must exist",
        " */",
        "export const a = 1;",
        "",
      ].join("\n"),
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/jsdoc-continuation-prose.ts");
  });

  test("带英文散文的 JSDoc 行仍会被统计（结构行豁免不放过说明句）", ({ repo }) => {
    // 反向锚点：豁免只剥「@tag + 类型块 + 参数名」三段。
    // 若把「说明句里的每个英文词都当标识符删掉」，就会把这条忘了改的英文说明放过去。
    repo.write(
      "src/lib/jsdoc-prose.ts",
      "/** @param {string} candidate the command to probe */\nexport const a = 1;\n",
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/jsdoc-prose.ts");
  });

  test("说明某个指令的中文注释仍会被统计（豁免只认行首就是指令）", ({ repo }) => {
    // 反向锚点：不设这条，「豁免正则写得太宽」会把正常中文注释一起放行而无人发现。
    repo.write(
      "src/lib/directive-doc.ts",
      "// we keep the @ts-expect-error directive here on purpose\nexport const a = 1;\n",
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/directive-doc.ts");
  });

  test("纯英文注释行（含 URL 行）计入 —— 判据是「剥掉引用后 ≥3 个英文词，且含虚词构成句子」", ({
    repo,
  }) => {
    // 反向锚点：上面那条只证明「噪声不计入」，不证明「英文真的被计入」。
    // 没有这条，一个永远返回 0 的统计器会让上面那条一起变绿（§12.16 同款教训）。
    repo.write(
      "src/lib/url.ts",
      "// see https://example.com/a/b/c for details\nexport const a = 1;\n",
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/url.ts");
  });

  /* 「引用行」不计入判定（判据版本 3 第二条腿）。规则治「人读说明用英文」；中文段落把标识符/路径
   * 折到下一行是常见写法，旧口径只看词数会整片误判（实测 21 行里 20 行是这类）。真英文散文几乎必含
   * 虚词，所以两条同时成立才算：剥完引用剩 ≥3 英文词 **且** 含虚词/动词。下面四条钉四个面：清单不计、
   * 连字符里的虚词不计、反引号引用不计，而**裸写英文句子仍计**（不设这条门禁就是噪音）。 */
  test("中文段落里折行的标识符 / 路径清单不计入", ({ repo }) => {
    repo.write(
      "src/lib/citation.ts",
      [
        "/**",
        " * 这条判据要看的模块：",
        " * open-in-browser / use-reentrancy-lock / proc-detect /",
        " * instance-kind / env-python / desktop-instance / lifecycle-derive",
        " */",
        "export const a = 1;",
      ].join("\n"),
    );
    const r = repo.run();
    expect(r.code, r.output).toBe(0);
  });

  test("连字符标识符里的 in / on / as 不当成虚词（本条改判据的起因）", ({ repo }) => {
    // `\bin\b` 会把 `open-in-browser` 拆出 in —— 不整体剥掉连字符标识符，
    // 一整串纯模块名清单就会被判成「含虚词的英文句子」。
    repo.write(
      "src/lib/hyphen.ts",
      [
        "// 执行链的静态边清单：",
        "// open-in-browser / use-element-box / log-paths-on-disk /",
        "// desktop-instance-as-export / proc-detect",
        "export const a = 1;",
      ].join("\n"),
    );
    const r = repo.run();
    expect(r.code, r.output).toBe(0);
  });

  test("反引号里的上游原文引用不计（引用不是「用英文写说明」）", ({ repo }) => {
    repo.write(
      "src/lib/upstream-quote.ts",
      [
        "/**",
        " * shadcn `styling.md` 原则 4 原文：",
        " * `Use semantic colors. Never write raw values like bg-blue-500.`",
        " */",
        "export const a = 1;",
      ].join("\n"),
    );
    const r = repo.run();
    expect(r.code, r.output).toBe(0);
  });

  test("剥掉引用后仍是裸写的英文句子 → 照样计入（新豁免不放过散文）", ({ repo }) => {
    repo.write(
      "src/lib/prose.ts",
      [
        "/**",
        " * 组合输入参数：",
        " * and fall back to the defaults when the value cannot be read",
        " */",
        "export const a = 1;",
      ].join("\n"),
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/prose.ts");
  });

  test("JSX 注释块（`{/* … */}`）与块注释同判 —— 英文计入、中文不计入", ({ repo }) => {
    // 反向锚点 + 正向用例：早期判据只认行首 `/*` / `//`，JSX 注释**从未被扫描**，
    // 于是那些英文注释既不被统计、也不被拦下（棘轮数字还显示「很干净」）。
    // fixture 用「含虚词的整句」而不是 `Floating toolbar (center)` 那种纯实词标签：
    // 后者按版本 3 的口径不再算散文（见上面「引用行不计」那组），这条锚点要验的是
    // **JSX 注释进不进统计**，不是虚词表的能力边界。
    repo.write(
      "src/components/Widget.tsx",
      [
        "export function Widget() {",
        "  return (",
        "    <div>",
        "      {/* Floating toolbar rendered in the center */}",
        "      <span />",
        "      {/* 中文说明 */}",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/components/Widget.tsx");
  });

  test("多行 JSX 注释块的每一行都参与统计（不只看第一行）", ({ repo }) => {
    repo.write(
      "src/components/Multi.tsx",
      [
        "export function Multi() {",
        "  return (",
        "    <div>",
        "      {/* project-canvas settings (top-right gear). Opens a",
        "       *  right-edge drawer with the debug toggle. State is shared",
        "       *  with the workflow editor. */}",
        "      <span />",
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    /* 三行都含成句英文 → 应统计到 3（只看首行会漏掉两行）。
     * 输出的点位形态是 `<右侧补齐的行数>  <路径>`（硬闸档统一用这一形）。 */
    expect(r.output).toMatch(/\b3\s+src\/components\/Multi\.tsx/);
  });

  test("表达式容器的前导注释（`{/* SAFETY: … */ (expr)…}`）按 `*/` 收口，其后代码行不进统计", ({
    repo,
  }) => {
    // 阳性对照：anti-slop 的 SAFETY 形态把注释写进 JSX 表达式容器的前导位，
    // `*/` 后面跟着的是代码不是 `}`。旧口径只认 `*/}` 收口 ⇒ 整份文件被判成
    // 「块注释内」，其后的英文代码行被当成英文注释（现场：
    // tests/integration/renderWithProviders.integration.test.tsx，SAFETY 批撞上）。
    // fixture 刻意让注释后的代码行「含虚词成句英文」——若收口判错，这行必被计入。
    repo.write(
      "src/components/SafetyExpr.tsx",
      [
        "export function SafetyExpr({ error }: { error: unknown }) {",
        "  return (",
        "    <div>",
        "      {/* SAFETY: 类型断言已复核 */ (error as { message?: string } | null)?.message}",
        '      {error ? "The message was rendered above the fallback text" : null}',
        "    </div>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
    expect(repo.run().code).toBe(0);
  });

  test("字符串字面量里的英文不被当成注释", ({ repo }) => {
    repo.write(
      "src/lib/str.ts",
      '/** 中文注释。 */\nexport const a = "Combine the input parameters and fall back to defaults.";\n',
    );
    expect(repo.run().code).toBe(0);
  });

  test("白名单文件整文件豁免（构建期模块必须英文 + 纯 ASCII）", ({ repo }) => {
    seedFactsDoc(repo, ["src/lib/db-schema-ready.ts"]);
    repo.write("src/lib/db-schema-ready.ts", ENGLISH);
    expect(repo.run().code).toBe(0);
  });
});

describe("白名单只有一份（documentation ⇄ 判据共读）", () => {
  test("doc-facts 从 reference-facts 的那一行解析出名单，而不是另存一份", async () => {
    /* SAFETY: 类型断言已复核 */
    const mod = (await import("../scripts/doc-facts.cjs")) as unknown as {
      extractAsciiOnlyModules: () => Array<string>;
      FACTS: Array<{ key: string; kind: string }>;
    };
    const paths = mod.extractAsciiOnlyModules();
    expect(paths).toContain("src/lib/db-schema-ready.ts");
    expect(paths).toContain("src/server/db.ts");
    // 名单来源必须是那篇文档：解析结果与文档里写的逐项相同。
    const doc = readFileSync(join(REPO_ROOT, "docs/reference-facts.md"), "utf8");
    const row = doc.split("\n").find((l) => l.includes("comment.language.asciiOnly"));
    expect(row, "reference-facts 缺少 comment.language.asciiOnly 登记行").toBeTruthy();
    for (const p of paths) {
      expect(row).toContain(`\`${p}\``);
    }
  });

  test("事实已登记在 FACTS 里（有 key 才参与 doc:check 的核对）", async () => {
    /* SAFETY: 类型断言已复核 */
    const mod = (await import("../scripts/doc-facts.cjs")) as unknown as {
      FACTS: Array<{ key: string }>;
    };
    expect(mod.FACTS.some((f) => f.key === "comment.language.asciiOnly")).toBe(true);
  });

  /**
   * 翻硬闸后仍需一条判据盯「仓库自己的树干净」：上面那批在临时工作区验判据对不对，违规若因钩子没跑
   * 而被提交，下一个提交者会失败且原因与他的改动无关。棘轮时代靠「基线 ⇄ 树逐项比对」，现在基线没了，
   * 守的形态就是「读数必须为 0」，仍走真仓库里的同一个脚本（同一份判据，不另写统计）。
   */
  test("仓库自己的树是干净的（硬闸形态下这一格才是终局）", () => {
    const report = runInRepo(["--report"]);
    expect(report.code, report.output).toBe(0);
    const header = /疑似英文注释 (?<lineCount>\d+) 行,分布在 (?<fileCount>\d+) 个文件/.exec(
      report.output,
    );
    expect(header, `无法解析 --report 表头：${report.output}`).toBeTruthy();
    expect(
      Number(header?.groups?.lineCount ?? -1),
      `${header?.groups?.fileCount ?? 0} 个文件里有 ${header?.groups?.lineCount ?? 0} 行英文注释 —— ` +
        "注释一律中文（§12.4.6）。属构建期纯 ASCII 模块就把路径登记进 " +
        "docs/reference-facts.md 的 `comment.language.asciiOnly` 一行。",
    ).toBe(0);
  });

  test("规范与启动链路文档都写明了例外的存在（避免「一刀切」被改回去）", () => {
    const std = readFileSync(join(REPO_ROOT, "docs/standards/12-代码组织与文件结构.md"), "utf8");
    expect(std).toContain("12.4.6");
    expect(std).toContain("纯 ASCII 模块");
    expect(std).toContain("comment.language.asciiOnly");
    const launch = readFileSync(join(REPO_ROOT, "docs/standards/launch-and-build.md"), "utf8");
    expect(launch).toContain("9.6");
  });
});
