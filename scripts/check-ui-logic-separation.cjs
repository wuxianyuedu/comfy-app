#!/usr/bin/env node
// @ts-nocheck -- UI/逻辑分离棘轮(供 .githooks/pre-commit 与 CI 调用)
/**
 * UI / 逻辑分离护栏 —— 规范见 docs/standards/17-UI与逻辑分离.md
 *
 * 背景：本项目已有 eslint 的 server/components 分层边界(eslint.config.js)，
 * 但「UI 与业务逻辑混写」没有机器判定——组件里直接 fetch、直接调 tRPC、
 * 内联 async 处理器，导致逻辑无法单测、界面无法由工具重生成。
 * 本脚本按 §16.2.1 的四层范式（配置/逻辑/视图/容器）做**计数棘轮**：
 * 违规数只许降不许升，新增违规阻断提交，逐批治理把基线压到零。
 *
 * 硬规则（H*）——立即阻断，不进棘轮：
 *   H1 .ts 逻辑模块不得 import .tsx（逻辑层反引视图层 = 依赖倒置）
 *   H2 src/lib/** 不得使用 React（lib 无 React，R4 已禁 .tsx，此条补齐 .ts）
 * 棘轮指标（S*）——只许下降，见 scripts/.ui-logic-baseline.json：
 *   S1 视图文件内裸 fetch()
 *   S2 视图文件内 vanillaApi.*
 *   S3 视图文件内 tRPC hook（api.<router>.<proc>.useQuery/useMutation）
 * 提示（不构成失败）：视图内内联 async 事件处理器（多数是纯 UI 交互，人工判断）
 *
 * 用法：
 *   node scripts/check-ui-logic-separation.cjs            # 检查（下降仅提示）
 *   node scripts/check-ui-logic-separation.cjs --strict   # 下降也失败（CI 用，强制收紧基线）
 *   node scripts/check-ui-logic-separation.cjs --update   # 治理后重写基线（须伴随下降）
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(__dirname, ".ui-logic-baseline.json");
const args = new Set(process.argv.slice(2));
const UPDATE = args.has("--update");
const STRICT = args.has("--strict");

/* ── 扫描范围 ────────────────────────────────────────────── */

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}
const rel = (p) =>
  p
    .split(path.sep)
    .join("/")
    .replace(ROOT.split(path.sep).join("/") + "/", "");

/** 棘轮作用域：视图层（组件 + 路由页面）。Route Handler 是服务端入口，不计。 */
const RATCHET_DIRS = ["src/components", "src/app"];
const RATCHET_EXCLUDE = [
  // Route Handler 是服务端入口，服务端本就该发请求，不属于「UI 混写逻辑」
  /^src\/app\/api\//,
  /* `<feature>/hooks/` 是 §16.2.1 指定的第②层（逻辑层）：hook 里出现 IO 是合规的，
   * 故此目录下的文件不计入棘轮。治理一个组件的正确动作就是把逻辑搬进 hooks/——
   * 搬完指标自动归零，棘轮因此能真实反映进度。 */
  /\/hooks\//,
];
/** 硬规则作用域：全部源码。 */
const HARD_DIRS = ["src"];

const isTest = (r) =>
  /\.test\.[cm]?[jt]sx?$/.test(r) || r.includes("/__tests__/");

/* ── 指标 ────────────────────────────────────────────────── */

const COUNT_RULES = {
  S1: {
    label: "视图内裸 fetch()（应下沉到 lib/<domain>-api.ts 或 hooks/）",
    count: (t) => (t.match(/\bfetch\s*\(/g) || []).length,
  },
  S2: {
    label: "视图内 vanillaApi.*（应经 controller hook 暴露 action）",
    count: (t) => (t.match(/\bvanillaApi\s*\./g) || []).length,
  },
  S3: {
    label: "视图内 tRPC hook（应经 controller hook 暴露数据）",
    count: (t) =>
      (
        t.match(
          /\bapi\s*\.[A-Za-z0-9_]+\s*\.[A-Za-z0-9_]+\s*\.(?:useQuery|useMutation|useInfiniteQuery|useSubscription)\b/g,
        ) || []
      ).length,
  },
};

const HINT_RULES = {
  S4: {
    label: "视图内内联 async 事件处理器（多数属纯 UI 交互，人工判断是否下沉）",
    count: (t) => (t.match(/=\s*async\s*\(/g) || []).length,
  },
};

/* ── 采集 ────────────────────────────────────────────────── */

function collect() {
  const ratchet = {}; // rel -> { S1: n, S2: n, S3: n }
  const hints = {}; // rel -> { S4: n }
  const hard = [];

  for (const dir of RATCHET_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of walk(abs)) {
      const r = rel(f);
      if (!/\.[jt]sx?$/.test(r) || r.endsWith(".d.ts")) continue;
      if (isTest(r)) continue;
      if (RATCHET_EXCLUDE.some((re) => re.test(r))) continue;
      const t = fs.readFileSync(f, "utf8");
      for (const [id, rule] of Object.entries(COUNT_RULES)) {
        const n = rule.count(t);
        if (n > 0) (ratchet[r] ||= {})[id] = n;
      }
      for (const [id, rule] of Object.entries(HINT_RULES)) {
        const n = rule.count(t);
        if (n > 0) (hints[r] ||= {})[id] = n;
      }
    }
  }

  for (const dir of HARD_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of walk(abs)) {
      const r = rel(f);
      if (!/\.[jt]sx?$/.test(r) || r.endsWith(".d.ts")) continue;
      if (isTest(r)) continue;
      const t = fs.readFileSync(f, "utf8");
      // H1：逻辑模块（.ts）反引视图文件（.tsx）。
      // 只认 import/export 语句里的模块说明符——渲染链路（*-render-chain.ts）
      // 里那些 .tsx 是「点击复制路径」的调试用字符串常量，不是依赖。
      if (/\.ts$/.test(r)) {
        const specs = [
          ...(t.match(
            /\bimport\s+(?:type\s+)?[^;]*?\bfrom\s*["']([^"']+)["']/g,
          ) || []),
          ...(t.match(
            /\bexport\s+(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g,
          ) || []),
          ...(t.match(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g) || []),
        ]
          .map(
            (stmt) =>
              (stmt.match(/["']([^"']+)["'](?!.*\bfrom\b)/) ||
                stmt.match(/["']([^"']+)["']/) ||
                [])[1],
          )
          .filter((s) => typeof s === "string" && s.endsWith(".tsx"));
        if (specs.length)
          hard.push(
            `H1 逻辑模块反引 .tsx → ${r}（${[...new Set(specs)].join(", ")}）`,
          );
      }
      // H2：lib 下不得出现 React
      if (r.startsWith("src/lib/") && /\bfrom\s+["']react["']/.test(t)) {
        hard.push(
          `H2 src/lib 内禁止 React → ${r}（改用 components/<feature>/hooks/）`,
        );
      }
    }
  }
  return { ratchet, hints, hard };
}

function total(map) {
  let n = 0;
  for (const v of Object.values(map)) for (const c of Object.values(v)) n += c;
  return n;
}

/**
 * 逐 `(文件, 指标)` 比较基线与现状 —— **两条路径共用这一份口径**（ISSUE #1359）。
 *
 * 原来 `--update` 只比总数，而且是 `if (before && after > before)`：基线总数为 0 时整个条件短路，
 * 上升检查根本不执行。真仓库今天的基线正是 `total: 0 / files: {}`（治理做完了的那个状态），
 * 于是「往视图层新写一条 `fetch(`，再跑一次 `--update`」就能把它收进基线 —— 硬规则 10 的棘轮
 * 在最不该松的时候松着。总数比较还有第二个洞：修掉 A 的一处、同时新写 B 的一处，总数不变也放行。
 * 「同一个门禁两套口径」里弱的那一条，恰好是收口用的那一条。
 *
 * 口径与非 `--update` 路径一致：新增条目与计数上升都算**放宽**（拒），下降与条目消失算**收紧**。
 *
 * @param {Record<string, Record<string, number>>} baseFiles
 * @param {Record<string, Record<string, number>>} nowFiles
 * @returns {{
 *   added: { id: string, file: string, now: number, base: number | null }[],
 *   dropped: { id: string, file: string, base: number, now: number }[],
 * }}
 */
function diffAgainstBaseline(baseFiles, nowFiles) {
  /** @type {{ id: string, file: string, now: number, base: number | null }[]} */
  const added = [];
  /** @type {{ id: string, file: string, base: number, now: number }[]} */
  const dropped = [];
  for (const [file, counts] of Object.entries(nowFiles)) {
    const base = baseFiles[file];
    for (const [id, n] of Object.entries(counts)) {
      const b = base ? base[id] : undefined;
      if (b === undefined) added.push({ id, file, now: n, base: null });
      else if (n > b) added.push({ id, file, now: n, base: b });
      else if (n < b) dropped.push({ id, file, base: b, now: n });
    }
  }
  for (const [file, base] of Object.entries(baseFiles)) {
    const cur = nowFiles[file];
    for (const [id, n] of Object.entries(base)) {
      if (!cur || cur[id] === undefined)
        dropped.push({ id, file, base: n, now: 0 });
    }
  }
  return { added, dropped };
}

/**
 * 读基线的 `files` 映射。
 *
 * 分清楚两种「空」：返回 `null` 是**基线文件不存在**（首次建基线，`--update` 该允许、
 * 检查路径该判红）；返回 `{}` 是有一份写着 0 的基线（这才是今天真仓库的状态，放宽必须拒）。
 * 混成一种就会把「首次记账」和「从 0 放大」一起放过或一起拦掉。
 *
 * @returns {Record<string, Record<string, number>> | null}
 */
function readBaselineFiles() {
  if (!fs.existsSync(BASELINE)) return null;
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  return base.files || {};
}

/* ── 主流程 ──────────────────────────────────────────────── */

const now = collect();

if (UPDATE) {
  const baseFiles = readBaselineFiles();
  if (baseFiles !== null) {
    const { added } = diffAgainstBaseline(baseFiles, now.ratchet);
    if (added.length) {
      console.error(
        `[ui-logic] 拒绝把放宽写进基线（棘轮只许下降，${added.length} 条）：\n  ` +
          added
            .map((a) =>
              a.base === null
                ? `新增 ${a.id}（${COUNT_RULES[a.id].label}）→ ${a.file}（${a.now} 处）`
                : `${a.id} 上升 ${a.base} → ${a.now} → ${a.file}`,
            )
            .join("\n  "),
      );
      console.error(
        "  先修（逻辑搬进 <feature>/hooks/ 或 src/lib/<domain>-client.ts）再 `--update`。\n" +
          "  「总数没变」不是理由：修掉 A 的同时新写 B，也是放宽 —— 基线按 (文件, 指标) 记账，不按总数。\n" +
          "  （ISSUE #1331 对漏洞台账定的就是这条口径：--update 拒绝把新增写进基线。）",
      );
      process.exit(1);
    }
  }
  if (now.hard.length) {
    console.error(
      "[ui-logic] 存在硬规则违规，先修再更新基线：\n  " + now.hard.join("\n  "),
    );
    process.exit(1);
  }
  const before = total(baseFiles || {});
  const after = total(now.ratchet);
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        rules: Object.fromEntries(
          Object.entries({ ...COUNT_RULES }).map(([id, r]) => [id, r.label]),
        ),
        total: after,
        files: now.ratchet,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[ui-logic] 基线已更新：${before} → ${after}（${BASELINE.replace(ROOT, ".")}）`,
  );
  process.exit(0);
}

const problems = [...now.hard];
/** @type {string[]} */
const dropped = [];
const baseFiles = readBaselineFiles();

if (baseFiles === null) {
  problems.push(
    `基线文件缺失：先执行 node scripts/check-ui-logic-separation.cjs --update`,
  );
} else {
  // 与 `--update` 走的是同一个 `diffAgainstBaseline`（ISSUE #1359）：两条路径若各比各的，
  // 「检查说没事、收口说有事」和反过来都会发生，而这两种红都难归因。
  const cmp = diffAgainstBaseline(baseFiles, now.ratchet);
  for (const a of cmp.added) {
    problems.push(
      a.base === null
        ? `新违规 ${a.id}（${COUNT_RULES[a.id].label}）→ ${a.file}（${a.now} 处）`
        : `${a.id} 上升 ${a.base} → ${a.now} → ${a.file}（${COUNT_RULES[a.id].label}）`,
    );
  }
  for (const d of cmp.dropped)
    dropped.push(`${d.id} ${d.base} → ${d.now}：${d.file}`);
}

const hintLines = Object.entries(now.hints).map(
  ([r, c]) => `  ${r}（内联 async ${c.S4} 处）`,
);

console.log(
  `[ui-logic] 当前违规合计 ${total(now.ratchet)} 处，涉及 ${Object.keys(now.ratchet).length} 个文件`,
);
if (hintLines.length) {
  console.log(
    "[ui-logic] 内联 async 处理器（仅提示，不计入棘轮）：\n" +
      hintLines.join("\n"),
  );
}

if (problems.length) {
  console.error("[ui-logic] 违规（阻断）：\n  " + problems.join("\n  "));
  console.error(
    "规范见 docs/standards/17-UI与逻辑分离.md；治理后执行 --update 收紧基线",
  );
  process.exit(1);
}

if (dropped.length) {
  const msg = `[ui-logic] 检测到 ${dropped.length} 处下降，请收紧基线：\n  ${dropped.join("\n  ")}\n  执行 node scripts/check-ui-logic-separation.cjs --update`;
  if (STRICT) {
    console.error(msg);
    process.exit(1);
  }
  console.log(msg + "（当前非 --strict，仅提示）");
}
console.log("[ui-logic] OK");
