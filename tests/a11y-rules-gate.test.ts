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
 * ── 为什么不走 `defineGateRepo`（§11.16.1 那份共用夹具）──────────────
 *
 * 那一份的口径是「把脚本拷进一个只放了被测文件的临时仓库、在**那里**跑」，
 * 而本判据的**被测输入的一部分就是真仓库根**：它要 `import()` 仓库根的
 * `eslint.config.js`（那份配置又 import 了整个 `eslint-config-next`，
 * 在临时仓库里没有 `node_modules`、根本起不来）。所以这里必须
 * `cwd = 真仓库根`，夹具要建的「临时仓库」整个用不上 —— 硬套它只会留下
 * 一个签了名却没人用的 `repo` 参数（那个「第十七个手抄四件套」的问题，
 * 在这个文件上不具备它要修的形状）。
 *
 * 剩下那一半（`write` / `run` / 收尾）以前是手写的 `execFileSync` +
 * 「备份真台账 → 覆盖 → 跑 → 还原」—— 那是**共享可变状态**：10 条用例串行时
 * 只是慢，并发时会互相踩，而失败路径上还不保证还原。现在换成两层：
 *
 *   ① 台账路径改成**显式入参**（`--ledger <path>`，判据那一侧的纯增量口子）——
 *     每条用例写自己的临时文件，真台账**只读不写**；
 *   ② 跑法改成 `execFile` **异步**，并且**绝大多数用例改为在本进程里判**：判据那一侧
 *      把判决拆成了可导入的 `judge(ledger)`（§11.19.1 那条「真实成本要登记」的同族 ——
 *      只是这里登记的方式是**把成本降到只付一次**）。
 *
 * ⚠️ ② 这一改的立案数据：这台机器上单个子进程实测 **~9s**（求值 `eslint.config.js`
 * 连同整份 `eslint-config-next`），于是
 *   · 12 条各起一次进程 = 串行 **133.8s**；
 *   · 12 条 `test.concurrent` 并发起 = 墙钟 **52.6s**（本机闲时能过），
 *     而在全量并发档里 **90.1s、12 条中 11 条 `Test timed out in 30000ms`**；
 *   · 加一个「同时在飞 ≤3」的限流 = **63.1s / 5 条超时** —— 这条路是**反的**：
 *     `test.concurrent` 的用例计时从「用例体开始」就起算，排队时间照样记在这条用例头上，
 *     限流只是把「等子进程」换成「等名额」。
 * 三种形态测的都是「机器这一刻有多闲」，而不是判据（§11.13 的处置方向是**降成本**，
 * 不是抬超时）。现在分两层：
 *   · **判决逻辑在本进程里判**（`judge(ledger)`，配置事实每进程只求值一次）：
 *     本文件 **133.8s → 44.9s**（本机闲时）。同一条命令的单个子进程在满载机器上
 *     实测 9s → 20s，所以这里留下的判据是**上限的形状** —— 单条用例的成本 = 一次求值，
 *     不再等于「等前面 N 条把名额吐出来」；
 *     验收口径是「**97% 负载的机器上 12 条全绿**」（实测整份 74.6s，其中 ~22s 落在
 *     收集期的暖机、不在任何用例的计时里）—— 旧形态在同样的负载下产 11 条超时；
 *   · **真跑 CLI 只留接线形状**：「真台账经完整 CLI 是绿的」与「`--report` 恒 0」
 *     两条起进程（退出码与旗标语义只有起进程才成立），⑩ 那条用法错在加载配置**之前**
 *     就退 2、成本不计。其余全在进程内判。
 *
 * 判据覆盖面一条没动：12 条用例逐条照旧（原 ④ 里那两个 `expect` 拆成 ④ / ④b
 * 两条），另加 ⑩ 钉 `--ledger` 缺值退 2 那一档。
 *
 * 本文件**不用并发档**（§11.19 那三条里 ② / ③ 说的就是这类「拿并发换墙钟、
 * 换来的是机器相关结论」）：用例之间只剩「各自写自己的临时台账文件」这一处
 * 名义上的共享目录，而文件名带自增序号、真台账全程只读。
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, expect, test } from "vitest";

import { judge } from "../scripts/check-a11y-rules.cjs";

const run = promisify(execFile);

/** 真仓库根 —— 判据要读的 `eslint.config.js` 只有真根上有。 */
const REAL_ROOT = process.cwd();
const SCRIPT = path.join(REAL_ROOT, "scripts", "check-a11y-rules.cjs");
const LEDGER = path.join(REAL_ROOT, "scripts", ".a11y-rule-ledger.json");

/** 真台账（**只读**）：用例从它派生夹具，但绝不写它。 */
const REAL_LEDGER = JSON.parse(readFileSync(LEDGER, "utf8")) as {
  why: string;
  dialect: { rule: string; decision: string; why: string; keeper: string }[];
  inlineExemptions: {
    rule: string;
    file: string;
    why: string;
    keeper: string;
  }[];
};

/* 本文件自己的临时目录：每条用例在里面写一份**自己的**台账。
 * 目录在用例之间是共用的，但文件名由用例自己给（见下），所以互不覆盖。 */
const TMP_ROOT = mkdtempSync(path.join(tmpdir(), "a11y-rules-gate-"));
afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

let seq = 0;

/**
 * 跑一次判据：**工作目录固定在真仓库根**（它要 import 真的 eslint 配置），
 * 台账由本次调用写进自己的临时文件、经 `--ledger` 传进去。
 *
 * 真台账**从头到尾只读** —— 这是相对旧版「备份 / 还原真文件」的关键差别：
 * 没有共享可变状态，用例中途 throw 也不会把真仓库留在脏状态。
 */
async function runWithLedger(ledger: unknown, args: string[] = []) {
  const file = path.join(TMP_ROOT, `ledger-${seq++}.json`);
  writeFileSync(file, JSON.stringify(ledger, null, 2));
  try {
    const { stdout } = await run(
      process.execPath,
      [SCRIPT, ...args, "--ledger", file],
      { cwd: REAL_ROOT, encoding: "utf8" },
    );
    return { ok: true, output: stdout };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
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
 * 留成真跑 CLI 的只有**接线形状**那两条：「真台账经完整 CLI 是绿的」与
 * 「`--report` 恒 0」—— 退出码与旗标语义只有起进程才成立。
 */
async function judgeWith(ledger: unknown) {
  const { problems, summary } = await judge(
    ledger as { dialect: unknown[]; inlineExemptions: unknown[] },
  );
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

test("真台账是绿的（当前状态自查，完整 CLI 一次）", CLI_BUDGET, async () => {
  const r = await runWithLedger(REAL_LEDGER);
  expect(r.ok, r.output).toBe(true);
  expect(r.output).toContain("官方 recommended");
});

test("① 官方 recommended 被悄悄关掉、台账里没有 → 阻断并点名", async () => {
  const r = await judgeWith({ ...REAL_LEDGER, dialect: [] });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("属官方 recommended 却被关掉了");
  expect(r.output).toContain("no-autofocus");
});

test("② 台账说关着、实际却开着 → 阻断（登记是负债不是赦免名单）", async () => {
  const r = await judgeWith({
    ...REAL_LEDGER,
    dialect: [
      ...REAL_LEDGER.dialect,
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
    ...REAL_LEDGER,
    dialect: [
      ...REAL_LEDGER.dialect,
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
    ...REAL_LEDGER,
    dialect: REAL_LEDGER.dialect.map((d) => ({ ...d, why: "" })),
  });
  expect(noWhy.ok).toBe(false);
  expect(noWhy.output).toContain("没写「为什么」");
});

test("④b 方言缺「谁在守它」→ 阻断（另一半）", async () => {
  const noKeeper = await judgeWith({
    ...REAL_LEDGER,
    dialect: REAL_LEDGER.dialect.map((d) => ({ ...d, keeper: "" })),
  });
  expect(noKeeper.ok).toBe(false);
  expect(noKeeper.output).toContain("没写「谁在守它」");
});

test("⑤ 就地豁免指向不存在的文件 → 阻断（改名 / 搬走后的过期条目）", async () => {
  const r = await judgeWith({
    ...REAL_LEDGER,
    inlineExemptions: [
      ...REAL_LEDGER.inlineExemptions,
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

test(
  "⑥ `--report` 只出清单、不判失败（恒 0）—— 报告档的语义",
  CLI_BUDGET,
  async () => {
    const r = await runWithLedger({ ...REAL_LEDGER, dialect: [] }, [
      "--report",
    ]);
    expect(r.ok, r.output).toBe(true);
    expect(r.output).toContain("--report 模式");
  },
);

test("⑦ 非废弃、且官方两份配置都没提到的规则：没登记也不开 → 阻断（「没人决定过」）", async () => {
  /* 把 prefer-tag-over-role 那一条从台账里摘掉 —— 它现在就落在
     「官方 recommended / strict 都没提到、也没被标记废弃」那一格，
     摘掉登记之后本仓对它就没有任何裁决痕迹了。 */
  const r = await judgeWith({
    ...REAL_LEDGER,
    dialect: REAL_LEDGER.dialect.filter(
      (d) => d.rule !== "jsx-a11y/prefer-tag-over-role",
    ),
  });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("既不在官方 recommended、也不在官方 strict");
  expect(r.output).toContain("prefer-tag-over-role");
});

test("⑧ 那一格登记齐了 → 放行（本仓真表就是绿的）", async () => {
  /* 与 ⑦ 对照：真台账里 prefer-tag-over-role 已登记，于是这一向不再报它。
     注意断言的是**这一向**的输出里没有它，不是「整体没红」——
     整体绿由第 1 条用例守着。 */
  const r = await judgeWith(REAL_LEDGER);
  expect(r.ok, r.output).toBe(true);
  expect(r.output).not.toContain("既不在官方 recommended、也不在官方 strict");
});

test("⑨ 官方标了 deprecated 的规则不算「没人决定过」（不逼人给废弃规则表态）", async () => {
  /* `accessible-emoji` / `no-onchange` / `label-has-for` 是官方 ❌ deprecated，
     两边配置不提是对的 —— 判据按插件的 `meta.deprecated` 认出来并跳过。 */
  const r = await judgeWith({ ...REAL_LEDGER, dialect: [] });
  expect(r.output).not.toContain("accessible-emoji 既不在官方");
  expect(r.output).not.toContain("no-onchange 既不在官方");
  expect(r.output).not.toContain("label-has-for 既不在官方");
});

test("⑩ `--ledger` 缺路径 → 退 2（不许静默退回真台账）", async () => {
  /* 用法错的形态要红：`--ledger` 后面没跟路径时若静默退回真台账，
     用例以为在判自己的夹具、其实在判真库 —— 绿得毫无意义。 */
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
