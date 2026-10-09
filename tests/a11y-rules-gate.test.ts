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
 *   ② 跑法改成 `execFile` **异步** + `it.concurrent`。实测（§11.19.1 那张表
 *       同一个道理）：`execFileSync` 在等子进程的那 1.7s 里事件循环是停的，
 *       并发无从调度 —— 只换 `it.concurrent` 是**零收益**；换成异步 `execFile`
 *       才让这些用例真正重叠起来。
 *
 * 实测（本容器 8 核，`--no-file-parallelism`）：本文件 **19.5s → 6.2s**；
 * 在钩子 C 组里（与另外 3 个 vitest worker 抢核）本文件 19.5s → 8.4s、C 组
 * 整组 21.2s → 17.1s。单个子进程的成本（~1.7s，`eslint.config.js` 的求值）
 * 一分没少 —— 省下来的全部是「十来次等待不再首尾相接」。
 * **代价**：这些子进程各要加载一整份 next eslint 配置，本文件峰值 RSS ~1.9G；
 * 这是「拿内存换墙钟」的一处显式取舍（真钩子整体峰值 2.87G → 3.27G / 机器 16G）。
 *
 * 判据覆盖面一条没动：12 条用例逐条照旧（原 ④ 里那两个 `expect` 拆成 ④ / ④b
 * 两条，好让它们也重叠），另加 ⑩ 钉 `--ledger` 缺值退 2 那一档。
 *
 * 并发档的隔离声明见下面那一行 `// 并发档：`（§11.19.4 判据②的形态）。
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, expect, test } from "vitest";

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
 * 没有共享可变状态，于是并发安全、用例中途 throw 也不会把真仓库留在脏状态。
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

// 并发档：每条用例把自己的台账写进 TMP_ROOT 下**独立**的文件（文件名带自增序号），
// 真台账只读不写，子进程的 cwd 固定是真仓库根 —— 没有模块级可变状态被两条用例共享。
test.concurrent("真台账是绿的（当前状态自查）", async () => {
  const r = await runWithLedger(REAL_LEDGER);
  expect(r.ok, r.output).toBe(true);
  expect(r.output).toContain("官方 recommended");
});

test.concurrent(
  "① 官方 recommended 被悄悄关掉、台账里没有 → 阻断并点名",
  async () => {
    const r = await runWithLedger({ ...REAL_LEDGER, dialect: [] });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("属官方 recommended 却被关掉了");
    expect(r.output).toContain("no-autofocus");
  },
);

test.concurrent(
  "② 台账说关着、实际却开着 → 阻断（登记是负债不是赦免名单）",
  async () => {
    const r = await runWithLedger({
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
  },
);

test.concurrent(
  "③ 台账登记了不存在的规则 → 阻断（改名 / 换插件后的孤儿条目）",
  async () => {
    const r = await runWithLedger({
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
  },
);

test.concurrent(
  "④ 方言缺「为什么」或「谁在守它」→ 阻断（空理由没有记账价值）",
  async () => {
    const noWhy = await runWithLedger({
      ...REAL_LEDGER,
      dialect: REAL_LEDGER.dialect.map((d) => ({ ...d, why: "" })),
    });
    expect(noWhy.ok).toBe(false);
    expect(noWhy.output).toContain("没写「为什么」");
  },
);

test.concurrent("④b 方言缺「谁在守它」→ 阻断（另一半）", async () => {
  const noKeeper = await runWithLedger({
    ...REAL_LEDGER,
    dialect: REAL_LEDGER.dialect.map((d) => ({ ...d, keeper: "" })),
  });
  expect(noKeeper.ok).toBe(false);
  expect(noKeeper.output).toContain("没写「谁在守它」");
});

test.concurrent(
  "⑤ 就地豁免指向不存在的文件 → 阻断（改名 / 搬走后的过期条目）",
  async () => {
    const r = await runWithLedger({
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
  },
);

test.concurrent(
  "⑥ `--report` 只出清单、不判失败（恒 0）—— 报告档的语义",
  async () => {
    const r = await runWithLedger({ ...REAL_LEDGER, dialect: [] }, [
      "--report",
    ]);
    expect(r.ok, r.output).toBe(true);
    expect(r.output).toContain("--report 模式");
  },
);

test.concurrent(
  "⑦ 非废弃、且官方两份配置都没提到的规则：没登记也不开 → 阻断（「没人决定过」）",
  async () => {
    /* 把 prefer-tag-over-role 那一条从台账里摘掉 —— 它现在就落在
     「官方 recommended / strict 都没提到、也没被标记废弃」那一格，
     摘掉登记之后本仓对它就没有任何裁决痕迹了。 */
    const r = await runWithLedger({
      ...REAL_LEDGER,
      dialect: REAL_LEDGER.dialect.filter(
        (d) => d.rule !== "jsx-a11y/prefer-tag-over-role",
      ),
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("既不在官方 recommended、也不在官方 strict");
    expect(r.output).toContain("prefer-tag-over-role");
  },
);

test.concurrent("⑧ 那一格登记齐了 → 放行（本仓真表就是绿的）", async () => {
  /* 与 ⑦ 对照：真台账里 prefer-tag-over-role 已登记，于是这一向不再报它。
     注意断言的是**这一向**的输出里没有它，不是「整体没红」——
     整体绿由第 1 条用例守着。 */
  const r = await runWithLedger(REAL_LEDGER);
  expect(r.ok, r.output).toBe(true);
  expect(r.output).not.toContain("既不在官方 recommended、也不在官方 strict");
});

test.concurrent(
  "⑨ 官方标了 deprecated 的规则不算「没人决定过」（不逼人给废弃规则表态）",
  async () => {
    /* `accessible-emoji` / `no-onchange` / `label-has-for` 是官方 ❌ deprecated，
     两边配置不提是对的 —— 判据按插件的 `meta.deprecated` 认出来并跳过。 */
    const r = await runWithLedger({ ...REAL_LEDGER, dialect: [] });
    expect(r.output).not.toContain("accessible-emoji 既不在官方");
    expect(r.output).not.toContain("no-onchange 既不在官方");
    expect(r.output).not.toContain("label-has-for 既不在官方");
  },
);

test.concurrent(
  "⑩ `--ledger` 缺路径 → 退 2（不许静默退回真台账）",
  async () => {
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
  },
);
