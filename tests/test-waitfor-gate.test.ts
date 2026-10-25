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
 * 还钉**夹具自己**的形状（ISSUE #2329）：`gate()` 交出 `ran / status / code / signal / output`
 * 五件，**不许**把「判出越界」与「脚本没跑起来」折成一个布尔 —— 后者的退出码也是 1
 * （node 报 `Cannot find module`），只看退出码必然误判。正反两格都在最后一节里。
 */
import { spawnSync } from "node:child_process";
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

/**
 * 起一次判据，把**三件事实分开**交出去（ISSUE #2329）。
 *
 * 旧写法是 `execFileSync` 包 `try/catch` 折成一个 `ok: boolean`，于是下面三类失败
 * 在账面上逐字同形 —— 而它们的下一动作完全不同：
 *   ① 判据跑完了、**判出越界**（退出码 1，这是本文件想判的事）；
 *   ② 判据**根本没跑起来**：`ENOENT`（node 自身起不来）/ `ENOBUFS`（默认 `maxBuffer`
 *      1MB，输出超限就抛）/ 被子进程信号杀 ⇒ `error` 有值或 `status` 是 `null`；
 *   ③ 子进程起来了但脚本没跑到判据：**node 报 `Cannot find module` 退的也是 1**，
 *      与①同码 —— 所以只看退出码**必然误判**（`scripts/base-check.mjs` 对这一族
 *      已经写过同一句：`Tests no tests` / `Cannot find package|module` /
 *      `ERR_MODULE_NOT_FOUND` 那一档要单独判「没跑起来」）。
 * `output` 一律是两条流拼在一起（#2287 的口径：失败时哪一条有内容没人知道）。
 */
const NOT_STARTED_RE =
  /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|ENOBUFS|maxBuffer|heap out of memory/i;

function gate(
  files: Record<string, string>,
  args: string[] = [],
  deps: { entry?: string } = {},
): {
  ran: boolean;
  status: number | null;
  code: string | null;
  signal: string | null;
  output: string;
} {
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
  const entry =
    deps.entry ?? path.join(root, "scripts", "check-test-waitfor.cjs");
  const res = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const err = res.error;
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return {
    ran: !err && typeof res.status === "number" && !NOT_STARTED_RE.test(output),
    status: res.status ?? null,
    /* `error.message` 而不是 `error.code`：Node 的 spawn 失败把 `ENOENT` / `ENOBUFS`
       写在消息开头（`ENOENT: no such file or directory, spawn …`），而 `code` 在
       `SpawnSyncReturns.error` 的声明类型上并不存在 —— 取它会让 tsc 与 lint 各说一套。 */
    code: err ? err.message.slice(0, 80) : null,
    signal: res.signal ?? null,
    output,
  };
}

/**
 * 「没跑起来」必须先被单独判掉 —— 它既不许被读成「判据红了」，也不许被读成
 * 「这个形状放行了」（§13.6.4：拿不到测量 ≠ 测量结果是红的）。
 * 失败消息里把退出码、`error.code`、信号与两条流原值一起交出去。
 */
function expectRan(r: {
  ran: boolean;
  status: number | null;
  code: string | null;
  signal: string | null;
  output: string;
}): void {
  expect(
    r.ran,
    `判据脚本**没跑起来**（status=${String(r.status)} · code=${String(r.code)} · ` +
      `signal=${String(r.signal)}）⇒ 这一格不构成判决，不是判据红。\n` +
      `--- 子进程两条流原值 ---\n${r.output}`,
  ).toBe(true);
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
    expectRan(r);
    expect(r.status, r.output).toBe(1);
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
    expectRan(r);
    expect(r.status, r.output).toBe(0);
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
    expectRan(r);
    expect(r.status, r.output).toBe(0);
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
    expectRan(r);
    expect(r.status, r.output).toBe(0);
    expect(r.output).toContain("越界 0 处");
  });

  it("⑤ 判据自己的夹具文件 → 跳过（FIXTURE_SKIP）", () => {
    const r = gate({
      "tests/test-waitfor-gate.test.ts": `${RTL}it("x", async () => {
  await waitFor(() => expect(v).toBe(1));
});
`,
    });
    expectRan(r);
    expect(r.status, r.output).toBe(0);
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

/**
 * 夹具自己的形状 —— 这一节是 #2329 的**正反两半**：
 * 「没跑起来」与「判出越界」在退出码上**同形**（node 报 `Cannot find module` 也退 1），
 * 所以只判退出码必然误判；两半各钉一格，防止有人为了「让红少响」把两边一起判掉。
 */
describe("夹具自己的形状：「没跑起来」与「判红」不许同形（ISSUE #2329）", () => {
  it("脚本取不到 ⇒ 退出码同样是 1，但这一格 ran=false（不是判据红）", () => {
    const r = gate({}, [], {
      entry: path.join(SCRIPTS_DIR, "check-test-waitfor-no-such-file.cjs"),
    });
    /* 先钉「为什么只看退出码不够」：这一格与上面 ① 那一格的 `status` 逐字相同。 */
    expect(r.status, r.output).toBe(1);
    expect(r.ran, r.output).toBe(false);
    expect(r.output).toContain("Cannot find module");
    /* 而且没跑起来时 `code` / `signal` 得能自证「不是被杀、不是 spawn 失败」，
       否则下一次又要靠翻整份日志猜。 */
    expect(r.code, `spawn 的 error 应为空，收到 ${String(r.code)}`).toBeNull();
    expect(r.signal, `不该是被信号杀，收到 ${String(r.signal)}`).toBeNull();
  });

  it("真判红那一侧仍然 ran=true ⇒ 两格没被同一条规则一起判掉", () => {
    const r = gate({
      "src/a.test.ts": `${RTL}it("x", async () => {
  await waitFor(() => expect(v).toBe(1));
});
`,
    });
    expectRan(r);
    expect(r.status, r.output).toBe(1);
    expect(r.output).toContain("越界：1 处");
  });
});
