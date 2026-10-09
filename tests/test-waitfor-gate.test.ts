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
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPTS_DIR = path.resolve(__dirname, "../scripts");
const SCRIPT = path.join(SCRIPTS_DIR, "check-test-waitfor.cjs");
/** 判据复用 `check-test-concurrency.cjs` 导出的 `maskNonCode`，临时仓库要一起带上。 */
const DEP = path.join(SCRIPTS_DIR, "check-test-concurrency.cjs");

function gate(
  files: Record<string, string>,
  args: string[] = [],
): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "test-waitfor-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const src of [SCRIPT, DEP]) {
    copyFileSync(src, path.join(root, "scripts", path.basename(src)));
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const entry = path.join(root, "scripts", "check-test-waitfor.cjs");
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [entry, ...args], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const RTL = 'import { renderHook, waitFor } from "@testing-library/react";\n';

describe("waitFor 边界门禁：该拦的形状（§11.14.3）", () => {
  it("① 等的是某个值 → 阻断，并点名站点", () => {
    const r = gate({
      "src/a.test.ts": `${RTL}it("x", async () => {
  const result = { current: { v: 0 } };
  await waitFor(() => expect(result.current.v).toBe(1));
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("越界：1 处");
    expect(r.output).toContain("src/a.test.ts");
    expect(r.output).toContain("§11.14.3");
  });
});

describe("waitFor 边界门禁：该放的形状（§11.14.3）", () => {
  it("② 等 DOM（jest-dom 匹配器）→ 通过", () => {
    const r = gate({
      "src/a.test.ts": `${RTL}it("x", async () => {
  await waitFor(() => expect(el).toBeInTheDocument());
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("等 DOM 1");
  });

  it("③ 假定时器窗口内 → 通过", () => {
    const r = gate({
      "src/a.test.ts": `import { vi } from "vitest";
${RTL}it("x", async () => {
  vi.useFakeTimers();
  try {
    await waitFor(() => expect(result.current.running).toBe(false));
  } finally {
    vi.useRealTimers();
  }
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("假定时器窗口 1");
  });

  it("④ 本地同名 helper（不是 RTL 导入的）→ 整文件不看", () => {
    const r = gate({
      "src/a.test.ts": `async function waitFor(pred: () => boolean) {
  await pred();
}
it("x", async () => {
  await waitFor(() => true);
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("越界 0 处");
  });

  it("⑤ 判据自己的夹具文件 → 跳过（FIXTURE_SKIP）", () => {
    const r = gate({
      "tests/test-waitfor-gate.test.ts": `${RTL}it("x", async () => {
  await waitFor(() => expect(v).toBe(1));
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("越界 0 处");
  });
});
