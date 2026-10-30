/**
 * 「测试层裸 sleep 用在哪儿」门禁自测（规范 §11.14）。
 *
 * 判据的价值全在**判定口径**上，所以这里跑的是**真脚本**（临时仓库 + 只放被测文件），
 * 断言「该拦的拦、不该误伤的放过」。六条口径各有执行者：
 *
 *   ① **赌时间**（该拦）：`await new Promise(r => setTimeout(r, 50))` 单独成句，
 *      等的是状态落定 —— 条件成立时照样等满、不成立时只留一句「超时」。
 *   ② **声明豁免**（该放）：站点上方写着 `// sleep-ok: <理由>` —— 这是「等一个
 *      不会发生的事」/「mock 内部延迟」/「必须真挂钟」三类的登记方式。
 *   ③ **空声明**（该拦）：只有标签、后面空着，与没有声明等价（同 §11.19 的口径）。
 *   ④ **字符串 / 注释里的站点**（该放）：本站自己的自测夹具里就写着这个形态 ——
 *      判据去判自己的夹具是 §11.18.3.1 记过的坑（走 `maskNonCode`）。
 *   ⑤ **没被 await 的 Promise**（该放）：站点不是「等这条语句过去」，而是别的东西
 *      （例如丢给 `Promise.all` 的填充项）。
 *   ⑥ **硬闸**：非豁免站点命中即阻断；`--update` / `--strict` 是断头的
 *      （ISSUE #1811 收尾时从棘轮翻上来，基线文件已删）。
 *
 * ⚠️ 本文件自己**不进扫描面**（`FIXTURE_SKIP`）：它是喂给判据的被测字符串，
 * 判它等于判自己的量具 —— 与 `tests/test-concurrency-gate.test.ts` 同一取舍。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
/* `vi.spyOn(fs, …)` 要的是可写对象 ⇒ 必须 default 导入
   （`import * as fs` 在 vitest 5 下是冻结命名空间，spy 会以
   `Cannot redefine property: readdirSync` 当场炸掉 —— 先例见 `tests/db-backup.test.ts`）。 */
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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
const { scanFile, walk } = /* SAFETY: 类型断言已复核 */ createRequire(import.meta.url)(SCRIPT) as {
  scanFile: (abs: string) => Array<unknown> | null;
  walk: (dir: string, out?: Array<string>) => Array<string>;
};

/**
 * 在临时仓库里跑真脚本（cwd = 临时仓库根，只放被测文件 + 判据依赖）。
 *
 * 翻硬闸后**不再写基线文件**：判据没有基线可读、也没有 `--update` 可写；
 * 用例要验的正是「这个形态在无基线的档下会/不会红」。
 *
 * @param files 相对路径 → 内容
 * @param args 额外参数（如 --update / --report）
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
    const e = /* SAFETY: 类型断言已复核 */ error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
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

describe("裸 sleep 门禁：扫描面在枚举途中消失（同族第 5 条）", () => {
  it("`walk` 对半路消失的目录降级为空，而不是把整个 D 组带崩", () => {
    /* `scanFile` 那条挡的是**「列到名字、读时已没」**；这里挡的是同一个竞态的
       另一个窗口 —— 递归枚举本身（`readdirSync`）撞上条目在两次调用之间被删，
       抛的是 `ENOENT` 而**不是**从 `readFileSync` 出来的。

       两份都是 `tests/global-setup-cleanup.test.ts` 那份瞬时探针造成的（它在
       `tests/` 下写 `.setup-cleanup-probe-<pid>-<ts>.test.tsx` 再删）。只补前一个
       等于把门禁的一半赌在时序上：命中哪个窗口取决于探针被删的那一刻 `walk`
       走到了第几步，两个窗口都得接住。

       造法：在 `readdirSync` 那一刻把目录删掉。用**真 syscall 竞态**造不稳定
       （要卡在两次调用之间），所以这里替换掉那一刻的 `readdirSync`，让它在被
       调用时先把目录删掉、再走原实现 —— 这样复现的是**同一个 ENOENT**，
       且每次必现。 */
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
        return /* SAFETY: 类型断言已复核 */ (
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
