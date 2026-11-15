/**
 * 「测试层裸 sleep」门禁自测（§11.14）：真脚本 + 临时仓库，判「该拦的拦、该放的放」。①赌时间的裸 setTimeout 拦；
 * ②`sleep-ok: <理由>` 豁免；③空声明同无声明、拦；④字符串/注释站点放行（`maskNonCode`，§11.18.3.1）；
 * ⑤未 await 的 Promise 放行；⑥硬闸命中即阻，`--update`/`--strict` 断头（#1811）。本文件自身在 `FIXTURE_SKIP`。
 */
import { execFileSync } from "node:child_process";
/* `vi.spyOn(fs, …)` 要的是可写对象 ⇒ 必须 default 导入
   （`import * as fs` 在 vitest 5 下是冻结命名空间，spy 会以
   `Cannot redefine property: readdirSync` 当场炸掉 —— 先例见 `tests/db-backup.test.ts`）。 */
import fs, {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { isRecord } from "~/lib/is-record";

import { copyGateDeps } from "./helpers/gate-repo";

const SCRIPTS_DIR = path.resolve(__dirname, "../scripts");
const SCRIPT = path.join(SCRIPTS_DIR, "check-test-sleep.cjs");
/** 判据复用 `check-test-concurrency.cjs` 导出的 `maskNonCode`，临时仓库要一起带上。 */
const DEP = path.join(SCRIPTS_DIR, "check-test-concurrency.cjs");

/**
 * 「文件在扫描期间消失」那一支只能在**进程内**判：它要的是 `scanFile` 对一份
 * 读不到的路径返回什么，而临时仓库 + 子进程那条路造不出「列到名字、读时已没」
 * 这个时刻（造得出就只能靠删文件，那是一次概率窗口，不是判据）。
 */
/** 判据模块的消费形状守卫（B5 清账）：只取 scanFile / walk 两件。 */
function isSleepGateModule(value: unknown): value is {
  scanFile: (abs: string) => Array<unknown> | null;
  walk: (dir: string, out?: Array<string>) => Array<string>;
} {
  return (
    isRecord(value) && typeof value.scanFile === "function" && typeof value.walk === "function"
  );
}

const gateModule: unknown = createRequire(import.meta.url)(SCRIPT);
if (!isSleepGateModule(gateModule)) {
  throw new Error("check-test-sleep.cjs 缺 scanFile / walk —— 判据脚本形状变了");
}
const { scanFile, walk } = gateModule;

/**
 * 在临时仓库里跑真脚本（cwd = 临时仓库根，只放被测文件 + 判据依赖）。翻硬闸后不再写基线：
 * 判据无基线可读、无 `--update` 可写，用例要验「无基线档下会/不会红」。
 * @param files 相对路径 → 内容；@param args 额外参数（如 --update / --report）
 */
function gate(
  files: Record<string, string>,
  args: Array<string> = [],
): { ok: boolean; output: string } {
  const root = mkdtempSync(path.join(tmpdir(), "test-sleep-"));
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
  const entry = path.join(root, "scripts", "check-test-sleep.cjs");
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
    /* 失败形状按字段读（B5 清账）：两股输出缺省当空串。 */
    const e: { stderr?: unknown; stdout?: unknown } =
      typeof error === "object" && error !== null ? error : {};
    const out = typeof e.stdout === "string" ? e.stdout : "";
    const err = typeof e.stderr === "string" ? e.stderr : "";
    return { ok: false, output: `${out}${err}` };
  }
}

const HEAD = 'import { expect, it } from "vitest";\n';

describe("裸 sleep 门禁：该拦的形状（§11.14）", () => {
  it("① 赌时间：裸 sleep 超过基线 → 阻断，并点名站点", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", async () => {
  await new Promise((r) => setTimeout(r, 50));
  expect(1).toBe(1);
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("测试层裸 sleep 1 处");
    expect(r.output).toContain("tests/a.test.ts: 1 处");
    expect(r.output).toContain("§11.14");
  });

  it("③ 空声明：`// sleep-ok:` 后面空着 → 与没有声明等价（阻断）", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", async () => {
  // sleep-ok:
  await new Promise((r) => setTimeout(r, 50));
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("测试层裸 sleep 1 处");
  });

  it("⑥ 两处站点也是阻断（硬闸：没有存量额度）", () => {
    const files = {
      "tests/a.test.ts": `${HEAD}it("x", async () => {
  await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 20));
});
`,
    };
    const blocked = gate(files);
    expect(blocked.ok).toBe(false);
    expect(blocked.output).toContain("裸 sleep 2 处");
  });

  it("⑥ 翻硬闸后 --update / --strict 是断头的（不许有隐藏放宽通道）", () => {
    /* 少了这一格，「删了 --update」与「--update 还在但没人调」看起来一样。 */
    const files = {
      "tests/a.test.ts": `${HEAD}it("x", async () => {
  await new Promise((r) => setTimeout(r, 10));
});
`,
    };
    for (const flag of ["--update", "--strict"]) {
      const r = gate(files, [flag]);
      expect(r.ok, `${flag} 不该放行`).toBe(false);
      /* 也不许把「收紧基线」当成出路：`--update` 若还在写基线，它就是隐藏的放宽通道。 */
      expect(r.output, `${flag} 的出路不该指向 --update`).not.toContain("--update");
    }
  });
});

describe("裸 sleep 门禁：该放的形状（§11.14）", () => {
  it("② 声明豁免：站点上方有理由 → 不计入棘轮", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", async () => {
  // sleep-ok: 等一个「不会发生的事」——确认放行后不再有新的调度读取。
  await new Promise((r) => setTimeout(r, 50));
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("声明豁免 1 处");
    expect(r.output).toContain("裸 sleep 0 处");
  });

  it("② 折行站点也要认：prettier 折开 `new Promise((r) =>` 之后仍可豁免", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", async () => {
  // sleep-ok: mock 内部延迟：给用例制造「接口慢一拍」的现场。
  await new Promise((resolve) =>
    setTimeout(resolve, 20),
  );
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("裸 sleep 0 处");
  });

  it("② `setTimeout(…, 0)` 不算：它是让出一轮宏任务，没有时间预算可赌", () => {
    /* 判据**自己**认「0 不算」，而不是让这 7 处各写一条 `sleep-ok` —— 纯噪音会把
     * 「所有站点都得声明」变成一句空话（同 §12.16 的教训：噪音让人整条规则都不看）。 */
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((r) => setTimeout(r, 0));
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("裸 sleep 0 处");
  });

  it("② 变量延时算站点：`setTimeout(r, behavior.delayMs)` 是预算，只是运行时才知道", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", async () => {
  if (behavior.delayMs) await new Promise((r) => setTimeout(r, behavior.delayMs));
});
`,
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("测试层裸 sleep 1 处");
  });

  it("④ 字符串 / 注释里的站点不算：判据不去判自己的夹具", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", () => {
  const fixture = "await new Promise((r) => setTimeout(r, 50))";
  // await new Promise((r) => setTimeout(r, 50))
  expect(fixture.length).toBeGreaterThan(0);
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("裸 sleep 0 处");
  });

  it("⑤ 没被 await 的 Promise 不算：它不是「等这条语句过去」", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", () => {
  const pending = [1, 2].map(
    (n) => new Promise((r) => setTimeout(r, n)),
  );
  expect(pending.length).toBe(2);
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("裸 sleep 0 处");
  });

  it("② 声明只在紧邻站点时生效：隔开代码的声明不豁免下面的站点", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", async () => {
  // sleep-ok: 只能管紧邻的那一处。
  const unrelated = 1;
  await new Promise((r) => setTimeout(r, 50));
  expect(unrelated).toBe(1);
});
`,
    });
    /* 这条钉的是「声明的作用半径」：中间隔了非注释代码就断开。
     * 判据若把声明做成「整块/整文件生效」，下一个人会以为只要写一条就全豁免了。 */
    expect(r.ok).toBe(false);
    expect(r.output).toContain("测试层裸 sleep 1 处");
  });

  it("② 声明可以跨过「包着我的那一句的开头」：vi.mocked(…)( 之上两行的声明仍生效", () => {
    const r = gate({
      "tests/a.test.ts": `${HEAD}it("x", () => {
  // sleep-ok: mock 内部延迟：模拟一个 5s 的慢查询。
  vi.mocked(findPort).mockImplementation(
    () => new Promise((r) => setTimeout(() => r(8188), 5000)),
  );
});
`,
    });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("裸 sleep 0 处");
  });

  it("② 零参箭头 helper 算站点，带参箭头回调不算（自测第 ⑤ 条的边界）", () => {
    /* 零参箭头（`const flush = () => new Promise(…)`）是一条独立的「等 N 毫秒」
     * helper —— 漏掉它会让它的 `sleep-ok` 声明变成摆设；而带参箭头是回调，
     * 属「造一个慢东西丢进集合」，不在本判据的靶子里。 */
    const helper = gate({
      "tests/a.test.ts": `${HEAD}const flush = () => new Promise((r) => setTimeout(r, 30));
it("x", async () => {
  await flush();
});
`,
    });
    expect(helper.ok).toBe(false);
    expect(helper.output).toContain("测试层裸 sleep 1 处");

    const callback = gate({
      "tests/a.test.ts": `${HEAD}it("x", () => {
  const pending = [1, 2].map(
    (n) => new Promise((r) => setTimeout(r, n)),
  );
  expect(pending.length).toBe(2);
});
`,
    });
    expect(callback.ok).toBe(true);
    expect(callback.output).toContain("裸 sleep 0 处");
  });

  it("⑥ 无站点时放行（反向：判据不是恒红）", () => {
    const files = {
      "tests/a.test.ts": `${HEAD}it("x", async () => {
  expect(1).toBe(1);
});
`,
    };
    const ok = gate(files);
    expect(ok.ok).toBe(true);
    expect(ok.output).toContain("裸 sleep 0 处");
  });
});

describe("裸 sleep 门禁：扫描期间文件消失（并发探针）", () => {
  it("读不到的文件返回 null，而不是把整个 D 组带崩", () => {
    /* `global-setup-cleanup.test.ts` 在 `tests/` 下造 `.setup-cleanup-probe-*.test.tsx` 再删；并行 vitest 下
       本判据会「列到名字、读时已没」⇒ 整个 D 组带 Node ENOENT 栈崩掉，报错不指向改动。已不存在的文件
       没有站点 ⇒ 返回 null 让调用方计数，且计数必须进结论行（否则落入 §13.5.12「自称在跑、实际没跑」）。 */
    const gone = path.resolve(__dirname, "..", "tests", `.setup-cleanup-probe-0-0.test.tsx`);
    expect(existsSync(gone), "夹具路径本身不该存在").toBe(false);
    expect(scanFile(gone)).toBeNull();
  });
});

describe("裸 sleep 门禁：扫描面在枚举途中消失（同族第 5 条）", () => {
  it("`walk` 对半路消失的目录降级为空，而不是把整个 D 组带崩", () => {
    /* 与 `scanFile` 那条是同一竞态的另一个窗口：`readdirSync` 递归枚举时条目被删，抛 `ENOENT` 而非
       `readFileSync`；来源同是 `global-setup-cleanup.test.ts` 的瞬时探针。只补前一个等于把门禁一半赌在
       时序上，两个窗口都得接住。造法：替换那一刻的 `readdirSync`，先删目录再走原实现 ⇒ 复现同一个
       ENOENT 且每次必现。 */
    const root = mkdtempSync(path.join(tmpdir(), "test-sleep-walk-"));
    try {
      const dir = path.join(root, "tests");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "a.test.ts"), HEAD);

      const realReaddir = fs.readdirSync;
      let removed = false;
      /* 签名照抄真实重载之一（`withFileTypes: true` 那一支）—— 用 `unknown[]` 的
         松散签名会让 `mockImplementation` 与被覆盖的重载对不上，`tsc` 当场报
         `TS2345`（spy 的入参类型必须能接住调用点的那个重载）。 */
      const spy = vi.spyOn(fs, "readdirSync").mockImplementation((dirPath, options) => {
        /* 只在这一层炸一次：删掉目录之后，原实现自己就会抛 ENOENT。 */
        if (!removed) {
          removed = true;
          rmSync(dir, { recursive: true, force: true });
        }
        /* SAFETY: 类型断言已复核 */
        return (
          realReaddir as (p: typeof dirPath, o: typeof options) => ReturnType<typeof realReaddir>
        )(dirPath, options);
      });
      try {
        expect(walk(dir)).toEqual([]);
      } finally {
        spy.mockRestore();
      }
      expect(removed, "夹具没跑到删目录那一步，这条用例是假绿").toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
