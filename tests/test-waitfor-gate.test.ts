/**
 * 「测试层 `waitFor` / `expect.poll` 边界」门禁自测（规范 §11.14.3）。本文件不进扫描面（`FIXTURE_SKIP`）：
 * 被测串里就有真 `await waitFor(...)`，判它等于判自己的量具。口径：等值→拦；等 DOM / 假定时器→放；本地同名 helper 整文件不看。
 * 夹具参照实现已搬走（#2329 → #2405）：判越界与「脚本没跑起来」必须分开，实现只在 `helpers/gate-repo.ts`。
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { isRecord } from "~/lib/is-record";

import { defineGateRepo, describe, expectGateRan } from "./helpers/gate-repo";

const SCRIPT = path.resolve(__dirname, "../scripts/check-test-waitfor.cjs");

/** 判据模块的消费形状守卫（B5 清账）：只取 scanFile 一件。 */
function isScanModule(
  value: unknown,
): value is { scanFile: (abs: string) => Array<unknown> | null } {
  return isRecord(value) && typeof value.scanFile === "function";
}

/**
 * 「文件在扫描期间消失」那一支只能在**进程内**判：它要的是 `scanFile` 对一份
 * 读不到的路径返回什么，而临时仓库 + 子进程那条路造不出「列到名字、读时已没」
 * 这个时刻（造得出就只能靠删文件，那是一次概率窗口，不是判据）。
 */
const scanModule: unknown = createRequire(import.meta.url)(SCRIPT);
if (!isScanModule(scanModule)) {
  throw new Error("check-test-waitfor.cjs 缺 scanFile —— 判据脚本形状变了");
}
const { scanFile } = scanModule;

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
    /* 现场：`tests/global-setup-cleanup.test.ts` 会在 `tests/` 下临时造 `.setup-cleanup-probe-*.test.tsx` 再删掉；
       同工作树两个 vitest 并发时（并行会话或 C 组未退干净），本判据会「列到名字、读时已没了」—— D 组带着
       `ENOENT` 栈崩掉，报错里没有一个字指向改动。已不存在的文件没有站点 ⇒ 返回 null 让调用方计数；
       计数必须进结论行（`collect` 的 `vanished`、OK 行的「另有 N 份未读」），
       静默跳过即 §13.5.12 那族「判据自称在跑、实际没跑」。 */
    const gone = path.resolve(__dirname, "..", "tests", `.setup-cleanup-probe-0-0.test.tsx`);
    expect(existsSync(gone), "夹具路径本身不该存在").toBe(false);
    expect(scanFile(gone)).toBeNull();
  });
});
