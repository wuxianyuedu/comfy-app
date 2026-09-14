/**
 * 跨文件重复门禁自检：把 `scripts/check-code-duplication.cjs` 当黑盒跑在临时
 * 工作区上，验证它真的会拦下「同一份实现被复制成两份」。
 *
 * 规范：docs/standards/12-代码组织与文件结构.md §12.12
 *
 * 为什么值得有门禁：重复代码在 review 里最容易被放行 —— 单看每一份都「没毛病」，
 * 只有把两份并排比较才发现是同一段。历史上 `api-channel.server.ts` 与
 * `server/workshop/api-channel.ts` 就是如此（84% 逐行相同），
 * `test-usage` 的两个路由也是（同一套密钥解析各写一份）。这条把「并排比较」
 * 这一步机器化。
 *
 * 用子进程跑而不是 import：该脚本被 pre-commit 以 `node scripts/xxx.cjs`
 * 调用，且内部用 `process.cwd()` 定位扫描根；复用同一调用方式才等价于真实门禁。
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-code-duplication.cjs");

let workdir = "";

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-code-duplication.cjs"), ...args],
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

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "duplication-gate-"));
  /* 脚本用 `__dirname/..` 定扫描根（与其它门禁脚本同一约定），所以它必须落在
   * 工作区的 scripts/ 下 —— 放在工作区根会把「仓库根」解析成 /tmp。 */
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(workdir, "scripts", "check-code-duplication.cjs"));
  mkdirSync(join(workdir, "src"), { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** 造一个 `lines` 行的模块（每行都不同，避免被当成互相重复的样板）。 */
function writeModule(rel: string, lines: number, prefix: string): void {
  const abs = join(workdir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const body = Array.from({ length: lines }, (_, i) => `const ${prefix}_${i} = ${i};`);
  writeFileSync(abs, body.join("\n") + "\n");
}

/** 把一份实现复制成「孪生」：**逐行相同**，只是换个文件名/头部注释 ——
 *  这正是历史上那两对孪生的形态（整段复制，注释里写着「复刻 xxx」）。 */
function writeTwin(rel: string, source: string, header = "// twin\n"): void {
  const abs = join(workdir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, header + readFileSync(join(workdir, source), "utf8"));
}

describe("check-code-duplication.cjs（跨文件重复门禁）", () => {
  it("基线文件缺失时阻断（先要求建基线，避免规则静默失效）", () => {
    writeModule("src/a.ts", 80, "a");
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("基线文件缺失");
  });

  it("干净工作区（无孪生）基线为空时放行", () => {
    writeModule("src/a.ts", 80, "a");
    run(["--update"]);
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("[duplication] OK");
  });

  it("两份逐行相同的实现被识别为孪生对（--report 出清单）", () => {
    writeModule("src/a.ts", 80, "x");
    writeTwin("src/b.ts", "src/a.ts");
    const { output } = run(["--report"]);
    expect(output).toContain("src/a.ts");
    expect(output).toContain("src/b.ts");
    // 改名后行文本一致 → 比例应是 100%
    expect(output).toContain("100.0%");
  });

  it("基线外新增孪生对阻断", () => {
    writeModule("src/a.ts", 80, "x");
    writeTwin("src/b.ts", "src/a.ts");
    run(["--update"]); // 先建基线（含这一对）
    writeModule("src/c.ts", 80, "p");
    writeTwin("src/d.ts", "src/c.ts"); // 新增一对
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("基线外新增孪生对");
    expect(output).toContain("src/c.ts");
  });

  it("结构相似但逐行不同不报（阈值挡住误报）", () => {
    writeModule("src/a.ts", 80, "x");
    writeModule("src/b.ts", 80, "y"); // 行文本完全不同
    run(["--update"]);
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("（无）");
  });

  it("小文件不进比较（5 行的样板工具「全都一样」没有意义）", () => {
    writeModule("src/a.ts", 10, "x");
    writeTwin("src/b.ts", "src/a.ts");
    const { output } = run(["--report"]);
    expect(output).toContain("（无）");
  });

  it("测试文件不算重复源（用例之间大量雷同是正常的）", () => {
    writeModule("src/a.ts", 80, "x");
    writeTwin("src/a.test.ts", "src/a.ts");
    const { output } = run(["--report"]);
    expect(output).toContain("（无）");
  });

  it("注释与缩进差异不算差异（归一化后仍判为孪生）", () => {
    writeModule("src/a.ts", 80, "x");
    // 同一份实现：加注释、改缩进、加空行
    const src = readFileSync(join(workdir, "src/a.ts"), "utf8");
    const decorated = src
      .split("\n")
      .map((l) => `// 说明\n  ${l}\n`)
      .join("");
    writeFileSync(join(workdir, "src/b.ts"), decorated);
    const { output } = run(["--report"]);
    expect(output).toContain("100.0%");
  });

  it("治理后未收紧基线：--strict 失败，非 strict 只提示", () => {
    writeModule("src/a.ts", 80, "x");
    writeTwin("src/b.ts", "src/a.ts");
    run(["--update"]);
    rmSync(join(workdir, "src/b.ts"));
    expect(run(["--strict"]).code).toBe(1);
    const relaxed = run();
    expect(relaxed.code).toBe(0);
    expect(relaxed.output).toContain("已被消除");
  });
});
