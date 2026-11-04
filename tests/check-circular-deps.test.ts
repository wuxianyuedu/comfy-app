/**
 * 提交门槛自检：黑盒跑 `scripts/check-circular-deps.cjs`，验证「模块循环依赖」（§12.7，ISSUE #574）
 * 真的阻断提交，而不只是写在文档里。
 * 用子进程而非 import：pre-commit 以 `node scripts/xxx.cjs` 调用、脚本靠 `process.cwd()` 定位扫描根，复刻同一种调用才等价。
 */
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { defineGateRepo, describe } from "./helpers/gate-repo";

/* 判据脚本被 pre-commit 以 `node scripts/xxx.cjs` 调用，且内部用 process.cwd()
 * 定位扫描根 —— 临时工作区与 `run` / `write` 由 `tests/helpers/gate-repo.ts`
 * 提供；脚本落点选 `root`（脚本用 cwd，落哪都一样）。
 * 下面「真实仓库的状态」那组不搭临时仓库，直接对着源码仓库跑，所以这里
 * 仍然保留脚本的绝对路径。 */
const SCRIPT = join(process.cwd(), "scripts", "check-circular-deps.cjs");
/** 硬闸判据不该再有基线文件；这条路径只用于断言它**不存在**。 */
const BASELINE = join(process.cwd(), "scripts", ".circular-deps-baseline.json");

const { test, expect } = defineGateRepo({
  script: "check-circular-deps.cjs",
  dir: "root",
  dirs: ["src", "scripts"],
});

describe("check-circular-deps.cjs（提交门槛）", () => {
  test("无环的工作区放行", ({ repo }) => {
    repo.write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    repo.write("src/b.ts", "export const b = 1;\n");
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("无模块循环依赖");
  });

  test("两文件互相 import 被阻断", ({ repo }) => {
    repo.write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    repo.write("src/b.ts", 'import { a } from "./a";\nexport const b = a;\n');
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("新增");
    expect(output).toContain("src/a.ts");
    expect(output).toContain("src/b.ts");
  });

  test("三文件环（A→B→C→A）被阻断", ({ repo }) => {
    repo.write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    repo.write("src/b.ts", 'import { c } from "./c";\nexport const b = c;\n');
    repo.write("src/c.ts", 'import { a } from "./a";\nexport const c = a;\n');
    expect(repo.run().code).toBe(1);
  });

  test("自环（文件 import 自己）被阻断", ({ repo }) => {
    repo.write("src/a.ts", 'import { a } from "./a";\nexport const a = a;\n');
    expect(repo.run().code).toBe(1);
  });

  test("type-only 回引也算环（类型不构成「谁依赖谁」的例外）", ({ repo }) => {
    repo.write("src/a.ts", 'import type { B } from "./b";\nexport type A = B;\n');
    repo.write("src/b.ts", 'import type { A } from "./a";\nexport type B = A;\n');
    expect(repo.run().code).toBe(1);
  });

  test("别名 @/ 与省略扩展名按 TS 口径解析（环仍能被认出）", ({ repo }) => {
    repo.write("src/lib/a.ts", 'import { b } from "@/lib/b";\nexport const a = b;\n');
    repo.write("src/lib/b.ts", 'import { a } from "@/lib/a";\nexport const b = a;\n');
    expect(repo.run().code).toBe(1);
  });

  test("经 index.ts 目录导入的环也能认出", ({ repo }) => {
    repo.write("src/a.ts", 'import { b } from "./sub";\nexport const a = b;\n');
    repo.write("src/sub/index.ts", 'export { b } from "./b";\n');
    repo.write("src/sub/b.ts", 'import { a } from "../a";\nexport const b = a;\n');
    expect(repo.run().code).toBe(1);
  });

  test("注释里提到的 import 不算依赖（不误报）", ({ repo }) => {
    repo.write("src/a.ts", '// import { b } from "./b";\nexport const a = 1;\n');
    repo.write("src/b.ts", '/* import { a } from "./a"; */\nexport const b = 1;\n');
    expect(repo.run().code).toBe(0);
  });

  test("--report 只出清单不判失败", ({ repo }) => {
    repo.write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    repo.write("src/b.ts", 'import { a } from "./a";\nexport const b = a;\n');
    const { code, output } = repo.run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("循环依赖");
  });

  /* 硬闸：没有基线、也没有 --update 通道 —— 环的存量已清零后，棘轮那两层
   * （基线文件 + 收紧）只剩开销，还留了一个「手改基线把新环登记成已知存量」
   * 的口子。这两条用例钉住「退出通道真的没了」。 */
  test("硬闸：没有 --update 通道（不写任何基线文件）", ({ repo }) => {
    repo.write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    repo.write("src/b.ts", 'import { a } from "./a";\nexport const b = a;\n');
    const { code } = repo.run(["--update"]);
    expect(code).toBe(1);
    expect(existsSync(join(repo.dir, "scripts", ".circular-deps-baseline.json"))).toBe(false);
  });

  test("硬闸：无环工作区放行（不再需要任何基线）", ({ repo }) => {
    repo.write("src/a.ts", 'import { b } from "./b";\nexport const a = b;\n');
    repo.write("src/b.ts", "export const b = 1;\n");
    expect(repo.run().code).toBe(0);
  });
});

describe("真实仓库的环状态（§12.7）", () => {
  /* 这一组不搭临时仓库：它判的就是**本仓库**当前的状态。 */
  test("基线文件已不存在 —— 判据是硬闸，不再有「已知存量」这一档", () => {
    expect(existsSync(BASELINE)).toBe(false);
  });

  test("真实仓库当前无任何模块循环依赖", () => {
    const output = execFileSync(process.execPath, [SCRIPT, "--report"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(output).toContain("无模块循环依赖");
  });
});
