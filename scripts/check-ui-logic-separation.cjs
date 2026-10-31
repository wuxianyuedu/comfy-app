#!/usr/bin/env node
// @ts-nocheck -- UI/逻辑分离判据（供 .githooks/pre-commit 调用）
/**
 * UI / 逻辑分离护栏 —— 规范见 docs/standards/17-UI与逻辑分离.md
 *
 * 背景：本项目已有 eslint 的 server/components 分层边界(eslint.config.js)，
 * 但「UI 与业务逻辑混写」没有机器判定——组件里直接 fetch、直接调 tRPC、
 * 内联 async 处理器，导致逻辑无法单测、界面无法由工具重生成。
 * 本脚本按 §16.2.1 的四层范式（配置/逻辑/视图/容器）判定 —— **全部是硬闸**：
 * 命中即退 1（ISSUE #1811 收尾时 S* 从棘轮翻上来：存量已清零，棘轮车道没有成员，
 * 于是删基线、删 `--update` / `--strict`）。
 *
 * 硬规则（H*）：
 *   H1 .ts 逻辑模块不得 import .tsx（逻辑层反引视图层 = 依赖倒置）
 *   H2 src/lib/** 不得使用 React（lib 无 React，R4 已禁 .tsx，此条补齐 .ts）
 * 指标（S*）—— 同为硬闸：
 *   S1 视图文件内裸 fetch()
 *   S2 视图文件内 vanillaApi.*
 *   S3 视图文件内 tRPC hook（api.<router>.<proc>.useQuery/useMutation）
 * 提示（不构成失败）：视图内内联 async 事件处理器（多数是纯 UI 交互，人工判断）
 *
 * 用法：
 *   node scripts/check-ui-logic-separation.cjs            # 检查（硬闸：命中即退 1）
 */
const fs = require("node:fs");
const path = require("node:path");
const { gateFail, gatePass } = require("./ci-log.mjs");

const ROOT = path.resolve(__dirname, "..");

/* ── 扫描范围 ────────────────────────────────────────────── */

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") {
        continue;
      }
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}
const rel = (p) =>
  p
    .split(path.sep)
    .join("/")
    .replace(ROOT.split(path.sep).join("/") + "/", "");

/** 指标作用域：视图层（组件 + 路由页面）。Route Handler 是服务端入口，不计。 */
const RATCHET_DIRS = ["src/components", "src/app"];
const RATCHET_EXCLUDE = [
  // Route Handler 是服务端入口，服务端本就该发请求，不属于「UI 混写逻辑」
  /^src\/app\/api\//,
  /* `<feature>/hooks/` 是 §16.2.1 指定的第②层（逻辑层）：hook 里出现 IO 是合规的，
   * 故此目录下的文件不计入指标。治理一个组件的正确动作就是把逻辑搬进 hooks/——
   * 搬完指标自动归零。 */
  /\/hooks\//,
];
/** 硬规则作用域：全部源码。 */
const HARD_DIRS = ["src"];

const isTest = (r) => /\.test\.[cm]?[jt]sx?$/.test(r) || r.includes("/__tests__/");

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
    label: "视图内 tRPC 取数（应经 controller hook 暴露数据）",
    /* ⚠️ 这条判据**跟着调用形状走**：集成层从 classic（`createTRPCReact`）换到
     * `@trpc/tanstack-react-query` 之后，视图里再也出现不了 `api.x.y.useQuery` ——
     * 只认旧字样的话，闸会**静默失明**（新形状 `trpc.x.y.queryOptions(...)` 一条都不计）。
     * 所以两种形状并列表述：classic 的 hook 字样 + 新集成的 options 工厂。
     * 换集成时若忘了改这里，`check-ui-logic-separation` 会一路零违规，什么都拦不住。 */
    count: (t) =>
      (
        t.match(
          /\bapi\s*\.[A-Za-z0-9_]+\s*\.[A-Za-z0-9_]+\s*\.(?:useQuery|useMutation|useInfiniteQuery|useSubscription)\b|(?<![A-Za-z0-9_])(?:queryOptions|mutationOptions|infiniteQueryOptions|subscriptionOptions|queryFilter)\s*\(/g,
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
    if (!fs.existsSync(abs)) {
      continue;
    }
    for (const f of walk(abs)) {
      const r = rel(f);
      if (!/\.[jt]sx?$/.test(r) || r.endsWith(".d.ts")) {
        continue;
      }
      if (isTest(r)) {
        continue;
      }
      if (RATCHET_EXCLUDE.some((re) => re.test(r))) {
        continue;
      }
      const t = fs.readFileSync(f, "utf8");
      for (const [id, rule] of Object.entries(COUNT_RULES)) {
        const n = rule.count(t);
        if (n > 0) {
          (ratchet[r] ||= {})[id] = n;
        }
      }
      for (const [id, rule] of Object.entries(HINT_RULES)) {
        const n = rule.count(t);
        if (n > 0) {
          (hints[r] ||= {})[id] = n;
        }
      }
    }
  }

  for (const dir of HARD_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) {
      continue;
    }
    for (const f of walk(abs)) {
      const r = rel(f);
      if (!/\.[jt]sx?$/.test(r) || r.endsWith(".d.ts")) {
        continue;
      }
      if (isTest(r)) {
        continue;
      }
      const t = fs.readFileSync(f, "utf8");
      // H1：逻辑模块（.ts）反引视图文件（.tsx）。
      // 只认 import/export 语句里的模块说明符——渲染链路（*-render-chain.ts）
      // 里那些 .tsx 是「点击复制路径」的调试用字符串常量，不是依赖。
      if (/\.ts$/.test(r)) {
        const specs = [
          ...(t.match(/\bimport\s+(?:type\s+)?[^;]*?\bfrom\s*["']([^"']+)["']/g) || []),
          ...(t.match(/\bexport\s+(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g) || []),
          ...(t.match(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g) || []),
        ]
          .map(
            (stmt) =>
              (stmt.match(/["']([^"']+)["'](?!.*\bfrom\b)/) ||
                stmt.match(/["']([^"']+)["']/) ||
                [])[1],
          )
          .filter((s) => typeof s === "string" && s.endsWith(".tsx"));
        if (specs.length) {
          hard.push(`H1 逻辑模块反引 .tsx → ${r}（${[...new Set(specs)].join(", ")}）`);
        }
      }
      // H2：lib 下不得出现 React
      if (r.startsWith("src/lib/") && /\bfrom\s+["']react["']/.test(t)) {
        hard.push(`H2 src/lib 内禁止 React → ${r}（改用 components/<feature>/hooks/）`);
      }
    }
  }
  return { ratchet, hints, hard };
}

function total(map) {
  let n = 0;
  for (const v of Object.values(map)) {
    for (const c of Object.values(v)) {
      n += c;
    }
  }
  return n;
}

/* ── 主流程 ──────────────────────────────────────────────── */

const now = collect();

/* 存量已清零 ⇒ 这是硬闸：**每一处命中都阻断**，没有基线、没有 `--update`。
 * 此前它是棘轮（`scripts/.ui-logic-baseline.json`），而清零后的棘轮只剩两个
 * 无事可做的动作 + 一条「手改 JSON 就能把新违规登记成已知存量」的通道 ——
 * 硬闸类本来没有那个中间态（§13.6.2 的两类对照）。 */

const problems = [...now.hard];
for (const [file, counts] of Object.entries(now.ratchet)) {
  for (const [id, n] of Object.entries(counts)) {
    problems.push(`${id}（${COUNT_RULES[id].label}）→ ${file}（${n} 处）`);
  }
}

const hintLines = Object.entries(now.hints).map(([r, c]) => `  ${r}（内联 async ${c.S4} 处）`);

/* 判决行只有一处出处（`scripts/ci-log.mjs`，ISSUE #2506）。提示行留在判决**之前** ——
 * 它讲的是「不计入的那些」，排在红之后会被读成「也是这次要修的东西」。 */
if (hintLines.length) {
  console.log("[ui-logic] 内联 async 处理器（仅提示，不计入）：\n" + hintLines.join("\n"));
}

if (problems.length) {
  gateFail("UI/逻辑分离", problems, {
    detail: `违规 ${total(now.ratchet)} 处 · ${Object.keys(now.ratchet).length} 个文件`,
    hint:
      "判据是硬闸（无基线、无 --update）：存量已清零，新增即阻断。\n" +
      "规范见 docs/standards/17-UI与逻辑分离.md；修法是把逻辑搬进 <feature>/hooks/\n" +
      "或 src/lib/<domain>-client.ts（搬完指标自动归零）。",
  });
  process.exit(1);
}
gatePass("UI/逻辑分离", "扫描面内 0 处违规");
