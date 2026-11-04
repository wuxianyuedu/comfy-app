/**
 * 全局 setup 里的 **RTL 逐用例卸载**真的注册上了吗（§11.17 / §12.18）。该注册在本仓**长期是死的、且死得完全静默**：`@testing-library/react` 只在「那一刻 `afterEach` 是函数」时才注册自动清理（源码 `if (typeof afterEach === "function") { afterEach(cleanup); }`），而本仓 `globals: false` ⇒ `globalThis.afterEach` 是 `undefined` ⇒ 那行 `if` 从不成立、清理**从不发生**。
 * 后果不只「少卸载一次」：组件留到同文件下一条用例，React scheduler 还排着的活（`setImmediate`）在 jsdom 环境被拆掉之后落地——现场 `ReferenceError: window is not defined`，它**不是**任何一条用例的断言红，而是被打成全量跑的 **unhandled error**、把 `pnpm test` 退出码打成非零（「红指向的东西不是判据」，同 §11.13）。
 * 判据**不能纯文本判**（「`tests/setup.ts` 里出现过 `cleanup`」与「清理真的注册上了」是两件事），所以起一份最小用例真跑（`vitest run`）：探针用例内挂一个组件，同文件下一条断言它已被卸载（清理没注册时挂载容器会留在 `document.body`）；这同时把「文件写入端」的错也照出来（`setup.ts` 挂不上、或 `setupFiles` 指错）。
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

  /* 第三条钉的是「DOM 栈在 DOM 档**接得上**」：jest-dom 的匹配器由
   * \`tests/setup.dom.ts\` 注册，而那份是按「有没有 document」动态载的 ——
   * 条件写反、或载的时机挪到用例之后，这一条就会红（前两条则红在「清理没跑」）。 */
  it("DOM 档拿得到 jest-dom 匹配器", () => {
    expect(expect).toHaveProperty("toBeInTheDocument");
  });
});
`;

/**
 * node 档的反向探针：DOM 测试栈**不该**被载进来。`tests/setup.ts` 此前静态 import RTL + jest-dom，node 档（面最大那一档）每份文件都要把它们载一遍 ——
 * 同一批 60 份最便宜的 node 档文件实测 `Duration 25.69s (setup 70% …)`，改成按 `document` 条件加载后是 `12.22s (setup 8%)`。为什么真跑一份 node 档探针
 * 而不是读 `setup.ts` 的文本：本文件头就写着**纯文本判不住**，反过来也一样 —— 文本里没有 `import "@testing-library/jest-dom/vitest"` 可以是静态 import 换成了 `require`、也可以是 dynamic import 被 vite 提前解析；看**结果**（匹配器在不在 `expect` 上）才对应到那笔装载到底发生没发生。
 */
const NODE_PROBE = `import { expect, it } from "vitest";

it("node 档不载 DOM 测试栈", () => {
  expect(globalThis.document).toBeUndefined();
  expect(expect).not.toHaveProperty("toBeInTheDocument");
});
`;

/**
 * 探针必须写在**仓库树内**：`vitest.config.ts` 两个 project 的 `include` 都是 `src/**` / `tests/**`，树外的一份临时文件会被 `No test files found`
 * 过滤掉（实测过），于是探针会以「没跑」的形态给出假绿。`name` 决定探针落进哪一档：`.test.tsx` 被 `DOM_TEST_GLOBS` 接走（DOM 档）、`.test.ts` 留在 node 档 ——
 * 两档的 include/exclude 是同一份 glob 的两面，所以「写哪个扩展名」就是「测哪一档」，不另配 `--project`（那等于在这里重抄一遍归属判据，漂移是静默的）。
 */
function runProbe(source: string, name: string): { code: number; output: string } {
  const file = path.join(
    ROOT,
    "tests",
    `.setup-cleanup-probe-${process.pid}-${Date.now()}.${name}`,
  );
  fs.writeFileSync(file, source, "utf8");
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
    /* SAFETY: 类型断言已复核 */
    const e = error as {
      status?: number | null;
      stderr?: string;
      stdout?: string;
    };
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
    const { code, output } = runProbe(PROBE, "test.tsx");
    expect(code, `探针用例应当全绿 —— 红了说明全局清理没生效：\n${output}`).toBe(0);
    /* 探针确实**跑到了**（不是「被过滤掉、零用例」的假绿）——三条用例都绿。 */
    expect(output, "探针确实跑了三条用例").toMatch(/3\s+passed/);
  });

  /* 这一条钉的是这次省下来的那笔钱：`tests/setup.ts` 只在有 `document` 时才载
   * DOM 测试栈。谁把它写回静态 import，node 档那 422 份文件就每人重新载一遍 ——
   * 而这件事**不会有任何用例报错**（多载一份匹配器不改变任何断言），
   * 所以只能在这里正面判「node 档拿不到它」。 */
  it("node 档不载 DOM 测试栈（装载税不再回来）", () => {
    const { code, output } = runProbe(NODE_PROBE, "test.ts");
    expect(code, `node 档探针应当全绿 —— 红了说明 DOM 测试栈被载进了 node 档：\n${output}`).toBe(0);
    expect(output, "探针确实跑了一条用例").toMatch(/1\s+passed/);
  });

  it("setup 文件确实登记在根 `test.setupFiles` 上（不靠分辨率猜）", () => {
    const root = fs.readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
    expect(root, "共享 setup 该声明在根 `test` 上").toContain('"tests/setup.ts"');
  });
});
