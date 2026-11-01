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
 * 冷检出上这一次真加载仍要 40s+，满载机器上单个子进程实测 9s → 20s。所以本文件里
 * **任何东西都不许再起一个会求值那份配置的子进程**（那等于把成本乘回去）；只有
 * 「真台账经完整 CLI 是绿的」与「`--report` 恒 0」两条起进程（退出码与旗标语义只有
 * 起进程才成立），它们各自登记实测上限的 4 倍预算；⑩ 那条用法错在加载配置**之前**
 * 就退 2、成本不计。bin 形态与它的退出码另有 `tests/check-a11y-rules.test.ts` 守着。
 *
 * ── 夹具的形状（相对旧版的一处实质改动） ────────────────────────────────
 *
 * 旧版每条用例都从**真台账**派生夹具（`{ ...SAMPLE, dialect: [] }`），于是
 * 「夹具的形状」与「仓库此刻的台账内容」绑在一起 —— 台账里增删一条方言，
 * 好几条用例的成立条件就跟着漂。现在夹具走
 * `tests/fixtures/a11y-rule-ledger.sample.json`（一条不落盘的形状样本），
 * 用例在它上面加减，与真台账**解耦**；「真台账是绿的」仍然由第 ① 条用例守着。
 *
 * 判据覆盖面一条没动：12 条用例逐条照旧（原 ④ 里那两个 `expect` 拆成 ④ / ④b
 * 两条好让它们也重叠），另加 ⑩ 钉 `--ledger` 缺值退 2 那一档。
 *
 * 本文件**不用并发档**（§11.19 那三条里 ② / ③ 说的就是这类「拿并发换墙钟、
 * 换来的是机器相关结论」）：用例之间只剩「各自写自己的临时台账文件」这一处
 * 名义上的共享目录，而文件名带自增序号、真台账全程只读。
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { loadJudgeModule, REAL_ROOT, SCRIPT } from "./helpers/a11y-effective-config";
import type { Ledger } from "./helpers/a11y-effective-config";

const run = promisify(execFile);

/* 判据模块**只经这一个入口**拿（`tests/helpers/a11y-effective-config.ts`）：
   同一个 module graph 才共享实例，于是 `eslint.config.js` 整个进程只求值一次。 */
const { judge } = loadJudgeModule();

/** 夹具台账的**形状样本**（落盘在 `tests/fixtures/`、与真台账解耦，见文件头）。 */
/* SAFETY: 类型断言已复核 */
const SAMPLE = JSON.parse(
  readFileSync(path.join(REAL_ROOT, "tests", "fixtures", "a11y-rule-ledger.sample.json"), "utf8"),
) as {
  dialect: Array<{ decision: string; keeper: string; rule: string; why: string }>;
  inlineExemptions: Array<{
    file: string;
    keeper: string;
    rule: string;
    why: string;
  }>;
  why: string;
};

/**
 * **真台账**（`scripts/.a11y-rule-ledger.json`）—— 只被一条用例碰（下面第 1 条），
 * 用来自查「仓库当前状态本身是绿的」。其余用例一律在 `SAMPLE` 上加减。
 */
/* SAFETY: 类型断言已复核 */
const REAL_LEDGER = JSON.parse(
  readFileSync(path.join(REAL_ROOT, "scripts", ".a11y-rule-ledger.json"), "utf8"),
) as typeof SAMPLE;

let seq = 0;

/**
 * 跑一次判据：台账是**显式入参**、写进本次调用自己的临时文件（`os.tmpdir()`，
 * 不落仓库），返回值与旧版的子进程读法**逐字同义** ——
 * `{ ok, output }`：`output` 仍是 stdout + stderr 的拼接（`toContain` 的那些话术
 * 一个字没改），`ok` 仍是「退出码是不是 0」（真子进程判的就是它）。
 *
 * 台账由本次调用写进自己的临时文件、经 `--ledger` 传进去。
 *
 * 真台账**从头到尾只读** —— 这是相对旧版「备份 / 还原真文件」的关键差别：
 * 没有共享可变状态，用例中途 throw 也不会把真仓库留在脏状态。
 */
async function runWithLedger(ledger: Ledger, args: Array<string> = []) {
  const file = path.join(tmpdir(), `a11y-rules-gate-${process.pid}-${seq++}.json`);
  writeFileSync(file, JSON.stringify(ledger, null, 2));

  /* 真跑 CLI：退出码与旗标语义（`--report` 恒 0）只有起进程才成立，
     这两条用例付的就是那一次真求值（预算见 `CLI_BUDGET`）。 */
  return run(process.execPath, [SCRIPT, "--ledger", file, ...args], {
    cwd: REAL_ROOT,
    encoding: "utf8",
  }).then(
    (r) => ({ ok: true, output: r.stdout + r.stderr }),
    (error: { code?: number; stderr?: string; stdout?: string }) => ({
      ok: (error.code ?? 1) === 0,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    }),
  );
}
/**
 * **在本进程里**判一份台账（与 `runWithLedger` 同一套 `{ok, output}` 形状，
 * 所以用例体一个字都不用改，只是不再起子进程）。
 *
 * 为什么绝大多数用例走这一条：判据的成本几乎全在「求值 `eslint.config.js`
 * 连同 `eslint-config-next`」那一步，而这一步**每进程只该付一次** ——
 * 实测这台机器上单个子进程 ~9s，12 份台账各起一次进程 = 133s 首尾相接，
 * 12 个重进程并发起则在别人的机器上顶穿用例的 30s 预算（实测 90.1s / 11 条超时，
 * 红的不是判据而是排队）。判据那一侧因此把判决拆成了可导入的 `judge(ledger)`。
 *
 * 留成真跑 CLI（`runWithLedger`）的只有**接线形状**那两条：
 * 「真台账经完整 CLI 是绿的」与「`--report` 恒 0」—— 退出码与旗标语义只有起进程才成立。
 * ⚠️ 这里**不捕获 stdout**：`judge()` 返回的是 `{ problems, summary }`，
 * 而 `console.*` 的输出属于「谁打印谁负责」（bin 形态那一支）。用例断言的是
 * 问题清单与汇总里的那几句话术，与 `toContain` 的原写法逐字同义。
 */
async function judgeWith(ledger: Ledger) {
  const { problems, summary } = await judge(ledger);
  return {
    ok: problems.length === 0,
    output: `${problems.join("\n")}\n${summary}`,
  };
}

/**
 * 那两条**真起子进程**的用例的显式预算。
 *
 * 单进程成本实测：本机闲时 **~9s**，机器 88% 负载时 **20s**，而钩子 C 组是
 * `--maxWorkers=4` 且与 A/B/D 三组并行 —— 就在这次提交被拦下时，这两条各撞了
 * 默认档 `Test timed out in 30000ms`。全局 30s 是**给真进程留的余量，不是给慢
 * 用例兜底**（§11.13）：本文件已经把 12 次求值收成 1 次（这是降成本，是对的方向），
 * 剩下的那 2 次是**判据本身要判的接线形状**（退出码、旗标），删不得也并发不得，
 * 所以登记实测上限的 4 倍作为预算，而不是把它撞在默认档上等人来重跑。
 */
const CLI_BUDGET = { timeout: 120_000 };

/**
 * 收集期**暖机一次**：把「每进程只付一次」的那回配置求值放在用例计时之外。
 *
 * 不这么做的话，谁排在文件里的第一条就要替全文件付这 9~20s —— 于是「挪动用例顺序」
 * 或「新加一条更靠前的用例」都会把 30s 默认档顶穿，表现是一条与内容无关的
 * `Test timed out`，而那条用例本身判的是一瞬间的事（§11.13 的第三种形态：
 * 预算被别人的成本占着）。暖机失败时**让它抛**：读不到配置就是本判据要报的故障，
 * 收在收集期整份文件红，比十条用例各拿同一个错更好读。
 */
await judgeWith(REAL_LEDGER);

// 夹具台账是**显式入参**、每次调用各写一份到 os.tmpdir —— 真台账只读不写，
// 与旧版的「备份 → 覆盖 → 还原真文件」相比没有共享可变状态（§11.19.2 那一族）。
//
// 真台账只被**一条**用例碰到（下面第 1 条，它走完整 CLI 那一支），
// 其余全部在 SAMPLE 上加减 —— 夹具与「仓库此刻的台账长什么样」解耦。

test("真台账是绿的（当前状态自查，完整 CLI 一次）", CLI_BUDGET, async () => {
  const r = await runWithLedger(REAL_LEDGER);
  expect(r.ok, r.output).toBe(true);
  expect(r.output).toContain("官方 recommended");
});

test("① 官方 recommended 被悄悄关掉、台账里没有 → 阻断并点名", async () => {
  const r = await judgeWith({ ...SAMPLE, dialect: [] });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("属官方 recommended 却被关掉了");
  expect(r.output).toContain("no-autofocus");
});

test("② 台账说关着、实际却开着 → 阻断（登记是负债不是赦免名单）", async () => {
  const r = await judgeWith({
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
  const r = await judgeWith({
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
  const noWhy = await judgeWith({
    ...SAMPLE,
    dialect: SAMPLE.dialect.map((d) => ({ ...d, why: "" })),
  });
  expect(noWhy.ok).toBe(false);
  expect(noWhy.output).toContain("没写「为什么」");
});

test("④b 方言缺「谁在守它」→ 阻断（另一半）", async () => {
  const noKeeper = await judgeWith({
    ...SAMPLE,
    dialect: SAMPLE.dialect.map((d) => ({ ...d, keeper: "" })),
  });
  expect(noKeeper.ok).toBe(false);
  expect(noKeeper.output).toContain("没写「谁在守它」");
});

test("⑤ 就地豁免指向不存在的文件 → 阻断（改名 / 搬走后的过期条目）", async () => {
  const r = await judgeWith({
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

test("⑥ `--report` 只出清单、不判失败（恒 0）—— 报告档的语义", CLI_BUDGET, async () => {
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
  const r = await judgeWith({
    ...SAMPLE,
    dialect: SAMPLE.dialect.filter((d) => d.rule !== "jsx-a11y/prefer-tag-over-role"),
  });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("既不在官方 recommended、也不在官方 strict");
  expect(r.output).toContain("prefer-tag-over-role");
});

test("⑧ 那一格登记齐了 → 放行（本仓真表就是绿的）", async () => {
  /* 与 ⑦ 对照：登记了 prefer-tag-over-role 之后这一向不再报它。
     注意断言的是**这一向**的输出里没有它，不是「整体没红」——
     整体绿由第 1 条用例守着。 */
  const r = await judgeWith({
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
  const r = await judgeWith({ ...SAMPLE, dialect: [] });
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
    (error: { code?: number; stderr?: string; stdout?: string }) => ({
      code: error.code ?? 1,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    }),
  );
  expect(bad.code).toBe(2);
  expect(bad.output).toContain("--ledger 后面要跟一个台账文件路径");
});
