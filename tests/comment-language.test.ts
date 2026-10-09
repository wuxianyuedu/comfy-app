/**
 * 提交门槛自检：注释语言棘轮（ISSUE #678 / 规范 §12.4.6）。
 *
 * 这条门禁的价值全在**两个方向**都成立上：既要真的拦住「新增英文注释」，
 * 也要在中文化有进展后**要求收紧基线**（否则基线会长期停在一个宽松的数字上）。
 * 用「临时工作区 + 只放被测文件」跑真脚本，两个方向各断言一次。
 *
 * 为什么必须把「白名单只定义一次」也写成用例：白名单分散成两份（文档一份、
 * 脚本一份）时的表现是「文档说允许、判据说违规」，而两边看起来都对 —— 这正是
 * §12.18 / §12.4.6 反复出现的形态。判据由 doc-facts 反向解析 reference-facts
 * 的那一行承载，这里把它当场锁住。
 *
 * 规范：docs/standards/12-代码组织与文件结构.md §12.4.6
 *      docs/standards/launch-and-build.md §9.6（例外为什么必须存在）
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
function runInRepo(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
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
function seedFactsDoc(repo: GateRepo, modules: string[]): void {
  const row =
    `| \`comment.language.asciiOnly\` | ` +
    modules.map((m) => `\`${m}\``).join("、") +
    ` | 白名单 | 本行 | 解析本行 |`;
  repo.write("docs/reference-facts.md", `# refs\n\n${row}\n`);
}

/**
 * 判据版本从脚本里读，不在测试里另写一份数字 —— 否则每次升版都要同步改两处，
 * 而「测试里的版本」与「脚本里的版本」谁新谁旧正是这类门禁最容易漂移的地方
 * （规范 §12.5.4：登记处 > 2 时先问能不能是派生视图）。
 */
function currentRuleVersion(): number {
  const src = readFileSync(SCRIPT, "utf8");
  const m = /^const RULE_VERSION = (\d+);/m.exec(src);
  if (!m)
    throw new Error("脚本里没有 `const RULE_VERSION = N;`，取不到判据版本");
  return Number(m[1]);
}

function seedBaseline(
  repo: GateRepo,
  files: Record<string, number>,
  total: number,
): void {
  repo.write(
    "scripts/.comment-language-baseline.json",
    JSON.stringify(
      { ruleVersion: currentRuleVersion(), total, files },
      null,
      2,
    ),
  );
}

const CHINESE =
  "/** 组合输入参数：取值失败时回落缺省值。 */\nexport const a = 1;\n";
const ENGLISH =
  "/** Combine the input parameters and fall back to defaults. */\nexport const a = 1;\n";

describe("注释语言棘轮（规范 §12.4.6）", () => {
  test("全中文注释 → 通过", ({ repo }) => {
    repo.write("src/lib/ok.ts", CHINESE);
    seedBaseline(repo, {}, 0);
    const r = repo.run();
    expect(r.code).toBe(0);
  });

  test("新增带英文注释的文件 → 阻断，并点名文件与总口径", ({ repo }) => {
    seedBaseline(repo, {}, 0);
    repo.write("src/lib/fresh.ts", ENGLISH);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/fresh.ts");
    expect(r.output).toContain("注释一律中文");
  });

  test("存量文件的英文注释变多 → 阻断（棘轮只许降不许升）", ({ repo }) => {
    repo.write("src/lib/legacy.ts", ENGLISH);
    seedBaseline(repo, { "src/lib/legacy.ts": 1 }, 1);
    expect(repo.run().code).toBe(0);
    repo.write("src/lib/legacy.ts", `${ENGLISH}${ENGLISH}`);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("变多");
  });

  test("中文化有进展（基线未收紧）→ 提示；--strict 下阻断", ({ repo }) => {
    repo.write("src/lib/legacy.ts", CHINESE);
    seedBaseline(repo, { "src/lib/legacy.ts": 1 }, 1);
    const lenient = repo.run();
    expect(lenient.code).toBe(0);
    expect(lenient.output).toContain("已减少");

    const strict = repo.run(["--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.output).toContain("收紧基线");
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
    seedBaseline(repo, {}, 0);
    expect(repo.run().code).toBe(0);
  });

  test("工具指示注释（@vitest-environment / @ts-* / eslint-disable）不参与统计", ({
    repo,
  }) => {
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
    seedBaseline(repo, {}, 0);
    expect(repo.run().code).toBe(0);
  });

  test("turbopackIgnore 指令行不参与统计（Turbopack 按字面量解析）", ({
    repo,
  }) => {
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
    seedBaseline(repo, {}, 0);
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
    seedBaseline(repo, {}, 0);
    expect(repo.run().code).toBe(0);
  });

  test("参数名恰好是英文虚词（from / to / at）的结构行不参与统计（实测误报 3 处）", ({
    repo,
  }) => {
    // 判据的真实缺陷：`@param {string} from` 剥掉类型块后剩 `from`，而 `from` 在
    // 英文虚词表里 —— 于是一条**纯类型语法行**（一个英文说明字都没有）被判成
    // 「英文说明句」。实测全仓 3 处：`scripts/launcher-core/run.mjs` 的
    // `@param {Date} at` / `@param {string} from` / `@param {string} to`，
    // 而该文件当时没有执行者（判据不在钩子里 —— 正是 ISSUE #1451 立案的现场），
    // 直到它被接进钩子才拦住从 master 分出的每一个提交。
    // 修法 = 先剥掉「@tag + 类型块 + 参数名」三段再判虚词。
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
    seedBaseline(repo, {}, 0);
    expect(repo.run().code).toBe(0);
  });

  test("参数名是虚词、后面**真有**英文说明 → 仍被统计（豁免不放过散文）", ({
    repo,
  }) => {
    // 上一条的反向锚点：剥参数名之后剩下的若真是说明句，虚词照旧命中。
    repo.write(
      "src/lib/jsdoc-prose-param-name-prose.ts",
      "/** @param {string} from the source label */\nexport const a = 1;\n",
    );
    seedBaseline(repo, {}, 0);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/jsdoc-prose-param-name-prose.ts");
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
    seedBaseline(repo, {}, 0);
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
    seedBaseline(repo, {}, 0);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/jsdoc-continuation-prose.ts");
  });

  test("带英文散文的 JSDoc 行仍会被统计（结构行豁免不放过说明句）", ({
    repo,
  }) => {
    // 反向锚点：豁免只剥「@tag + 类型块 + 参数名」三段。
    // 若把「说明句里的每个英文词都当标识符删掉」，就会把这条忘了改的英文说明放过去。
    repo.write(
      "src/lib/jsdoc-prose.ts",
      "/** @param {string} candidate the command to probe */\nexport const a = 1;\n",
    );
    seedBaseline(repo, {}, 0);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/jsdoc-prose.ts");
  });

  test("说明某个指令的中文注释仍会被统计（豁免只认行首就是指令）", ({
    repo,
  }) => {
    // 反向锚点：不设这条，「豁免正则写得太宽」会把正常中文注释一起放行而无人发现。
    repo.write(
      "src/lib/directive-doc.ts",
      "// we keep the @ts-expect-error directive here on purpose\nexport const a = 1;\n",
    );
    seedBaseline(repo, {}, 0);
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
    seedBaseline(repo, {}, 0);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/url.ts");
  });

  /* ── 「引用行」不计入判定（判据版本 3 新增的第二条腿）─────────────────
   * 本规则治的是「人读的说明文字用英文写」。中文段落把一批标识符 / 路径 /
   * 类名折到下一行是常见写法，旧口径（只看词数）会整片误判 —— 仓库实测 21 行
   * 里 20 行是这一类。真英文散文几乎必然含虚词（表与 JSDoc 结构行豁免同源），
   * 所以判据改成两条同时成立：剥完引用还剩 ≥3 个英文词 **且** 含虚词/动词。
   * 下面四条分别钉住这条腿的四个面：清单不计、连字符里的虚词不计、反引号内的
   * 原文引用不计，而**裸写的英文句子仍然计**（不设这条就等于把门禁改成噪音）。 */
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
    seedBaseline(repo, {}, 0);
    const r = repo.run();
    expect(r.code, r.output).toBe(0);
  });

  test("连字符标识符里的 in / on / as 不当成虚词（本条改判据的起因）", ({
    repo,
  }) => {
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
    seedBaseline(repo, {}, 0);
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
    seedBaseline(repo, {}, 0);
    const r = repo.run();
    expect(r.code, r.output).toBe(0);
  });

  test("剥掉引用后仍是裸写的英文句子 → 照样计入（新豁免不放过散文）", ({
    repo,
  }) => {
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
    seedBaseline(repo, {}, 0);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/prose.ts");
  });

  test("JSX 注释块（`{/* … */}`）与块注释同判 —— 英文计入、中文不计入", ({
    repo,
  }) => {
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
    seedBaseline(repo, {}, 0);
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
    seedBaseline(repo, {}, 0);
    const r = repo.run();
    expect(r.code).toBe(1);
    // 三行都含成句英文 → 应统计到 3（只看首行会漏掉两行）
    expect(r.output).toContain("src/components/Multi.tsx（3 行）");
  });

  test("字符串字面量里的英文不被当成注释", ({ repo }) => {
    repo.write(
      "src/lib/str.ts",
      '/** 中文注释。 */\nexport const a = "Combine the input parameters and fall back to defaults.";\n',
    );
    seedBaseline(repo, {}, 0);
    expect(repo.run().code).toBe(0);
  });

  test("白名单文件整文件豁免（构建期模块必须英文 + 纯 ASCII）", ({ repo }) => {
    seedFactsDoc(repo, ["src/lib/db-schema-ready.ts"]);
    repo.write("src/lib/db-schema-ready.ts", ENGLISH);
    seedBaseline(repo, {}, 0);
    expect(repo.run().code).toBe(0);
  });

  test("基线判据版本不一致 → 阻断并指向 --update（旧数字与新口径不是同一个量）", ({
    repo,
  }) => {
    repo.write("src/lib/ok.ts", CHINESE);
    repo.write(
      "scripts/.comment-language-baseline.json",
      JSON.stringify({ ruleVersion: 0, total: 0, files: {} }),
    );
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("判据版本");
    expect(r.output).toContain("--update");
  });

  test("--update 建立基线后同一状态通过（棘轮可闭环）", ({ repo }) => {
    repo.write("src/lib/legacy.ts", ENGLISH);
    /* 这里**不再**先手写一份 `total: 0` 的基线：那份零基线加一句「--update 必须成功」
     * 断的正是「把新增的违规收进基线」那扇门 —— 而它现在是判据要拦的行为
     * （`tests/ratchet-update-guards.test.ts`，台账 E5）。闭环的第一步在生产里长这样：
     * 基线文件还不存在，`--update` 把它第一次写出来。 */
    expect(repo.run(["--update"]).code).toBe(0);
    expect(repo.run().code).toBe(0);
    const baseline = JSON.parse(
      repo.read("scripts/.comment-language-baseline.json"),
    ) as { files: Record<string, number>; ruleVersion: number };
    expect(baseline.files["src/lib/legacy.ts"]).toBe(1);
    expect(baseline.ruleVersion).toBe(currentRuleVersion());
  });
});

describe("白名单只有一份（documentation ⇄ 判据共读）", () => {
  test("doc-facts 从 reference-facts 的那一行解析出名单，而不是另存一份", async () => {
    const mod = (await import("../scripts/doc-facts.cjs")) as unknown as {
      extractAsciiOnlyModules: () => string[];
      FACTS: Array<{ key: string; kind: string }>;
    };
    const paths = mod.extractAsciiOnlyModules();
    expect(paths).toContain("src/lib/db-schema-ready.ts");
    expect(paths).toContain("src/server/db.ts");
    // 名单来源必须是那篇文档：解析结果与文档里写的逐项相同。
    const doc = readFileSync(
      join(REPO_ROOT, "docs/reference-facts.md"),
      "utf8",
    );
    const row = doc
      .split("\n")
      .find((l) => l.includes("comment.language.asciiOnly"));
    expect(
      row,
      "reference-facts 缺少 comment.language.asciiOnly 登记行",
    ).toBeTruthy();
    for (const p of paths) expect(row).toContain(`\`${p}\``);
  });

  test("事实已登记在 FACTS 里（有 key 才参与 doc:check 的核对）", async () => {
    const mod = (await import("../scripts/doc-facts.cjs")) as unknown as {
      FACTS: Array<{ key: string }>;
    };
    expect(mod.FACTS.some((f) => f.key === "comment.language.asciiOnly")).toBe(
      true,
    );
  });

  /**
   * 提交进仓库的基线**必须与提交进仓库的树对得上**。
   *
   * 这条守的是棘轮的一个结构性盲区：临时工作区里跑的用例（上面那批）验证的是
   * 「脚本判据对不对」，而**仓库自己的基线有没有跟上仓库自己的代码**没有任何
   * 判据盯着 —— `--update` 写出来的数字只在提交时进历史，此后新增的英文注释
   * 若因为「钩子没跑 / 跑了没看」被提交进来，基线就会**停在原地**：
   *   · `check-comment-language.cjs` 在 pre-commit 里报红（提交被拦），
   *   · 但代码已经在 master 上了 —— 于是**下一个人做任何提交都会失败**，
   *     且失败原因与他自己的改动毫无关系（实测：7 个文件、20 行，
   *     出自 4 个已合并的提交）。
   * 换句话说，这不是「基线滞后」的美观问题，而是「门禁从可信变成噪音」的
   * 那一刻。写法上把脚本的 `--report` 输出与基线逐项比对即可（同一份脚本、
   * 同一份判据，不另写一遍统计）。
   */
  test("仓库里的基线覆盖仓库里的代码（否则门禁对下一个提交者报与自己无关的红）", () => {
    const report = runInRepo(["--report"]);
    expect(report.code, report.output).toBe(0);
    /* `--report` 的输出形如：
     *   扫描 1012 个代码文件:疑似英文注释 20 行,分布在 7 个文件
     *        8  （路径）
     */
    const header = /疑似英文注释 (\d+) 行,分布在 (\d+) 个文件/.exec(
      report.output,
    );
    expect(header, `无法解析 --report 表头：${report.output}`).toBeTruthy();
    const baseline = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "scripts", ".comment-language-baseline.json"),
        "utf8",
      ),
    ) as { total: number; files: Record<string, number> };
    const actualTotal = Number(header![1]);
    const actualFiles = Number(header![2]);
    const baselineFiles = Object.keys(baseline.files ?? {}).length;
    expect(
      actualTotal,
      `${actualFiles} 个文件里有 ${actualTotal} 行英文注释未登记进基线` +
        "（基线 " +
        `${baseline.total ?? 0} 行 / ${baselineFiles} 个文件）。` +
        "\n  要么把这些注释改成中文（首选），要么执行" +
        "\n  node scripts/check-comment-language.cjs --update 收紧基线" +
        "\n  —— 但**不要**用一个更宽的基线把红遮掉，那等于把门禁改成噪音。",
    ).toBe(baseline.total ?? 0);
    expect(actualFiles).toBe(baselineFiles);
  });

  test("规范与启动链路文档都写明了例外的存在（避免「一刀切」被改回去）", () => {
    const std = readFileSync(
      join(REPO_ROOT, "docs/standards/12-代码组织与文件结构.md"),
      "utf8",
    );
    expect(std).toContain("12.4.6");
    expect(std).toContain("纯 ASCII 模块");
    expect(std).toContain("comment.language.asciiOnly");
    const launch = readFileSync(
      join(REPO_ROOT, "docs/standards/launch-and-build.md"),
      "utf8",
    );
    expect(launch).toContain("9.6");
  });
});
