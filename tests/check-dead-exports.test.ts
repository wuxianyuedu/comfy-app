/**
 * 提交门槛自检：把 scripts/check-dead-exports.cjs 当成黑盒跑在临时工作区上，
 * 验证「地基层（src/lib + src/trpc）的零消费值导出」这条规范（§12.16）
 * 真的会阻断提交。
 *
 * 规范：docs/standards/12-代码组织与文件结构.md §12.16（ISSUE #573 第 9 项）
 *
 * 为什么用子进程跑：门禁由 pre-commit 以 `node scripts/xxx.cjs` 调用，且内部以
 * `process.cwd()` 定位扫描根 —— 复用同一调用方式才等价于真实门禁。
 */
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-dead-exports.cjs");

let workdir = "";

function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "check-dead-exports.cjs"), ...args],
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
  workdir = mkdtempSync(join(tmpdir(), "dead-exports-gate-"));
  copyFileSync(SCRIPT, join(workdir, "check-dead-exports.cjs"));
  for (const d of [
    "src/lib",
    "src/trpc",
    "src/components",
    "scripts",
    "tests",
  ]) {
    mkdirSync(join(workdir, d), { recursive: true });
  }
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** 基线是首次 `--update` 写出的（门禁自身的常规用法）。 */
function seedBaseline(): void {
  run(["--update"]);
}

describe("check-dead-exports.cjs（提交门槛）", () => {
  it("被消费的值导出放行", () => {
    write(
      "src/lib/util.ts",
      "export function used(): number {\n  return 1;\n}\n",
    );
    write(
      "src/components/c.ts",
      'import { used } from "@/lib/util";\nexport const x = used();\n',
    );
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("无新增零消费导出");
  });

  it("只被 scripts 下的 .mjs 消费也算消费（纯 Node 宿主经动态 import 取导出）", () => {
    write(
      "src/lib/graph.ts",
      "export async function makeRepo(): Promise<number> {\n  return 2;\n}\n",
    );
    write(
      "scripts/host.mjs",
      'const graph = await import("../src/lib/graph.ts");\nexport const repo = await graph.makeRepo();\n',
    );
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("无新增零消费导出");
  });

  it("零消费的值导出被阻断（且报告里带符号全名）", () => {
    write(
      "src/lib/util.ts",
      "export function orphan(): number {\n  return 1;\n}\n",
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("src/lib/util.ts#orphan");
  });

  it("type / interface 不算死代码（同文件 props 类型的常见形态）", () => {
    write(
      "src/lib/props.ts",
      'export interface CardProps {\n  title: string;\n}\nexport type CardKind = "a" | "b";\n',
    );
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("无新增零消费导出");
  });

  it("`export { a as b }` 只记别名", () => {
    write(
      "src/lib/alias.ts",
      "function inner(): number {\n  return 1;\n}\nexport { inner as renamed };\n",
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("src/lib/alias.ts#renamed");
  });

  it("扫描范围是地基层：components 的零消费导出不报", () => {
    write(
      "src/components/view.tsx",
      "export function Labelled(): null {\n  return null;\n}\n",
    );
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("无新增零消费导出");
  });

  it("src/trpc 也在扫描范围内：零消费的客户端入口导出被阻断", () => {
    write(
      "src/trpc/server.ts",
      "export const orphanApi = { ping: () => 1 };\n",
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("src/trpc/server.ts#orphanApi");
  });

  it("src/trpc 里被消费的导出放行（客户端入口层与 lib 同一口径）", () => {
    write("src/trpc/react.tsx", "export const api = { ping: () => 1 };\n");
    write(
      "src/components/consumer.ts",
      'import { api } from "~/trpc/react";\nexport const x = api.ping();\n',
    );
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("无新增零消费导出");
  });

  it("test 文件里的导出不参与（用例之间雷同是正常的）", () => {
    write("src/lib/util.test.ts", "export const helperForTests = 1;\n");
    const { code } = run();
    expect(code).toBe(0);
  });

  it("棘轮：已登记的存量放行，新增的仍阻断", () => {
    write(
      "src/lib/known.ts",
      "export function legacy(): number {\n  return 1;\n}\n",
    );
    seedBaseline();
    expect(run().code).toBe(0);
    write(
      "src/lib/fresh.ts",
      "export function newborn(): number {\n  return 2;\n}\n",
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("src/lib/fresh.ts#newborn");
    expect(output).not.toContain("src/lib/known.ts#legacy");
  });

  it("--update 收紧基线：符号被消费后基线里的条目必须删掉（--strict 会拦）", () => {
    write(
      "src/lib/known.ts",
      "export function legacy(): number {\n  return 1;\n}\n",
    );
    seedBaseline();
    write(
      "src/lib/known.ts",
      "export function legacy(): number {\n  return 1;\n}\n",
    );
    write(
      "src/components/c.ts",
      'import { legacy } from "@/lib/known";\nexport const x = legacy();\n',
    );
    const strict = run(["--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.output).toContain("--update");
    expect(run(["--update"]).code).toBe(0);
    expect(run(["--strict"]).code).toBe(0);
  });

  it("--report 只盘点不判失败", () => {
    write(
      "src/lib/util.ts",
      "export function orphan(): number {\n  return 1;\n}\n",
    );
    const { code, output } = run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("零消费导出 1 个");
  });

  it("同域单测算消费方：符号被同目录同名测试锁住时不报（判据不可能误伤真死代码）", () => {
    write(
      "src/lib/util.ts",
      "export function lockedByOwnTest(): number {\n  return 1;\n}\n",
    );
    write(
      "src/lib/util.test.ts",
      'import { lockedByOwnTest } from "./util";\nlockedByOwnTest();\n',
    );
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("无新增零消费导出");
  });

  it("集中目录同名测试（tests/<基名>.test.ts）同样算消费方", () => {
    write(
      "src/lib/pure.ts",
      "export function onlyUsedInCentralTest(): number {\n  return 1;\n}\n",
    );
    write(
      "tests/pure.test.ts",
      'import { onlyUsedInCentralTest } from "../src/lib/pure";\nonlyUsedInCentralTest();\n',
    );
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("无新增零消费导出");
  });

  it("集中目录**异名**测试：按 import 关系认消费方，不按文件名", () => {
    write(
      "src/lib/workshop/deep.ts",
      "export function coveredByDifferentlyNamedTest(): number {\n  return 1;\n}\n",
    );
    write(
      "tests/workshop-deep-coverage.test.ts",
      'import { coveredByDifferentlyNamedTest } from "../src/lib/workshop/deep";\ncoveredByDifferentlyNamedTest();\n',
    );
    const { code, output } = run();
    expect(code).toBe(0);
    expect(output).toContain("无新增零消费导出");
  });

  it("没有任何测试文件 import 该模块时仍是零消费（判据不会退化成「有没有人写过这个名字」）", () => {
    write(
      "src/lib/lonely.ts",
      "export function trulyDead(): number {\n  return 1;\n}\n",
    );
    // 一份**别的**模块的测试，只是提到了这个名字 —— 不构成消费
    write(
      "tests/other.test.ts",
      'import { describe, it } from "vitest";\ndescribe("trulyDead 语义说明", () => {\n  it("x", () => {})\n});\n',
    );
    const { code, output } = run();
    expect(code).toBe(1);
    expect(output).toContain("src/lib/lonely.ts#trulyDead");
  });

  it("--verify 单条精确复核：清单归零后仍能自证判据在工作", () => {
    write(
      "src/lib/pure.ts",
      "export function kept(): number {\n  return 1;\n}\nexport function lost(): number {\n  return 2;\n}\n",
    );
    write(
      "tests/pure.test.ts",
      'import { kept } from "../src/lib/pure";\nkept();\n',
    );
    const ok = run(["--verify", "src/lib/pure.ts#kept"]);
    expect(ok.code).toBe(0);
    expect(ok.output).toContain("有消费");
    const dead = run(["--verify", "src/lib/pure.ts#lost"]);
    expect(dead.code).toBe(0);
    expect(dead.output).toContain("零消费");
    const missing = run(["--verify", "src/lib/pure.ts#nope"]);
    expect(missing.code).toBe(1);
  });

  it("真实仓库：当前零漂移（棘轮处于收紧状态）", () => {
    const result = execFileSync(process.execPath, [SCRIPT, "--strict"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result).toContain("无新增零消费导出");
  });

  it("真实仓库：清单归零之后，判据靠 --verify 的自证而非「清单为空」", () => {
    /* 一个**永远返回空**的扫描器会让「清单为空」这类断言全绿 —— 所以归零
     * 之后必须有第二条证据：对**真的被消费**的符号复核，它必须报「有消费」。
     * 这里用刚才接线上去的两个符号当锚点。 */
    for (const target of [
      "src/lib/workshop/script-parser.ts#emptyProject",
      "src/lib/log/log-paths.ts#NEXTJS_PANEL_LOG_PREFIX",
    ]) {
      const result = execFileSync(
        process.execPath,
        [SCRIPT, "--verify", target],
        {
          cwd: process.cwd(),
          encoding: "utf8",
        },
      );
      expect(result).toContain("有消费");
    }
  });
});
