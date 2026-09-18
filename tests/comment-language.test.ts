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
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, "scripts", "check-comment-language.cjs");

let workdir = "";

function write(rel: string, content: string): void {
  const full = join(workdir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

/** 跑门禁：与 pre-commit 同款调用方式（子进程 + cwd 指向工作区）。 */
function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-comment-language.cjs"), ...args],
      { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
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
function seedFactsDoc(modules: string[]): void {
  const row =
    `| \`comment.language.asciiOnly\` | ` +
    modules.map((m) => `\`${m}\``).join("、") +
    ` | 白名单 | 本行 | 解析本行 |`;
  write("docs/reference-facts.md", `# refs\n\n${row}\n`);
  write("docs/.keep", "");
  // doc-facts.cjs 是脚本的唯一事实来源，按相对路径导入：与真实布局一致。
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, "scripts", "doc-facts.cjs"),
    join(workdir, "scripts", "doc-facts.cjs"),
  );
}

function seedBaseline(files: Record<string, number>, total: number): void {
  writeFileSync(
    join(workdir, "scripts", ".comment-language-baseline.json"),
    JSON.stringify({ ruleVersion: 1, total, files }, null, 2),
  );
}

const CHINESE = "/** 组合输入参数：取值失败时回落缺省值。 */\nexport const a = 1;\n";
const ENGLISH = "/** Combine the input parameters and fall back to defaults. */\nexport const a = 1;\n";

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "comment-lang-gate-"));
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  mkdirSync(join(workdir, "src", "lib"), { recursive: true });
  copyFileSync(SCRIPT, join(workdir, "scripts", "check-comment-language.cjs"));
  seedFactsDoc([]);
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("注释语言棘轮（规范 §12.4.6）", () => {
  it("全中文注释 → 通过", () => {
    write("src/lib/ok.ts", CHINESE);
    seedBaseline({}, 0);
    const r = run();
    expect(r.code).toBe(0);
  });

  it("新增带英文注释的文件 → 阻断，并点名文件与总口径", () => {
    seedBaseline({}, 0);
    write("src/lib/fresh.ts", ENGLISH);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/fresh.ts");
    expect(r.output).toContain("注释一律中文");
  });

  it("存量文件的英文注释变多 → 阻断（棘轮只许降不许升）", () => {
    write("src/lib/legacy.ts", ENGLISH);
    seedBaseline({ "src/lib/legacy.ts": 1 }, 1);
    expect(run().code).toBe(0);
    write("src/lib/legacy.ts", `${ENGLISH}${ENGLISH}`);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("变多");
  });

  it("中文化有进展（基线未收紧）→ 提示；--strict 下阻断", () => {
    write("src/lib/legacy.ts", CHINESE);
    seedBaseline({ "src/lib/legacy.ts": 1 }, 1);
    const lenient = run();
    expect(lenient.code).toBe(0);
    expect(lenient.output).toContain("已减少");

    const strict = run(["--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.output).toContain("收紧基线");
  });

  it("分隔线 / 标签 / 两词以内英文（TODO）不计入判定", () => {
    // 这些行不是「英文写的注释」，混进计数会让数字失去意义。
    write(
      "src/lib/noise.ts",
      [
        "// ---------- 分隔线 ----------",
        "// TODO: check",
        "/** 见 docs/standards/12-代码组织与文件结构.md */",
        "export const a = 1;",
        "",
      ].join("\n"),
    );
    seedBaseline({}, 0);
    expect(run().code).toBe(0);
  });

  it("纯英文注释行（含 URL 行）计入 —— 判定口径是「连续英文单词 ≥ 3 个」", () => {
    // 反向锚点：上面那条只证明「噪声不计入」，不证明「英文真的被计入」。
    // 没有这条，一个永远返回 0 的统计器会让上面那条一起变绿（§12.16 同款教训）。
    write("src/lib/url.ts", "// see https://example.com/a/b/c for details\nexport const a = 1;\n");
    seedBaseline({}, 0);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/url.ts");
  });

  it("字符串字面量里的英文不被当成注释", () => {
    write(
      "src/lib/str.ts",
      '/** 中文注释。 */\nexport const a = "Combine the input parameters and fall back to defaults.";\n',
    );
    seedBaseline({}, 0);
    expect(run().code).toBe(0);
  });

  it("白名单文件整文件豁免（构建期模块必须英文 + 纯 ASCII）", () => {
    seedFactsDoc(["src/lib/db-schema-ready.ts"]);
    write("src/lib/db-schema-ready.ts", ENGLISH);
    seedBaseline({}, 0);
    expect(run().code).toBe(0);
  });

  it("基线判据版本不一致 → 阻断并指向 --update（旧数字与新口径不是同一个量）", () => {
    write("src/lib/ok.ts", CHINESE);
    writeFileSync(
      join(workdir, "scripts", ".comment-language-baseline.json"),
      JSON.stringify({ ruleVersion: 0, total: 0, files: {} }),
    );
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("判据版本");
    expect(r.output).toContain("--update");
  });

  it("--update 写入基线后同一状态通过（棘轮可闭环）", () => {
    write("src/lib/legacy.ts", ENGLISH);
    seedBaseline({}, 0);
    expect(run(["--update"]).code).toBe(0);
    expect(run().code).toBe(0);
    const baseline = JSON.parse(
      readFileSync(join(workdir, "scripts", ".comment-language-baseline.json"), "utf8"),
    );
    expect(baseline.files["src/lib/legacy.ts"]).toBe(1);
    expect(baseline.ruleVersion).toBe(1);
  });
});

describe("白名单只有一份（documentation ⇄ 判据共读）", () => {
  it("doc-facts 从 reference-facts 的那一行解析出名单，而不是另存一份", async () => {
    const mod = (await import("../scripts/doc-facts.cjs")) as unknown as {
      extractAsciiOnlyModules: () => string[];
      FACTS: Array<{ key: string; kind: string }>;
    };
    const paths = mod.extractAsciiOnlyModules();
    expect(paths).toContain("src/lib/db-schema-ready.ts");
    expect(paths).toContain("src/server/db.ts");
    // 名单来源必须是那篇文档：解析结果与文档里写的逐项相同。
    const doc = readFileSync(join(REPO_ROOT, "docs/reference-facts.md"), "utf8");
    const row = doc.split("\n").find((l) => l.includes("comment.language.asciiOnly"));
    expect(row, "reference-facts 缺少 comment.language.asciiOnly 登记行").toBeTruthy();
    for (const p of paths) expect(row).toContain(`\`${p}\``);
  });

  it("事实已登记在 FACTS 里（有 key 才参与 doc:check 的核对）", async () => {
    const mod = (await import("../scripts/doc-facts.cjs")) as unknown as {
      FACTS: Array<{ key: string }>;
    };
    expect(mod.FACTS.some((f) => f.key === "comment.language.asciiOnly")).toBe(true);
  });

  it("规范与启动链路文档都写明了例外的存在（避免「一刀切」被改回去）", () => {
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
