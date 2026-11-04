/**
 * 跨文件重复门禁自检：把 `scripts/check-code-duplication.cjs` 当黑盒跑在临时工作区，验证它真拦下「同一份实现被复制成两份」。规范 §12.12。
 * 为什么：重复代码在 review 里最易放行 —— 单看每份都没毛病，并排比才看出（`api-channel.server.ts` 与 `server/workshop/api-channel.ts` 84% 相同；`test-usage` 两路由密钥解析各一份）。
 * 用子进程而非 import：pre-commit 以 `node scripts/xxx.cjs` 调用，脚本内部用 `process.cwd()` 定位扫描根；同一调用方式才等价于真实门禁。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineGateRepo, describe, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-code-duplication.cjs",
  dirs: ["src"],
});

/** 造一个 `lines` 行的模块（每行都不同，避免被当成互相重复的样板）。 */
function writeModule(repo: GateRepo, rel: string, lines: number, prefix: string): void {
  const body = Array.from({ length: lines }, (_, i) => `const ${prefix}_${i} = ${i};`);
  repo.write(rel, `${body.join("\n")}\n`);
}

/** 把一份实现复制成「孪生」：**逐行相同**，只是换个文件名/头部注释 ——
 *  这正是历史上那两对孪生的形态（整段复制，注释里写着「复刻 xxx」）。 */
function writeTwin(repo: GateRepo, rel: string, source: string, header = "// twin\n"): void {
  repo.write(rel, header + repo.read(source));
}

describe("check-code-duplication.cjs（跨文件重复门禁）", () => {
  test("干净工作区（无孪生）放行（硬闸不需要任何基线）", ({ repo }) => {
    writeModule(repo, "src/a.ts", 80, "a");
    const { code, output } = repo.run();
    expect(code).toBe(0);
    expect(output).toContain("[ok] 跨文件重复块");
  });

  test("两份逐行相同的实现被识别为孪生对（--report 出清单）", ({ repo }) => {
    writeModule(repo, "src/a.ts", 80, "x");
    writeTwin(repo, "src/b.ts", "src/a.ts");
    const { output } = repo.run(["--report"]);
    expect(output).toContain("src/a.ts");
    expect(output).toContain("src/b.ts");
    // 改名后行文本一致 → 比例应是 100%
    expect(output).toContain("100.0%");
  });

  test("任何一对孪生都阻断（无「已登记的存量」这一档）", ({ repo }) => {
    writeModule(repo, "src/a.ts", 80, "x");
    writeTwin(repo, "src/b.ts", "src/a.ts");
    const { code, output } = repo.run();
    expect(code).toBe(1);
    expect(output).toContain("跨文件孪生");
    expect(output).toContain("src/a.ts");
  });

  test("结构相似但逐行不同不报（阈值挡住误报）", ({ repo }) => {
    writeModule(repo, "src/a.ts", 80, "x");
    writeModule(repo, "src/b.ts", 80, "y"); // 行文本完全不同
    const { code, output } = repo.run(["--report"]);
    expect(code).toBe(0);
    expect(output).toContain("（无）");
  });

  test("小文件不进比较（5 行的样板工具「全都一样」没有意义）", ({ repo }) => {
    writeModule(repo, "src/a.ts", 10, "x");
    writeTwin(repo, "src/b.ts", "src/a.ts");
    const { output } = repo.run(["--report"]);
    expect(output).toContain("（无）");
  });

  test("测试文件不算重复源（用例之间大量雷同是正常的）", ({ repo }) => {
    writeModule(repo, "src/a.ts", 80, "x");
    writeTwin(repo, "src/a.test.ts", "src/a.ts");
    const { output } = repo.run(["--report"]);
    expect(output).toContain("（无）");
  });

  test("注释与缩进差异不算差异（归一化后仍判为孪生）", ({ repo }) => {
    writeModule(repo, "src/a.ts", 80, "x");
    // 同一份实现：加注释、改缩进、加空行
    const src = repo.read("src/a.ts");
    const decorated = src
      .split("\n")
      .map((l) => `// 说明\n  ${l}\n`)
      .join("");
    repo.write("src/b.ts", decorated);
    const { output } = repo.run(["--report"]);
    expect(output).toContain("100.0%");
  });

  /* 硬闸：没有基线、也没有 --update / --strict 通道 —— 孪生对的存量已清零后，
   * 棘轮那两层只剩开销，还留了一个「手改基线把新孪生对登记成已知存量」的口子。 */
  test("硬闸：--update 不写任何基线文件", ({ repo }) => {
    writeModule(repo, "src/a.ts", 80, "x");
    expect(repo.run(["--update"]).code).toBe(0);
    expect(existsSync(join(repo.dir, "scripts", ".code-duplication-baseline.json"))).toBe(false);
  });
});
