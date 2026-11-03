/**
 * 「测试层 `waitFor` / `expect.poll` 边界」门禁自测（规范 §11.14.3）。
 *
 * 本文件自己**不进扫描面**（`scripts/check-test-waitfor.cjs` 的 `FIXTURE_SKIP`）：
 * 下面的被测字符串里就有真的 `await waitFor(...)`，判它等于判自己的量具
 * （§11.14.2 的通用口径，同 `tests/test-sleep-gate.test.ts` 的取舍）。
 *
 * 逐条钉判定口径：
 *   ① 等**值** → 越界（该拦）
 *   ② 等 **DOM**（jest-dom 匹配器）→ 正当（该放）
 *   ③ 假定时器窗口内 → 正当（该放）
 *   ④ 本地同名 helper → 整文件不看（该放）
 *   ⑤ 判据自己的夹具文件 → 跳过
 *
 * ## 夹具自己那一节搬走了（#2329 → #2405）
 *
 * 这里曾经是 `ran / status / spawnError / signal / output` 那五件的**参照实现**：
 * `gate()` 写在本文件里，把「判出越界」与「脚本没跑起来」分开交。#2405 的立案现场
 * 正是这一族的第 17 份副本 —— 别人抄走时把三件事折成一个布尔，于是「夹具没配齐」
 * （node 报 `Cannot find module`，退的**也是 1**）被读成「门禁拦了本该放行的形状」。
 * 实现现在只有一处（`tests/helpers/gate-repo.ts`），**契约的两格正反例跟着实现走**，
 * 见 `tests/gate-repo-run-facts.test.ts`；本文件自此只判 §11.14.3 的站点口径，
 * 不再判量具 —— 量具的契约散在被测文件里，正是「第十五份抄错时没人响」的形状。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineGateRepo, describe, expectGateRan } from "./helpers/gate-repo";

const SCRIPT = path.resolve(__dirname, "../scripts/check-test-waitfor.cjs");

/**
 * 「文件在扫描期间消失」那一支只能在**进程内**判：它要的是 `scanFile` 对一份
 * 读不到的路径返回什么，而临时仓库 + 子进程那条路造不出「列到名字、读时已没」
 * 这个时刻（造得出就只能靠删文件，那是一次概率窗口，不是判据）。
 */
/* SAFETY: 类型断言已复核 */
const { scanFile } = createRequire(import.meta.url)(SCRIPT) as {
  scanFile: (abs: string) => Array<unknown> | null;
};

const { test, expect } = defineGateRepo({
  script: "check-test-waitfor.cjs",
  dirs: ["src"],
  workdir: "test-waitfor",
});

const RTL = 'import { renderHook, waitFor } from "@testing-library/react";\n';

describe("waitFor 边界门禁：该拦的形状（§11.14.3）", () => {
  test("① 等的是某个值 → 阻断，并点名站点", ({ repo }) => {
    repo.write(
      "src/a.test.ts",
      `${RTL}it("x", async () => {
  const result = { current: { v: 0 } };
  await waitFor(() => expect(result.current.v).toBe(1));
});
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(1);
    expect(r.output).toContain("越界：1 处");
    expect(r.output).toContain("src/a.test.ts");
    expect(r.output).toContain("§11.14.3");
  });
});

describe("waitFor 边界门禁：该放的形状（§11.14.3）", () => {
  test("② 等 DOM（jest-dom 匹配器）→ 通过", ({ repo }) => {
    repo.write(
      "src/a.test.ts",
      `${RTL}it("x", async () => {
  await waitFor(() => expect(el).toBeInTheDocument());
});
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("等 DOM 1");
  });

  test("③ 假定时器窗口内 → 通过", ({ repo }) => {
    repo.write(
      "src/a.test.ts",
      `import { vi } from "vitest";
${RTL}it("x", async () => {
  vi.useFakeTimers();
  try {
    await waitFor(() => expect(result.current.running).toBe(false));
  } finally {
    vi.useRealTimers();
  }
});
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("假定时器窗口 1");
  });

  test("④ 本地同名 helper（不是 RTL 导入的）→ 整文件不看", ({ repo }) => {
    repo.write(
      "src/a.test.ts",
      `async function waitFor(pred: () => boolean) {
  await pred();
}
it("x", async () => {
  await waitFor(() => true);
});
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("越界 0 处");
  });

  test("⑤ 判据自己的夹具文件 → 跳过（FIXTURE_SKIP）", ({ repo }) => {
    repo.write(
      "tests/test-waitfor-gate.test.ts",
      `${RTL}it("x", async () => {
  await waitFor(() => expect(v).toBe(1));
});
`,
    );
    const r = repo.run();
    expectGateRan(r);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("越界 0 处");
  });
});

describe("waitFor 边界门禁：扫描期间文件消失（并发探针）", () => {
  test("读不到的文件返回 null，而不是把整个 D 组带崩", () => {
    /* 现场：`tests/global-setup-cleanup.test.ts` 会在 `tests/` 下临时造
       `.setup-cleanup-probe-<pid>-<ts>.test.tsx` 再删掉。同一份工作树里有两个
       vitest 在跑时（并行会话，或本钩子的 C 组还没退干净），本判据就会
       **「列到名字、读时已经没了」** —— 于是 D 组不是报出站点，而是带着一个
       Node 栈崩掉（`ENOENT … .setup-cleanup-probe-….test.tsx`），表现成
       「提交被拦下、报错里没有一个字指向改动」。
       一个已经不存在的文件没有站点可言 ⇒ 返回 null 让调用方计数；
       计数必须进结论行（`collect` 的 `vanished` 与 OK 那行的「另有 N 份未读」），
       静默跳过就是 §13.5.12 那一族「判据自称在跑、实际没跑」。 */
    const gone = path.resolve(__dirname, "..", "tests", `.setup-cleanup-probe-0-0.test.tsx`);
    expect(existsSync(gone), "夹具路径本身不该存在").toBe(false);
    expect(scanFile(gone)).toBeNull();
  });
});
