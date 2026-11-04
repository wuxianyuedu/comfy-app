/**
 * 提交门槛自检：把 scripts/check-dead-exports.cjs 当黑盒跑在临时工作区上，验证地基层（src/lib +
 * src/trpc）零消费值导出规范（§12.16 / ISSUE #573 第 9 项）真的会阻断提交。
 * 为什么用子进程：门禁由 pre-commit 以 `node scripts/xxx.cjs` 调用，内部以 `process.cwd()` 定位扫描根。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineGateRepo, describe } from "./helpers/gate-repo";

/* 脚本用 `process.cwd()` 定位扫描根 —— 临时工作区与 `run` / `write` 由
 * `tests/helpers/gate-repo.ts` 提供，脚本落点选 `root`（用 cwd，落哪都一样）。
 * 末尾「真实仓库」那组不搭临时仓库，仍需要脚本的绝对路径。 */
const SCRIPT = join(process.cwd(), "scripts", "check-dead-exports.cjs");

const { test, expect } = defineGateRepo({
  script: "check-dead-exports.cjs",
  dir: "root",
  dirs: ["src/lib", "src/trpc", "src/components", "scripts", "tests"],
});

describe("check-dead-exports.cjs（提交门槛）", () => {
  test("被消费的值导出放行", ({ repo }) => {
    repo.write("src/lib/util.ts", "export function used(): number {\n  return 1;\n}\n");
    repo.write(
      "src/components/c.ts",
      'import { used } from "@/lib/util";\nexport const x = used();\n',
    );
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("零消费导出");
  });

  test("只被 scripts 下的 .mjs 消费也算消费（纯 Node 宿主经动态 import 取导出）", ({ repo }) => {
    repo.write(
      "src/lib/graph.ts",
      "export async function makeRepo(): Promise<number> {\n  return 2;\n}\n",
    );
    repo.write(
      "scripts/host.mjs",
      'const graph = await import("../src/lib/graph.ts");\nexport const repo = await graph.makeRepo();\n',
    );
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("零消费导出");
  });

  test("零消费的值导出被阻断（且报告里带符号全名）", ({ repo }) => {
    repo.write("src/lib/util.ts", "export function orphan(): number {\n  return 1;\n}\n");
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("src/lib/util.ts#orphan");
  });

  test("type / interface 不算死代码（同文件 props 类型的常见形态）", ({ repo }) => {
    repo.write(
      "src/lib/props.ts",
      'export interface CardProps {\n  title: string;\n}\nexport type CardKind = "a" | "b";\n',
    );
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("零消费导出");
  });

  test("`export { a as b }` 只记别名", ({ repo }) => {
    repo.write(
      "src/lib/alias.ts",
      "function inner(): number {\n  return 1;\n}\nexport { inner as renamed };\n",
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("src/lib/alias.ts#renamed");
  });

  test("扫描范围是地基层：components 的零消费导出不报", ({ repo }) => {
    repo.write(
      "src/components/view.tsx",
      "export function Labelled(): null {\n  return null;\n}\n",
    );
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("零消费导出");
  });

  test("src/trpc 也在扫描范围内：零消费的客户端入口导出被阻断", ({ repo }) => {
    repo.write("src/trpc/server.ts", "export const orphanApi = { ping: () => 1 };\n");
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("src/trpc/server.ts#orphanApi");
  });

  test("src/trpc 里被消费的导出放行（客户端入口层与 lib 同一口径）", ({ repo }) => {
    repo.write("src/trpc/react.tsx", "export const api = { ping: () => 1 };\n");
    repo.write(
      "src/components/consumer.ts",
      'import { api } from "~/trpc/react";\nexport const x = api.ping();\n',
    );
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("零消费导出");
  });

  test("test 文件里的导出不参与（用例之间雷同是正常的）", ({ repo }) => {
    repo.write("src/lib/util.test.ts", "export const helperForTests = 1;\n");
    const { code } = repo.run();
    expect(code).toBe(0);
  });

  /* 硬闸：没有基线、也没有 --update / --strict 通道 —— 零消费导出的存量已清零
   * 后，棘轮那两层（基线文件 + 收紧）只剩开销，还留了一个「手改基线把新写的
   * 零消费导出登记成已知存量」的口子。下面两条钉住「退出通道真的没了」。 */
  test("硬闸：任何零消费导出即阻断（没有「已登记的存量」这一档）", ({ repo }) => {
    repo.write("src/lib/fresh.ts", "export function newborn(): number {\n  return 2;\n}\n");
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("src/lib/fresh.ts#newborn");
  });

  test("硬闸：--update 不写任何基线文件，且仍按命中退 1", ({ repo }) => {
    repo.write("src/lib/known.ts", "export function legacy(): number {\n  return 1;\n}\n");
    expect(repo.run(["--update"]).code).toBe(1);
    expect(existsSync(join(repo.dir, "scripts", ".dead-exports-baseline.json"))).toBe(false);
  });

  test("--report 只盘点不判失败", ({ repo }) => {
    repo.write("src/lib/util.ts", "export function orphan(): number {\n  return 1;\n}\n");
    const { code, output } = repo.run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("零消费导出 1 个");
  });

  test("同域单测算消费方：符号被同目录同名测试锁住时不报（判据不可能误伤真死代码）", ({ repo }) => {
    repo.write("src/lib/util.ts", "export function lockedByOwnTest(): number {\n  return 1;\n}\n");
    repo.write(
      "src/lib/util.test.ts",
      'import { lockedByOwnTest } from "./util";\nlockedByOwnTest();\n',
    );
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("零消费导出");
  });

  test("集中目录同名测试（tests/<基名>.test.ts）同样算消费方", ({ repo }) => {
    repo.write(
      "src/lib/pure.ts",
      "export function onlyUsedInCentralTest(): number {\n  return 1;\n}\n",
    );
    repo.write(
      "tests/pure.test.ts",
      'import { onlyUsedInCentralTest } from "../src/lib/pure";\nonlyUsedInCentralTest();\n',
    );
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("零消费导出");
  });

  test("集中目录**异名**测试：按 import 关系认消费方，不按文件名", ({ repo }) => {
    repo.write(
      "src/lib/workshop/deep.ts",
      "export function coveredByDifferentlyNamedTest(): number {\n  return 1;\n}\n",
    );
    repo.write(
      "tests/workshop-deep-coverage.test.ts",
      'import { coveredByDifferentlyNamedTest } from "../src/lib/workshop/deep";\ncoveredByDifferentlyNamedTest();\n',
    );
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("零消费导出");
  });

  test("没有任何测试文件 import 该模块时仍是零消费（判据不会退化成「有没有人写过这个名字」）", ({
    repo,
  }) => {
    repo.write("src/lib/lonely.ts", "export function trulyDead(): number {\n  return 1;\n}\n");
    // 一份**别的**模块的测试，只是提到了这个名字 —— 不构成消费
    repo.write(
      "tests/other.test.ts",
      'import { describe, it } from "vitest";\ndescribe("trulyDead 语义说明", () => {\n  it("x", () => {})\n});\n',
    );
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("src/lib/lonely.ts#trulyDead");
  });

  test("--verify 单条精确复核：清单归零后仍能自证判据在工作", ({ repo }) => {
    repo.write(
      "src/lib/pure.ts",
      "export function kept(): number {\n  return 1;\n}\nexport function lost(): number {\n  return 2;\n}\n",
    );
    repo.write("tests/pure.test.ts", 'import { kept } from "../src/lib/pure";\nkept();\n');
    const ok = repo.run(["--verify", "src/lib/pure.ts#kept"]);
    expect(ok.code).toBe(0);
    expect(ok.output).toContain("有消费");
    const dead = repo.run(["--verify", "src/lib/pure.ts#lost"]);
    expect(dead.code).toBe(0);
    expect(dead.output).toContain("零消费");
    const missing = repo.run(["--verify", "src/lib/pure.ts#nope"]);
    expect(missing.code).toBe(1);
  });

  /* 后面两条不搭临时仓库：判的是**本仓库**当前的状态。 */
  test("真实仓库：当前零漂移（硬闸下无任何零消费导出）", () => {
    const result = execFileSync(process.execPath, [SCRIPT], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result).toContain("零消费导出");
  });

  test("真实仓库：基线文件已不存在 —— 判据是硬闸，不再有「已知存量」这一档", () => {
    expect(existsSync(join(process.cwd(), "scripts", ".dead-exports-baseline.json"))).toBe(false);
  });

  test("真实仓库：清单归零之后，判据靠 --verify 的自证而非「清单为空」", () => {
    /* 一个**永远返回空**的扫描器会让「清单为空」这类断言全绿 —— 所以归零
     * 之后必须有第二条证据：对**真的被消费**的符号复核，它必须报「有消费」。
     * 这里用刚才接线上去的两个符号当锚点。 */
    for (const target of [
      "src/lib/workshop/script-parser.ts#emptyProject",
      "src/lib/log/log-paths.ts#NEXTJS_PANEL_LOG_PREFIX",
    ]) {
      const result = execFileSync(process.execPath, [SCRIPT, "--verify", target], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      expect(result).toContain("有消费");
    }
  });
});
