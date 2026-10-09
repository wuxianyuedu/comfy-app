/**
 * 全局 setup 里的 **RTL 逐用例卸载**真的注册上了吗（§11.17 / §12.18）。
 *
 * 动因：这行注册在本仓库**长期是死的**，而且死得完全静默。
 * `@testing-library/react` 只在「**那一刻 `afterEach` 是函数**」时才注册自动清理
 * —— 源码里就是一行 `if (typeof afterEach === "function") { afterEach(cleanup); }`
 * —— 而本仓库 `globals: false`（`vitest.config.ts`）
 * ⇒ `globalThis.afterEach` 是 `undefined` ⇒ 那行 `if` 从不成立、清理**从不发生**。
 *
 * 后果不是「少卸载一次」这么轻：一次用例里挂上的组件会留到同文件的下一条用例，
 * 其间 React scheduler 还排着的活（`setImmediate`）会在 jsdom 环境被拆掉之后落地
 * —— 现场是一句 `ReferenceError: window is not defined`，它**不是**任何一条用例的
 * 断言红，而是被打成全量跑的 **unhandled error**、把 `pnpm test` 的退出码打成非零。
 * 也就是「红指向的东西不是判据」（同 §11.13 里那两条同样形态的读数）。
 *
 * 判据形状：**不能纯文本判**。「`tests/setup.ts` 里出现过 `cleanup`」与「清理真的
 * 注册上了」是两件事 —— 前者在把注册挪进一个永远不执行的 `if` 里时照样为真。
 * 所以这里**起一份最小用例**（`vitest run`）去真跑：探针用例内挂一个组件，同文件
 * 下一条用例断言它已被卸载。清理没注册时挂载的容器会留在 `document.body` 里。
 * 这同时把「文件写入端」的错也照出来（`setup.ts` 挂不上、或 `setupFiles` 指错）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 探针：前一条挂组件、后一条查它还在不在 `document.body` 里。 */
const PROBE = `import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

describe("清理探针", () => {
  it("挂一个组件", () => {
    render(<div data-probe="mounted">x</div>);
    expect(document.body.querySelector('[data-probe="mounted"]')).not.toBeNull();
  });

  it("上一条挂的组件不该还在（清理在跑）", () => {
    expect(document.body.querySelector('[data-probe="mounted"]')).toBeNull();
  });
});
`;

/**
 * 探针必须写在**仓库树内**：`vitest.config.ts` 两个 project 的 `include` 都是
 * `src/**` / `tests/**`，树外的一份临时文件会被 `No test files found` 过滤掉
 * （实测过），于是探针会以「没跑」的形态给出假绿。
 */
function runProbe(): { code: number; output: string } {
  const file = path.join(
    ROOT,
    "tests",
    `.setup-cleanup-probe-${process.pid}-${Date.now()}.test.tsx`,
  );
  fs.writeFileSync(file, PROBE, "utf8");
  try {
    const output = execFileSync(
      process.execPath,
      [
        path.join(ROOT, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "--config",
        path.join(ROOT, "vitest.config.ts"),
        "--root",
        ROOT,
        "--no-file-parallelism",
        file,
      ],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (error) {
    const e = error as { status?: number | null; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : -1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

describe("全局 setup 的 RTL 逐用例卸载", () => {
  it("真的注册上了：挂载的组件在下一条用例里已经不在（量具没坏）", () => {
    const { code, output } = runProbe();
    expect(
      code,
      `探针用例应当全绿 —— 红了说明全局清理没生效：\n${output}`,
    ).toBe(0);
    /* 探针确实**跑到了**（不是「被过滤掉、零用例」的假绿）——两条用例都绿。 */
    expect(output, "探针确实跑了两条用例").toMatch(/2\s+passed/);
  });

  it("setup 文件确实登记在根 `test.setupFiles` 上（不靠分辨率猜）", () => {
    const root = fs.readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    expect(root, "共享 setup 该声明在根 `test` 上").toContain(
      '"tests/setup.ts"',
    );
  });
});
