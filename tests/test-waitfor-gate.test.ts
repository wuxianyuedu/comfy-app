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
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { copyGateDeps } from "./helpers/gate-repo";

const SCRIPTS_DIR = path.resolve(__dirname, "../scripts");
const SCRIPT = path.join(SCRIPTS_DIR, "check-test-waitfor.cjs");
/** 判据复用 `check-test-concurrency.cjs` 导出的 `maskNonCode`，临时仓库要一起带上。 */
const DEP = path.join(SCRIPTS_DIR, "check-test-concurrency.cjs");

/**
 * 「文件在扫描期间消失」那一支只能在**进程内**判：它要的是 `scanFile` 对一份
 * 读不到的路径返回什么，而临时仓库 + 子进程那条路造不出「列到名字、读时已没」
 * 这个时刻（造得出就只能靠删文件，那是一次概率窗口，不是判据）。
 */
const { scanFile } = createRequire(import.meta.url)(SCRIPT) as {
  scanFile: (abs: string) => unknown[] | null;
};

function gate(
  files: Record<string, string>,
  args: string[] = [],
): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "test-waitfor-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const src of [SCRIPT, DEP]) {
    copyFileSync(src, path.join(root, "scripts", path.basename(src)));
    copyGateDeps(path.join(root, "scripts", path.basename(src)));
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

describe("waitFor 边界门禁：扫描期间文件消失（并发探针）", () => {
  it("读不到的文件返回 null，而不是把整个 D 组带崩", () => {
    /* 现场：`tests/global-setup-cleanup.test.ts` 会在 `tests/` 下临时造
       `.setup-cleanup-probe-<pid>-<ts>.test.tsx` 再删掉。同一份工作树里有两个
       vitest 在跑时（并行会话，或本钩子的 C 组还没退干净），本判据就会
       **「列到名字、读时已经没了」** —— 于是 D 组不是报出站点，而是带着一个
       Node 栈崩掉（`ENOENT … .setup-cleanup-probe-….test.tsx`），表现成
       「提交被拦下、报错里没有一个字指向改动」。
       一个已经不存在的文件没有站点可言 ⇒ 返回 null 让调用方计数；
       计数必须进结论行（`collect` 的 `vanished` 与 OK 那行的「另有 N 份未读」），
       静默跳过就是 §13.5.12 那一族「判据自称在跑、实际没跑」。 */
    const gone = path.resolve(
      __dirname,
      "..",
      "tests",
      `.setup-cleanup-probe-0-0.test.tsx`,
    );
    expect(existsSync(gone), "夹具路径本身不该存在").toBe(false);
    expect(scanFile(gone)).toBeNull();
  });
});
