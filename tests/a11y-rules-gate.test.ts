/**
 * 「jsx-a11y 的规则开关 ⇄ 判据」门禁自测（规范 06 §6.12）。
 *
 * 判据 `scripts/check-a11y-rules.cjs` 的五向口径逐条钉住：
 *   ① 官方 `recommended` 的每一条都必须开着、options 与官方逐字一致
 *   ② 台账里登记的每一处「方言」必须是真的关着（双向）
 *   ③ 官方 recommended 里被关掉的必须登记（悄悄关掉 = 判据睡着）
 *   ④ 就地豁免的文件要存在、理由与 keeper 要写全
 *   ⑤ 官方两份配置都没提到的非废弃规则必须有裁决（「没人决定过」）
 *
 * ── 为什么这一批改成「进程内判」而不是「每条用例 spawn 一个」────────────
 *
 * 判据的被测输入里最贵的一件是**真的 `eslint.config.js`**（它 import 了整个
 * `eslint-config-next`）。**首次**求值在干净检出上 40s+（用户侧实测，8 核 / 16G；
 * `.next/` 在时 ~1.1–1.7s），派生链与两个数字的出处见规范 §11.19.1 的档 E。
 *
 * 33418b72 那笔把「同步 `execFileSync`」换成了异步 `execFile` + `it.concurrent` ——
 * 稳态（`.next/` 热）下确实买到了墙钟：本文件 19.5s → 6.2s。但**冷检出上它换来的
 * 正是最坏的那种形态**：十来个子进程在同一个 `import()` 上排队，每个都自己求值
 * 一遍，于是「并发」把十来次 40s 的等待首尾相接变成了一起等在同一份加载上、
 * 一起越过 `testTimeout` —— 而钩子每次提交都是**新进程、必然冷**（实测 10/10 超时）。
 *
 * 所以这一批的跑法换成：**共进程 + 一次性真加载**。
 * `scripts/check-a11y-rules.cjs` 是 CJS，`require()` 它拿到的是同一个模块实例，
 * 而 `import()` 对同一个模块也只求值一次 —— 于是十来份台账各判一次，配置只求值**一次**
 * （实测 1051ms → 后续每次 ~1ms）。**这一半是白拿的**，不需要牺牲任何一条断言。
 *
 * ⚠️ 剩下那一半买不到：`eslint` 那一侧的成本（求值配置）**判据本体没得选** ——
 * 冷检出上这一次真加载仍要 40s+。所以本文件里**任何东西都不许再起一个会求值
 * 那份配置的子进程**（那等于把成本乘回去）；`scripts/check-a11y-rules.cjs` 的
 * bin 形态与它的退出码覆盖在 `tests/check-a11y-rules.test.ts` 的 `--ledger`
 * 那一条（用一条假台账把整条路径跑通，不付真加载的钱）。
 *
 * ── 夹具的形状（相对旧版的一处实质改动） ────────────────────────────────
 *
 * 旧版每条用例都从**真台账**派生夹具（`{ ...REAL_LEDGER, dialect: [] }`），于是
 * 「夹具的形状」与「仓库此刻的台账内容」绑在一起 —— 台账里增删一条方言，
 * 好几条用例的成立条件就跟着漂。现在夹具走
 * `tests/fixtures/a11y-rule-ledger.sample.json`（一条不落盘的形状样本），
 * 用例在它上面加减，与真台账**解耦**；「真台账是绿的」仍然由第 ① 条用例守着。
 *
 * 判据覆盖面一条没动：12 条用例逐条照旧（原 ④ 里那两个 `expect` 拆成 ④ / ④b
 * 两条好让它们也重叠），另加 ⑩ 钉 `--ledger` 缺值退 2 那一档。
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { Console } from "node:console";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import {
  loadJudgeModule,
  REAL_ROOT,
  SCRIPT,
} from "./helpers/a11y-effective-config";

const run = promisify(execFile);

const { judge } = loadJudgeModule();

/**
 * **真台账**（`scripts/.a11y-rule-ledger.json`）—— 只被一条用例碰（下面「真台账是绿的」），
 * 用来自查「仓库当前状态本身是绿的」。其余用例一律在 `SAMPLE` 上加减。
 */
const REAL_LEDGER = JSON.parse(
  readFileSync(
    path.join(REAL_ROOT, "scripts", ".a11y-rule-ledger.json"),
    "utf8",
  ),
) as typeof SAMPLE;

/** 夹具台账的**形状样本**（落盘在 `tests/fixtures/`、与真台账解耦，见文件头）。 */
const SAMPLE = JSON.parse(
  readFileSync(
    path.join(REAL_ROOT, "tests", "fixtures", "a11y-rule-ledger.sample.json"),
    "utf8",
  ),
) as {
  why: string;
  dialect: { rule: string; decision: string; why: string; keeper: string }[];
  inlineExemptions: {
    rule: string;
    file: string;
    why: string;
    keeper: string;
  }[];
};

let seq = 0;

/**
 * 跑一次判据：台账是**显式入参**、写进本次调用自己的临时文件（`os.tmpdir()`，
 * 不落仓库），返回值与旧版的子进程读法**逐字同义** ——
 * `{ ok, output }`：`output` 仍是 stdout + stderr 的拼接（`toContain` 的那些话术
 * 一个字没改），`ok` 仍是「退出码是不是 0」（真子进程判的就是它）。
 *
 * ── 怎么把「子进程的 stdout / stderr」搬进进程内（踩过的三件事）──────────
 *
 * 判据输出走的是**全局 `console`**（`console.error` 报问题、`console.log` 出摘要），
 * 而 `console` 在模块求值时就把目标流抓在闭包里了 —— 所以「替换 `process.stdout.write`」
 * 这条路**根本抓不到它**（实测：vitest 里连 `process.stderr.write = …` 都无效，
 * 因为那一层 `write` 来自原型链更深处、`console` 也没经它走）。能抓到的形状只有两个：
 *
 *   ① 把全局 `console` 换成 `new Console({ stdout, stderr })`。⚠️ 那两个流必须是**真的
 *      `Writable` 实例**（`node:stream`）—— 鸭子类型（只长一个 `write` 的对象）在
 *      `kWriteToConsole` 里会被判成「不是流」而**静默丢弃**（实测：`write` 一次都不被调、
 *      也不报错）。空 `write` 桩对象那个坑就是这么来的。
 *   ② 捕获窗口必须**跨过 `await`**。`judge()` 里有 `await`（求值配置 / 读台账），
 *      于是 `try/finally` 里的恢复会在真正的输出发生**之前**就把 `console` 换回去 ——
 *      这是「补了捕获却仍然 `output === ""`」的根因。所以恢复写在 `await` 之后，
 *      且要用 `try { … } finally { … }` 把**等待**包在里面（这里用同一形状）。
 *
 * 只换**全局 `console`**、不动 `process.stdout`：vitest 的 reporter 走的是后者，
 * 于是用例的输出不会因为捕获而消失（这正是「进程内跑」相对「起子进程」多出来的
 * 一档风险，所以它在这条注释里被写下来）。
 */
async function runWithLedger(ledger: unknown, args: string[] = []) {
  const file = path.join(
    tmpdir(),
    `a11y-rules-gate-${process.pid}-${seq++}.json`,
  );
  writeFileSync(file, JSON.stringify(ledger, null, 2));

  /** 判据的 stdout + stderr 落在这里；`Writable` 是 `new Console` 认的那种流。 */
  const sinkChunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      sinkChunks.push(String(chunk));
      cb();
    },
  });
  const capture = new Console({ stdout: sink, stderr: sink });
  const realConsole = globalThis.console;
  globalThis.console = capture;
  try {
    const code = await judge({
      ledger: file,
      report: args.includes("--report"),
    });
    return { ok: code === 0, output: sinkChunks.join("") };
  } finally {
    globalThis.console = realConsole;
    sink.destroy();
  }
}

// 夹具台账是**显式入参**、每次调用各写一份到 os.tmpdir —— 真台账只读不写，
// 与旧版的「备份 → 覆盖 → 还原真文件」相比没有共享可变状态（§11.19.2 那一族）。
//
// 真台账只被**一条**用例碰到（下面第 1 条，`judge({})` 不带 ledger 时的默认值就是它），
// 其余全部在 SAMPLE 上加减 —— 夹具与「仓库此刻的台账长什么样」解耦。

test("真台账是绿的（当前状态自查）", async () => {
  const r = await runWithLedger(REAL_LEDGER);
  expect(r.ok, r.output).toBe(true);
  expect(r.output).toContain("官方 recommended");
});

test("① 官方 recommended 被悄悄关掉、台账里没有 → 阻断并点名", async () => {
  const r = await runWithLedger({ ...SAMPLE, dialect: [] });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("属官方 recommended 却被关掉了");
  expect(r.output).toContain("no-autofocus");
});

test("② 台账说关着、实际却开着 → 阻断（登记是负债不是赦免名单）", async () => {
  const r = await runWithLedger({
    ...SAMPLE,
    dialect: [
      ...SAMPLE.dialect,
      {
        rule: "jsx-a11y/alt-text",
        decision: "off",
        why: "（夹具）它其实开着",
        keeper: "（夹具）",
      },
    ],
  });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("登记的是负债，不是赦免名单");
});

test("③ 台账登记了不存在的规则 → 阻断（改名 / 换插件后的孤儿条目）", async () => {
  const r = await runWithLedger({
    ...SAMPLE,
    dialect: [
      ...SAMPLE.dialect,
      {
        rule: "jsx-a11y/no-such-rule",
        decision: "off",
        why: "（夹具）规则不存在",
        keeper: "（夹具）",
      },
    ],
  });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("孤儿条目");
});

test("④ 方言缺「为什么」或「谁在守它」→ 阻断（空理由没有记账价值）", async () => {
  const noWhy = await runWithLedger({
    ...SAMPLE,
    dialect: SAMPLE.dialect.map((d) => ({ ...d, why: "" })),
  });
  expect(noWhy.ok).toBe(false);
  expect(noWhy.output).toContain("没写「为什么」");
});

test("④b 方言缺「谁在守它」→ 阻断（另一半）", async () => {
  const noKeeper = await runWithLedger({
    ...SAMPLE,
    dialect: SAMPLE.dialect.map((d) => ({ ...d, keeper: "" })),
  });
  expect(noKeeper.ok).toBe(false);
  expect(noKeeper.output).toContain("没写「谁在守它」");
});

test("⑤ 就地豁免指向不存在的文件 → 阻断（改名 / 搬走后的过期条目）", async () => {
  const r = await runWithLedger({
    ...SAMPLE,
    inlineExemptions: [
      ...SAMPLE.inlineExemptions,
      {
        rule: "jsx-a11y/alt-text",
        file: "src/components/ui/does-not-exist.tsx",
        why: "（夹具）",
        keeper: "（夹具）",
      },
    ],
  });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("不存在");
});

test("⑥ `--report` 只出清单、不判失败（恒 0）—— 报告档的语义", async () => {
  const r = await runWithLedger({ ...SAMPLE, dialect: [] }, ["--report"]);
  expect(r.ok, r.output).toBe(true);
  expect(r.output).toContain("--report 模式");
});

test("⑦ 非废弃、且官方两份配置都没提到的规则：没登记也不开 → 阻断（「没人决定过」）", async () => {
  /* 把 prefer-tag-over-role 那一条从台账里摘掉 —— 它现在就落在
     「官方 recommended / strict 都没提到、也没被标记废弃」那一格，
     摘掉登记之后本仓对它就没有任何裁决痕迹了。
     ⚠️ 这两条用例（⑦ / ⑧）的夹具是 SAMPLE 里那两条方言**之外**的一条，
     用 `dialect: []` 反而更直接 —— 保持原写法（从样本里摘掉那一条）。 */
  const r = await runWithLedger({
    ...SAMPLE,
    dialect: SAMPLE.dialect.filter(
      (d) => d.rule !== "jsx-a11y/prefer-tag-over-role",
    ),
  });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("既不在官方 recommended、也不在官方 strict");
  expect(r.output).toContain("prefer-tag-over-role");
});

test("⑧ 那一格登记齐了 → 放行（本仓真表就是绿的）", async () => {
  /* 与 ⑦ 对照：登记了 prefer-tag-over-role 之后这一向不再报它。
     注意断言的是**这一向**的输出里没有它，不是「整体没红」——
     整体绿由第 1 条用例守着。 */
  const r = await runWithLedger({
    ...SAMPLE,
    dialect: [
      ...SAMPLE.dialect,
      {
        rule: "jsx-a11y/prefer-tag-over-role",
        decision: "off",
        why: "（夹具）这一格登记齐了",
        keeper: "（夹具）",
      },
    ],
  });
  expect(r.ok, r.output).toBe(true);
  expect(r.output).not.toContain("既不在官方 recommended、也不在官方 strict");
});

test("⑨ 官方标了 deprecated 的规则不算「没人决定过」（不逼人给废弃规则表态）", async () => {
  /* `accessible-emoji` / `no-onchange` / `label-has-for` 是官方 ❌ deprecated，
     两边配置不提是对的 —— 判据按插件的 `meta.deprecated` 认出来并跳过。 */
  const r = await runWithLedger({ ...SAMPLE, dialect: [] });
  expect(r.output).not.toContain("accessible-emoji 既不在官方");
  expect(r.output).not.toContain("no-onchange 既不在官方");
  expect(r.output).not.toContain("label-has-for 既不在官方");
});

test("⑩ `--ledger` 缺路径 → 退 2（不许静默退回真台账）", async () => {
  /* 用法错的形态要红：`--ledger` 后面没跟路径时若静默退回真台账，
     用例以为在判自己的夹具、其实在判真库 —— 绿得毫无意义。
     ⚠️ 这一格**必须**走真子进程：它判的是 CLI 解析（`parseArgs` + `process.exit(2)`），
     而那不是进程内可观测的东西。它付的也只是「起一次 node」的钱 —— 那条路径在
     `process.exit(2)` 上停住，**不会**去求值 `eslint.config.js`（实测 ~60ms）。 */
  const bad = await run(process.execPath, [SCRIPT, "--ledger"], {
    cwd: REAL_ROOT,
    encoding: "utf8",
  }).then(
    () => ({ code: 0, output: "" }),
    (error: { code?: number; stdout?: string; stderr?: string }) => ({
      code: error.code ?? 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    }),
  );
  expect(bad.code).toBe(2);
  expect(bad.output).toContain("--ledger 后面要跟一个台账文件路径");
});
