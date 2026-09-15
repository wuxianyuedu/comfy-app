/**
 * 提交门槛自检：把 scripts/check-circular-deps.cjs 当成黑盒跑在临时工作区上，
 * 验证「模块循环依赖」这条规范（§12.7）真的会阻断提交，而不是只写在文档里。
 *
 * 规范：docs/standards/12-代码组织与文件结构.md §12.7（循环依赖预防，ISSUE #574）
 *
 * 为什么用子进程跑而不是 import：该脚本被 pre-commit 以 `node scripts/xxx.cjs`
 * 调用，且内部用 process.cwd() 定位扫描根；复用同一调用方式才等价于真实门禁。
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-circular-deps.cjs");
const BASELINE = join(process.cwd(), "scripts", ".circular-deps-baseline.json");

let workdir = "";

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "check-circular-deps.cjs"), ...args],
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

function write(rel: string, content: string): void {
  const full = join(workdir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "circular-gate-"));
  copyFileSync(SCRIPT, join(workdir, "check-circular-deps.cjs"));
  mkdirSync(join(workdir, "src"), { recursive: true });
  mkdirSync(join(workdir, "scripts"), { recursive: true });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("check-circular-deps.cjs（提交门槛）", () => {
  it("无环的工作区放行", () => {
    write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    write("src/b.ts", "export const b = 1;\n");
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("无新增模块循环依赖");
  });

  it("两文件互相 import 被阻断", () => {
    write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    write("src/b.ts", 'import { a } from "./a";\nexport const b = a;\n');
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("新增");
    expect(output).toContain("src/a.ts");
    expect(output).toContain("src/b.ts");
  });

  it("三文件环（A→B→C→A）被阻断", () => {
    write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    write("src/b.ts", 'import { c } from "./c";\nexport const b = c;\n');
    write("src/c.ts", 'import { a } from "./a";\nexport const c = a;\n');
    expect(run().code).toBe(1);
  });

  it("自环（文件 import 自己）被阻断", () => {
    write("src/a.ts", 'import { a } from "./a";\nexport const a = a;\n');
    expect(run().code).toBe(1);
  });

  it("type-only 回引也算环（类型不构成「谁依赖谁」的例外）", () => {
    write("src/a.ts", 'import type { B } from "./b";\nexport type A = B;\n');
    write("src/b.ts", 'import type { A } from "./a";\nexport type B = A;\n');
    expect(run().code).toBe(1);
  });

  it("别名 @/ 与省略扩展名按 TS 口径解析（环仍能被认出）", () => {
    write("src/lib/a.ts", 'import { b } from "@/lib/b";\nexport const a = b;\n');
    write("src/lib/b.ts", 'import { a } from "@/lib/a";\nexport const b = a;\n');
    expect(run().code).toBe(1);
  });

  it("经 index.ts 目录导入的环也能认出", () => {
    write("src/a.ts", 'import { b } from "./sub";\nexport const a = b;\n');
    write("src/sub/index.ts", 'export { b } from "./b";\n');
    write("src/sub/b.ts", 'import { a } from "../a";\nexport const b = a;\n');
    expect(run().code).toBe(1);
  });

  it("注释里提到的 import 不算依赖（不误报）", () => {
    write("src/a.ts", '// import { b } from "./b";\nexport const a = 1;\n');
    write("src/b.ts", '/* import { a } from "./a"; */\nexport const b = 1;\n');
    expect(run().code).toBe(0);
  });

  it("--report 只出清单不判失败", () => {
    write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    write("src/b.ts", 'import { a } from "./a";\nexport const b = a;\n');
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("循环依赖");
  });

  it("棘轮：--update 写下基线后同一形态放行", () => {
    write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    write("src/b.ts", 'import { a } from "./a";\nexport const b = a;\n');
    expect(run(["--update"]).code).toBe(0);
    expect(run().code).toBe(0);
  });

  it("棘轮：--strict 下基线已消除的环会要求收紧", () => {
    write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    write("src/b.ts", 'import { a } from "./a";\nexport const b = a;\n');
    run(["--update"]);
    // 改成无环后，--strict 要求把基线同步收紧
    write("src/b.ts", "export const b = 1;\n");
    expect(run(["--strict"]).code).toBe(1);
    expect(run(["--strict"]).output).toContain("收紧");
  });
});

describe("真实仓库的环基线（§12.7）", () => {
  it("基线存在且为空 —— 环已全部消除，模板是「零」而不是「若干」", () => {
    expect(existsSync(BASELINE)).toBe(true);
    const parsed = JSON.parse(readFileSync(BASELINE, "utf8")) as {
      cycles: string[];
    };
    expect(parsed.cycles).toEqual([]);
  });

  it("真实仓库当前无任何模块循环依赖", () => {
    const output = execFileSync(
      process.execPath,
      [SCRIPT, "--report"],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(output).toContain("无模块循环依赖");
  });
});
