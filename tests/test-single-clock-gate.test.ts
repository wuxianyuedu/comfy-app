/**
 * 「一个用例一把时钟」门禁自测（规范 11 §11.14）。
 *
 * 这个判据的价值全在**边界**上：它必须拦下两种真会坏的形状（同一格里两把时钟、
 * `expect.poll` 落在假时钟窗口内），又必须放过三种**看着像但不是**的形状 ——
 * 挂载发生在换时钟之前（全仓还剩 1 处，是正当的）、假时钟开在隔壁 `describe` 的
 * `beforeEach` 里、以及注释里讲这些 API 的散文。放过与拦下各钉一格，
 * 否则任何一侧松掉都会静默变成「判据在空跑」。
 *
 * 本文件自己**不进扫描面**（`scripts/check-test-single-clock.cjs` 的 `FIXTURE_SKIP`）：
 * 下面的被测字符串里就有真的 `expect.poll`，判它等于判自己的量具（§11.14.2）。
 */
import { defineGateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-test-single-clock.cjs",
  dirs: ["src", "tests"],
  workdir: "single-clock",
});

/** 临时工作区里放一份用例文件（路径随用例变，内容就是要被扫的东西）。 */
function caseFile(body: string) {
  return {
    "src/a/b.test.ts": `import { describe, expect, it, vi } from "vitest";\n${body}\n`,
  };
}

test("规则 A：先 `expect.poll` 等墙钟、后开假时钟 ⇒ 阻断并点出是哪一行", ({
  repo,
}) => {
  repo.write(
    "src/a/b.test.ts",
    caseFile(
      'describe("g", () => {\n' +
        '  it("t", async () => {\n' +
        "    await expect.poll(() => 1).toBe(1);\n" +
        "    vi.useFakeTimers();\n" +
        "    vi.advanceTimersByTime(1000);\n" +
        "    vi.useRealTimers();\n" +
        "  });\n" +
        "});",
    )["src/a/b.test.ts"],
  );
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("规则 A");
  expect(output).toContain("src/a/b.test.ts:4");
  expect(output).toContain("同一格里两把时钟");
});

test("规则 A：`await waitFor` 早于换时钟也算墙钟等待 ⇒ 阻断", ({ repo }) => {
  repo.write(
    "src/a/w.test.tsx",
    'import { renderHook, waitFor } from "@testing-library/react";\n' +
      'import { it, vi } from "vitest";\n' +
      'it("t", async () => {\n' +
      "  await waitFor(() => expect(1).toBe(1));\n" +
      "  vi.useFakeTimers();\n" +
      "  vi.useRealTimers();\n" +
      "});\n",
  );
  const { code, output } = repo.run();
  expect(code).toBe(1);
  expect(output).toContain("await waitFor");
});

test("对照：挂载之前就换时钟（正当形状）⇒ 通过", ({ repo }) => {
  repo.write(
    "src/a/ok.test.ts",
    'import { describe, expect, it, vi } from "vitest";\n' +
      'describe("g", () => {\n' +
      '  it("t", async () => {\n' +
      "    vi.useFakeTimers();\n" +
      "    const { result } = ({} as any);\n" +
      "    await vi.advanceTimersByTimeAsync(1000);\n" +
      "    expect(1).toBe(1);\n" +
      "    vi.useRealTimers();\n" +
      "  });\n" +
      "});\n",
  );
  expect(repo.run().code).toBe(0);
});

test("对照：挂载后只走 microtask 落定、再开假时钟 ⇒ 通过（判据**不**管挂载位置）", ({
  repo,
}) => {
  repo.write(
    "src/a/sse.test.ts",
    'import { act, renderHook } from "@testing-library/react";\n' +
      'import { expect, it, vi } from "vitest";\n' +
      'it("t", async () => {\n' +
      "  const { result } = renderHook(() => 0);\n" +
      "  await act(async () => {\n" +
      "    await Promise.resolve();\n" +
      "  });\n" +
      "  vi.useFakeTimers();\n" +
      "  await vi.advanceTimersByTimeAsync(5000);\n" +
      "  expect(result).toBeTruthy();\n" +
      "  vi.useRealTimers();\n" +
      "});\n",
  );
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
});

test("规则 B：`expect.poll` 落在假时钟窗口内 ⇒ 阻断（它不推进假定时器）", ({
  repo,
}) => {
  repo.write(
    "src/a/hang.test.ts",
    'import { beforeEach, describe, expect, it, vi } from "vitest";\n' +
      'describe("g", () => {\n' +
      "  beforeEach(() => {\n" +
      "    vi.useFakeTimers();\n" +
      "  });\n" +
      "  afterEach(() => {\n" +
      "    vi.useRealTimers();\n" +
      "  });\n" +
      '  it("t", async () => {\n' +
      "    await expect.poll(() => 1).toBe(1);\n" +
      "  });\n" +
      "});\n" +
      'import { afterEach } from "vitest";\n',
  );
  const { code, output } = repo.run();
  expect(code, output).toBe(1);
  expect(output).toContain("规则 B");
  expect(output).toContain("不推进假定时器");
});

test("规则 B 的逃生位：体内先还原时钟再 `expect.poll` ⇒ 通过（那是在真实时钟上等）", ({
  repo,
}) => {
  repo.write(
    "src/a/escape.test.ts",
    'import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";\n' +
      'describe("g", () => {\n' +
      "  beforeEach(() => {\n" +
      "    vi.useFakeTimers();\n" +
      "  });\n" +
      "  afterEach(() => {\n" +
      "    vi.useRealTimers();\n" +
      "  });\n" +
      '  it("t", async () => {\n' +
      "    vi.useRealTimers();\n" +
      "    await expect.poll(() => 1).toBe(1);\n" +
      "  });\n" +
      "});\n",
  );
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
});

test("假阳性钉子：假时钟开在**隔壁 describe** 的 beforeEach 里，前一个 describe 体里的 poll 不算", ({
  repo,
}) => {
  repo.write(
    "src/a/two.test.ts",
    'import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";\n' +
      'describe("真实时钟那一组", () => {\n' +
      '  it("t", async () => {\n' +
      "    await expect.poll(() => 1).toBe(1);\n" +
      "  });\n" +
      "});\n" +
      'describe("假时钟那一组", () => {\n' +
      "  beforeEach(() => {\n" +
      "    vi.useFakeTimers();\n" +
      "  });\n" +
      "  afterEach(() => {\n" +
      "    vi.useRealTimers();\n" +
      "  });\n" +
      '  it("u", () => {\n' +
      "    vi.advanceTimersByTime(10);\n" +
      "  });\n" +
      "});\n",
  );
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
});

test("假阳性钉子：注释里讲 `expect.poll` 与 `vi.useFakeTimers()` 不算站点", ({
  repo,
}) => {
  repo.write(
    "src/a/doc.test.ts",
    'import { describe, it, vi } from "vitest";\n' +
      "/* 这里说明一下口径：expect.poll 不会推进假定时器，vi.useFakeTimers() 要在挂载之前换。 */\n" +
      'describe("g", () => {\n' +
      '  it("t", () => {\n' +
      "    vi.advanceTimersByTime(1);\n" +
      "  });\n" +
      "});\n",
  );
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
});

test("`it.each([...])(...)` 的两段式括号：站点在第二段里也要被抓到", ({
  repo,
}) => {
  repo.write(
    "src/a/each.test.ts",
    'import { describe, expect, it, vi } from "vitest";\n' +
      'describe("g", () => {\n' +
      '  it.each([1, 2])("n=%s", async () => {\n' +
      "    await expect.poll(() => 1).toBe(1);\n" +
      "    vi.useFakeTimers();\n" +
      "    vi.useRealTimers();\n" +
      "  });\n" +
      "});\n",
  );
  const { code, output } = repo.run();
  expect(code, output).toBe(1);
  expect(output).toContain("规则 A");
});

test("两份文件各有一处越界 ⇒ 两份都被点名（钉住「共享 `g` 正则跨文件残留 lastIndex」那条死法）", ({
  repo,
}) => {
  const one = (marker: string) =>
    'import { describe, expect, it, vi } from "vitest";\n' +
    `describe("${marker}", () => {\n` +
    '  it("t", async () => {\n' +
    "    await expect.poll(() => 1).toBe(1);\n" +
    "    vi.useFakeTimers();\n" +
    "    vi.useRealTimers();\n" +
    "  });\n" +
    "});\n";
  repo.write("src/a/one.test.ts", one("一"));
  repo.write("src/b/two.test.ts", one("二"));
  const { code, output } = repo.run();
  expect(code, output).toBe(1);
  /* 少了这一格，「全仓只看得到第一份文件」是**绿着**的 —— 而那正是共享游标的失泄形态。 */
  expect(output).toContain("src/a/one.test.ts:4");
  expect(output).toContain("src/b/two.test.ts:4");
});

test("规则 B：窗口开在本体内、之后又出现 expect.poll ⇒ 阻断（同一条规则的另一半）", ({
  repo,
}) => {
  repo.write(
    "src/a/inner.test.ts",
    'import { describe, expect, it, vi } from "vitest";\n' +
      'describe("g", () => {\n' +
      '  it("t", async () => {\n' +
      "    vi.useFakeTimers();\n" +
      "    await vi.advanceTimersByTimeAsync(10);\n" +
      "    await expect.poll(() => 1).toBe(1);\n" +
      "    vi.useRealTimers();\n" +
      "  });\n" +
      "});\n",
  );
  const { code, output } = repo.run();
  expect(code, output).toBe(1);
  expect(output).toContain("规则 B");
  expect(output).toContain("同一格里");
});

test("历史形状原样回放：`try { … } finally { vi.useRealTimers() }` 那一格也要被抓（且不被规则 B 重复计）", ({
  repo,
}) => {
  /* 这就是 #1931 改掉的设置页用例骨架（两条一起放，证明同一文件里两处都被点名）。
   * 关键点：`finally` 里那次 `useRealTimers()` 会让「按源文本算窗口」的写法把窗口
   * 收在还原点之前 —— 而 poll 在窗口之前，只该被规则 A 记一次。 */
  const body = (name: string) =>
    `  it("${name}", async () => {\n` +
    "    const { result } = renderHook(() => 0);\n" +
    "    await expect.poll(() => result).toBeTruthy();\n" +
    "    vi.useFakeTimers();\n" +
    "    try {\n" +
    "      await vi.advanceTimersByTimeAsync(10_000);\n" +
    "    } finally {\n" +
    "      vi.useRealTimers();\n" +
    "    }\n" +
    "  });\n";
  repo.write(
    "src/a/history.test.ts",
    'import { renderHook } from "@testing-library/react";\n' +
      'import { describe, expect, it, vi } from "vitest";\n' +
      'describe("useSettingsPage", () => {\n' +
      body("拉起后轮询到就绪") +
      body("轮询期间状态行停在 starting") +
      "});\n",
  );
  const { code, output } = repo.run();
  expect(code, output).toBe(1);
  /* 数**站点行**，不数「规则 B」这四个字 —— 判据那段解释文案里本来就会出现
   * 「规则 B 更直接：…」，拿 `not.toContain` 判它等于把帮助文本当成违规清单。 */
  const sites = output.match(/✗ \S+:\d+（规则 [AB]）/g) ?? [];
  expect(sites).toHaveLength(2);
  expect(sites.every((s) => s.includes("规则 A"))).toBe(true);
});

test("--report 只出清单不判失败", ({ repo }) => {
  repo.write(
    "src/a/rep.test.ts",
    'import { describe, expect, it, vi } from "vitest";\n' +
      'describe("g", () => {\n' +
      '  it("t", async () => {\n' +
      "    await expect.poll(() => 1).toBe(1);\n" +
      "    vi.useFakeTimers();\n" +
      "    vi.useRealTimers();\n" +
      "  });\n" +
      "});\n",
  );
  const { code, output } = repo.run(["--report"]);
  expect(code).toBe(0);
  expect(output).toContain("越界 1 处（不判失败）");
});

test("判据自己的夹具文件不进扫描面（否则它会在自己的被测字符串上红）", ({
  repo,
}) => {
  repo.write(
    "tests/test-single-clock-gate.test.ts",
    'import { it, vi } from "vitest";\n' +
      'it("t", async () => {\n' +
      "  await expect.poll(() => 1).toBe(1);\n" +
      "  vi.useFakeTimers();\n" +
      "  vi.useRealTimers();\n" +
      "});\n",
  );
  const { code, output } = repo.run();
  expect(code, output).toBe(0);
});
