/**
 * 「jsx-a11y 的规则开关 ⇄ 判据」门禁自测（规范 06 §6.12）。
 *
 * 判据 `scripts/check-a11y-rules.cjs` 的三向口径逐条钉住：
 *   ① 官方 `recommended` 的每一条都必须开着、options 与官方逐字一致
 *   ② 台账里登记的每一处「方言」必须是真的关着（双向）
 *   ③ 官方 recommended 里被关掉的必须登记（悄悄关掉 = 判据睡着）
 *   ④ 就地豁免的文件要存在、理由与 keeper 要写全
 *
 * 走项目共享的门禁自测夹具（`tests/helpers/gate-repo.ts`，§11.16.1）——
 * 不手搓第十七份临时仓库样板。
 */
import { defineGateRepo } from "./helpers/gate-repo";

const { test, expect } = defineGateRepo({
  script: "check-a11y-rules.cjs",
  dirs: ["src"],
  /* 判据会动态 `import()` 仓库根的 `eslint.config.js` —— 那份配置自己又
   * import 了整个 `eslint-config-next`，在临时仓库里跑不起来（没有
   * node_modules）。所以这里**用真的仓库根**跑判定，只把台账搬进临时仓库
   * 来测「台账 ⇄ 生效配置」那几向 —— 见下面 `LEGACY` 的用法。 */
});

/** 真仓库根 —— 判据要读的 `eslint.config.js` 只有真根上有。 */
const REAL_ROOT = process.cwd();

/**
 * 跑一次判据，**工作目录固定在真仓库根**（它要 import 真的 eslint 配置），
 * 而台账文件由用例自己给。
 *
 * `repo.run` 把 cwd 设成临时仓库 —— 那份配置在那里 import 会崩。所以这里
 * 直接用 `execFileSync` 跑真脚本、`cwd` 给真根，并用 `--ledger` 之外的办法
 * 控制台账：**备份 / 还原真台账**（用例之间串文件即此处唯一风险，故放在
 * `try/finally` 里）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const SCRIPT = path.join(REAL_ROOT, "scripts", "check-a11y-rules.cjs");
const LEDGER = path.join(REAL_ROOT, "scripts", ".a11y-rule-ledger.json");

function runWithLedger(ledger: unknown, args: string[] = []) {
  const backup = readFileSync(LEDGER, "utf8");
  try {
    writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
    const output = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: REAL_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  } finally {
    writeFileSync(LEDGER, backup);
  }
}

/** 从真台账里读出「官方 recommended」那两条已知的方言，供夹具复用。 */
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

test("真台账是绿的（当前状态自查）", () => {
  const r = runWithLedger(REAL_LEDGER);
  expect(r.ok, r.output).toBe(true);
  expect(r.output).toContain("官方 recommended");
});

test("① 官方 recommended 被悄悄关掉、台账里没有 → 阻断并点名", () => {
  const r = runWithLedger({ ...REAL_LEDGER, dialect: [] });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("属官方 recommended 却被关掉了");
  expect(r.output).toContain("no-autofocus");
});

test("② 台账说关着、实际却开着 → 阻断（登记是负债不是赦免名单）", () => {
  const r = runWithLedger({
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

test("③ 台账登记了不存在的规则 → 阻断（改名 / 换插件后的孤儿条目）", () => {
  const r = runWithLedger({
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

test("④ 方言缺「为什么」或「谁在守它」→ 阻断（空理由没有记账价值）", () => {
  const noWhy = runWithLedger({
    ...REAL_LEDGER,
    dialect: REAL_LEDGER.dialect.map((d) => ({ ...d, why: "" })),
  });
  expect(noWhy.ok).toBe(false);
  expect(noWhy.output).toContain("没写「为什么」");

  const noKeeper = runWithLedger({
    ...REAL_LEDGER,
    dialect: REAL_LEDGER.dialect.map((d) => ({ ...d, keeper: "" })),
  });
  expect(noKeeper.ok).toBe(false);
  expect(noKeeper.output).toContain("没写「谁在守它」");
});

test("⑤ 就地豁免指向不存在的文件 → 阻断（改名 / 搬走后的过期条目）", () => {
  const r = runWithLedger({
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

test("⑥ `--report` 只出清单、不判失败（恒 0）—— 报告档的语义", () => {
  const r = runWithLedger({ ...REAL_LEDGER, dialect: [] }, ["--report"]);
  expect(r.ok, r.output).toBe(true);
  expect(r.output).toContain("--report 模式");
});

test("⑦ 非废弃、且官方两份配置都没提到的规则：没登记也不开 → 阻断（「没人决定过」）", () => {
  /* 把 prefer-tag-over-role 那一条从台账里摘掉 —— 它现在就落在
     「官方 recommended / strict 都没提到、也没被标记废弃」那一格，
     摘掉登记之后本仓对它就没有任何裁决痕迹了。 */
  const r = runWithLedger({
    ...REAL_LEDGER,
    dialect: REAL_LEDGER.dialect.filter(
      (d) => d.rule !== "jsx-a11y/prefer-tag-over-role",
    ),
  });
  expect(r.ok).toBe(false);
  expect(r.output).toContain("既不在官方 recommended、也不在官方 strict");
  expect(r.output).toContain("prefer-tag-over-role");
});

test("⑧ 那一格登记齐了 → 放行（本仓真表就是绿的）", () => {
  /* 与 ⑦ 对照：真台账里 prefer-tag-over-role 已登记，于是这一向不再报它。
     注意断言的是**这一向**的输出里没有它，不是「整体没红」——
     整体绿由第 1 条用例守着。 */
  const r = runWithLedger(REAL_LEDGER);
  expect(r.ok, r.output).toBe(true);
  expect(r.output).not.toContain("既不在官方 recommended、也不在官方 strict");
});

test("⑨ 官方标了 deprecated 的规则不算「没人决定过」（不逼人给废弃规则表态）", () => {
  /* `accessible-emoji` / `no-onchange` / `label-has-for` 是官方 ❌ deprecated，
     两边配置不提是对的 —— 判据按插件的 `meta.deprecated` 认出来并跳过。
     夹具：把台账里所有 dialect 摘空，若判据把废弃规则也算进那一格，
     这里就会报出一串 deprecated 的名字。 */
  const r = runWithLedger({ ...REAL_LEDGER, dialect: [] });
  expect(r.output).not.toContain("accessible-emoji 既不在官方");
  expect(r.output).not.toContain("no-onchange 既不在官方");
  expect(r.output).not.toContain("label-has-for 既不在官方");
});
