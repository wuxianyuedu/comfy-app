/**
 * 「按环境跳过的那一组，得说得出**为什么**」判据的自测（ISSUE #2316）。
 *
 * 判据本体是 `scripts/check-skip-probe-readings.mjs`：凡是「这台机器上没有某个工具 ⇒
 * 这一组跳过」的站点，都必须把**逐候选的读数**打出来。没有那一行，下一次只能看到一片
 * `skipped`，说不出「安静地跳过了」还是「安静地判错了」—— 而两种的下一动作完全不同
 * （去装 / 改探测）。
 *
 * 这一份钉三件事：**该拦的拦**（有站点没读数）、**该放的放**（有站点有读数 / 压根没有
 * 站点）、以及**判据不是空转**（扫描面里真有两个站点 —— 零站点时它已经什么都不保了，
 * 那正是它自己报的那一句）。
 *
 * ⚠️ 用 `defineGateRepo`（§11.16.1）：临时仓库样板只有一份实现，别在这儿手搓第二份。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { defineGateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-skip-probe-readings.mjs",
  workdir: "skip-probe-readings",
  /* 两个扫描根都要在：判据把「扫描根不存在」判成**故障**（不是「没有站点」）——
   * 那是它自己的地板口径（读不到输入 ≠ 没有问题），所以沙箱得把空目录建出来。 */
  dirs: ["src", "tests"],
  /* 共享读取器（`walkForScan` / `readForScan`）必须一起带进沙箱：少带时判据在临时
   * 仓库里直接 `ERR_MODULE_NOT_FOUND`，用例读到的是「门禁坏了」而不是「夹具缺一块」。 */
  copy: [{ from: "scripts/gate-scan-read.cjs", to: "scripts/gate-scan-read.cjs" }],
});

/** 一个最小测试文件：`probe` 处填探测站点的写法（空串 = 没有站点）。 */
function testFile(probe: string, reading: boolean): string {
  return [
    'import { it } from "vitest";',
    "",
    probe,
    reading ? "console.log(describeProbeMisses([]));" : "",
    'it("x", () => {});',
    "",
  ].join("\n");
}

test("有探测站点、没打逐候选读数 ⇒ 拦下", ({ repo }) => {
  repo.write(
    "tests/probe.test.ts",
    testFile('const exe = firstRunnable(["a"], () => [], probe);', false),
  );
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("tests/probe.test.ts");
  expect(output).toContain("describeProbeMisses");
});

test("站点与读数都在 ⇒ 放行（判据不是「有站点就红」）", ({ repo }) => {
  repo.write(
    "tests/probe.test.ts",
    testFile('const exe = firstRunnable(["a"], () => [], probe);', true),
  );
  const { code, output } = repo.run();
  expect(code).toBe(0);
  expect(output).toContain("1 个");
});

test("一个站点都没有 ⇒ 判据自己报「空转」，因为那保不住任何东西", ({ repo }) => {
  repo.write("tests/plain.test.ts", testFile("", false));
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("空转");
});

test("`--report` 只出清单、不改退出码（盘点用）", ({ repo }) => {
  repo.write(
    "tests/probe.test.ts",
    testFile('const exe = firstRunnable(["a"], () => [], probe);', false),
  );
  const { code, output } = repo.run(["--report"]);
  expect(code).toBe(0);
  expect(output).toContain("✗");
});

test("本仓库的扫描面里真有两个探测站点（这两格是登记过的，见 ISSUE #2316）", () => {
  /* 反向「量具没坏」：判据在一个没有站点的沙箱里会自己报空转；这一条判**真仓库**上
   * 它确实读到了那两个站点 —— 否则「[ok] N 个」那一行是空的，什么都没保住。 */
  const out = execFileSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "check-skip-probe-readings.mjs")],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  expect(out).toMatch(/\[ok\] [1-9]\d* 个/);
});
