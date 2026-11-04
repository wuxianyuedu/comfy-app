/**
 * 基础设施层文件长度**硬闸**自检：把 `scripts/check-infra-file-size.cjs` 当黑盒跑在临时工作区，验证它真能按 900 行认出超限文件、且翻闸后不再有任何登记通道（规范 §12.6 R5 姊妹档 / §12.13）。
 * 为什么硬闸：R5/函数长度/非空断言/孪生对的扫描根只有 `src`，判据自己（`scripts/**` 的 .cjs/.mjs 与 `tools/**` 的 .ps1）本在硬闸之外 —— 判据长到读不动时表现是「恒绿」而不是报错；存量已在 ISSUE #1811 第五刀清零，棘轮在 0 上只剩「手改 JSON 登记」一条通道。
 * 出口只有一个：拆。
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe } from "vitest";
import { defineGateRepo, type GateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-infra-file-size.cjs",
  /* 扫描面是两层：`scripts/`（.cjs/.mjs）与 `tools/`（.ps1）。 */
  dirs: ["scripts", "tools"],
});

/** 工作区里现存的基线 JSON（递归找 `scripts/` 下 `*.json`）。 */
function globBaselines(root: string): Array<string> {
  const dir = join(root, "scripts");
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).filter((name) => name.endsWith(".json"));
}

/** 造一份 `n` 行的 `.cjs`（阈值 900，取 905 确保越线）。 */
function writeBig(repo: GateRepo, n = 905): void {
  repo.write("scripts/big.cjs", `${"// 拆分候选\n".repeat(n)}module.exports = 1;\n`);
}

describe("check-infra-file-size 硬闸", () => {
  test("900 行以内全绿（`--report` 只出清单，判定档也退 0）", ({ repo }) => {
    repo.write("scripts/small.cjs", "module.exports = 1;\n".repeat(100));
    expect(repo.run().code).toBe(0);
    const report = repo.run(["--report"]);
    expect(report.code).toBe(0);
    expect(report.output).toMatch(/scripts\/\*\*/);
  });

  test("超 900 行即阻断，且点出是哪一份、多少行", ({ repo }) => {
    writeBig(repo);
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/scripts\/big\.cjs/);
    expect(r.output).toMatch(/90[0-9] 行/);
  });

  test("`tools/**` 的 `.ps1` 同判（不是只扫 scripts/）", ({ repo }) => {
    repo.write("tools/start/Big.ps1", 'Write-Host "x"\n'.repeat(905));
    const r = repo.run();
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/tools\/start\/Big\.ps1/);
  });

  test("`--update` 这个出口**已经不存在**：传了也照样按判定档判（断头用例）", ({ repo }) => {
    /* 翻硬闸时最容易漏的一件事：把 `--update` 的**分支**删了，却留着它的**参数
     * 契约** —— 下一个人照旧跑 `--update` 以为能把违规登记成存量，而脚本默默按
     * 判定档退 1。这里正面钉住：传 `--update` 时既**不**落盘任何 JSON，
     * 也**不**放宽判定。 */
    writeBig(repo);
    const r = repo.run(["--update"]);
    expect(r.code).toBe(1);
    expect(globBaselines(repo.dir)).toEqual([]);
  });
});
