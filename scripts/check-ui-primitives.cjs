#!/usr/bin/env node
// @ts-nocheck -- UI 基元复用棘轮（供 .githooks/pre-commit 调用）
/**
 * UI 基元复用护栏 —— 规范见 docs/standards/16-shadcn-ui与表单校验.md §16.2.3。
 *
 * 背景（ISSUE #672「前端 ui 组件是否完善、是否符合商业级水平」）：
 * 全量扫描实测出三件事 —— ① `src/components/ui/` 有 29 个基元，业务侧只用到了
 * 寥寥几个；② 视图里手写 `<button>` 427 处、自建 `createPortal` 浮层 12 处，
 * 同一套「按钮 / 浮层」在四五个目录里各实现一份；③ 各 feature 目录都摆着
 * 「通用件」，`ui/` 反而空着。
 *
 * 这件事的难点不在「改不改」，而在**判据**：UI 一致性没有任何机器判据
 * （`scripts/` 下只有 `check-ui-logic-separation.cjs`，管的是 IO 分层，不管
 * 组件复用）。本仓库的历史结论是「只提醒 = 没有判据」（§12.13 / §12.16 同款），
 * 所以这里给的是**计数棘轮**：先把存量冻结在基线，再逐批降，只许降不许升。
 *
 * 判据（三条，都是「视图层是不是自己实现了一份基元」）：
 *   P1 视图层手写 `<button`（应使用 `~/components/ui/button` 的 `<Button>`）
 *   P2 视图层自建 `createPortal(` 浮层（应使用 `ui/dialog` / `ui/popover` /
 *      `ui/sheet` / `ui/dropdown-menu`）
 *   P3 视图文件里重复定义内联 `animate-spin` / `animate-pulse`（应使用
 *      `ui/page-loading` 的 `PageLoading`（块级）/ `Spinner`（行内 · 按钮内）、
 *      `ui/skeleton` / `ui/progress` 这类加载态基元，状态圆点的脉冲走
 *      `ui/status-dot`）
 *   —— 三者合计走一条棘轮：**按文件记账、只许降不许升**，与
 *      `check-ui-logic-separation.cjs` / `check-theme-colors.cjs` 同一口径
 *      （基线 `scripts/.ui-primitives-baseline.json`）。
 *
 * ⚠️ 为什么会把「内联 animate-spin」也算进来：它不是「样式问题」，而是
 * 「这个加载态本该复用基元」。单独看每一处都「没毛病」，全库一起才看得出
 * 有 19 份自写 spinner —— 与 §12.12「跨文件重复块」是同一族问题。
 *
 * 豁免（显式，不做模糊放行）：
 *   · `src/components/ui/**`      基元自己的实现（Button 里本来就是 `<button>`）；
 *   · `src/components/studio/ui/**`、`src/components/studio/shared/**` 等既有
 *     「第二套 UI kit」目录：它们**是**要合并进 `ui/` 的对象（§16.2.3 的 P2/P3），
 *     记在规范里逐批迁，不在本棘轮里重复计一遍（同一件事只定义一次口径）；
 *   · `<feature>/hooks/**`        §16.2.1 第②层（逻辑层），不是视图；
 *   · `*.test.*` / `__tests__/**` 测试里的 DOM 与 mock 不算视图实现。
 *
 * 用法：
 *   node scripts/check-ui-primitives.cjs            # 检查（棘轮：只许降不许升）
 *   node scripts/check-ui-primitives.cjs --strict   # 基线下调也失败（强制收紧）
 *   node scripts/check-ui-primitives.cjs --report   # 只出清单，不判失败（排批次用）
 *   node scripts/check-ui-primitives.cjs --update   # 治理后重写基线（须伴随下降）
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const BASELINE = path.join(__dirname, ".ui-primitives-baseline.json");

/* ── 扫描范围 ────────────────────────────────────────────── */

/** 棘轮作用域：视图层（组件 + 路由页面）——与 UI/逻辑分离棘轮的 RATCHET_DIRS 同口径。 */
const SCAN_DIRS = ["src/components", "src/app"];

/**
 * 豁免目录（正则，均按仓库相对 POSIX 路径匹配）与理由：
 *
 * - `ui/`：基元自身实现，`<button>` / portal 在这里是**正确的载体**；
 * - `studio/ui/` 与 `studio/shared/`：历史形成的第二套 UI kit（详见 §16.2.3），
 *   它们的去向是「合并到 `ui/`」而不是「在本棘轮里再记一笔」——同一件事
 *   只定义一次口径，否则两处数字会各自漂移；
 * - `hooks/`：§16.2.1 第②层，逻辑层里出现 IO/样式拼接不是「视图自己实现一份」。
 */
const EXEMPT_DIRS = [
  { re: /^src\/components\/ui\//, reason: "ui/ 基元自身实现" },
  {
    re: /^src\/components\/studio\/ui\//,
    reason:
      "历史第二套 UI kit（去向是合并进 ui/，分批计划见规范 §16.2.4）",
  },
  {
    re: /^src\/components\/studio\/shared\//,
    reason: "同上：shared/ 里的通用件是 §16.2.4 的迁移对象",
  },
  { re: /\/hooks\//, reason: "§16.2.1 第②层（逻辑层），不算视图实现" },
];


/* ── 三条判据 ────────────────────────────────────────────── */

/**
 * 去掉 `//` 行注释与 `/* … *\/` 块注释（保留换行，便于定位）。
 *
 * **为什么判据必须先过这一层**：注释里描述「本组件渲染一个 `<button>`」、
 * 「原来是 `<button>` 手写实现」是**说明**，不是视图实现。不剥注释时，把一处
 * 手写按钮改成 `<Button>` 并把理由写进注释，会让该文件的计数**停在原地**
 * —— 棘轮于是永远降不下去，而代码其实已经合规。
 * （同款教训见 `scripts/check-theme-colors.cjs` 的 `stripComments`：
 * 注释里的 `#346` ISSUE 引用被误判成 3 位色值。）
 *
 * 字符串/模板字面量**不**剥离：`"<button"` 出现在字面量里同样是「自己实现
 * 一份」的信号，保守计上更安全（NUL 哨兵那类反例见规范 §12.11）。
 */
function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  let inBlock = false;
  let inLine = false;
  while (i < n) {
    const ch = text[i];
    const nx = text[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      } else out += " ";
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && nx === "/") {
        inBlock = false;
        out += "  ";
        i += 2;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (ch === "/" && nx === "/") {
      inLine = true;
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && nx === "*") {
      inBlock = true;
      out += "  ";
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const RULES = {
  P1: {
    label: "视图内手写 <button>（应使用 ~/components/ui/button 的 <Button>）",
    count: (t) => (stripComments(t).match(/<button\b/g) || []).length,
  },
  P2: {
    label: "视图内自建 createPortal 浮层（应使用 ui/dialog / popover / sheet）",
    count: (t) => (stripComments(t).match(/\bcreatePortal\s*\(/g) || []).length,
  },
  P3: {
    label:
      "视图内自写加 spinner/pulse 动画（应使用 ui/page-loading 的 PageLoading / Spinner、ui/skeleton / ui/progress）",
    count: (t) => (stripComments(t).match(/\banimate-(?:spin|pulse)\b/g) || []).length,
  },
};

/* ── 采集 ────────────────────────────────────────────────── */

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__snapshots__") continue;
      walk(rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

const isTest = (r) =>
  /\.test\.[cm]?[jt]sx?$/.test(r) || r.includes("/__tests__/");

/** 收集当前各文件的违规计数：rel -> { P1?, P2?, P3? }。 */
function collect() {
  const files = {};
  for (const dir of SCAN_DIRS) {
    for (const rel of walk(dir)) {
      if (!/\.[jt]sx?$/.test(rel) || rel.endsWith(".d.ts")) continue;
      if (isTest(rel)) continue;
      if (EXEMPT_DIRS.some((e) => e.re.test(rel))) continue;
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      for (const [id, rule] of Object.entries(RULES)) {
        const n = rule.count(text);
        if (n > 0) (files[rel] ||= {})[id] = n;
      }
    }
  }
  return files;
}

function total(map) {
  let n = 0;
  for (const v of Object.values(map)) for (const c of Object.values(v)) n += c;
  return n;
}

/* ── 基线读写（棘轮只许下降） ────────────────────────────── */

function writeBaseline(files) {
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        note:
          "视图层自实现 UI 基元的存量（规范 16 §16.2.3）。棘轮只许下降；" +
          "新增请先改用 ui/ 基元，不要用 --update 放水。" +
          "豁免口径见脚本内 EXEMPT_DIRS（与规范 §16.2.3 同源）。",
        rules: Object.fromEntries(
          Object.entries(RULES).map(([id, r]) => [id, r.label]),
        ),
        total: total(files),
        files,
      },
      null,
      2,
    ) + "\n",
  );
}

function main() {
  const now = collect();
  const prev = fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, "utf8"))
    : null;
  const baseFiles = prev?.files ?? null;

  if (UPDATE) {
    const before = baseFiles ? total(baseFiles) : 0;
    const after = total(now);
    if (before && after > before) {
      console.error(
        `[ui-primitives] 拒绝放宽基线：${before} → ${after}（棘轮只许下降）。\n` +
          "  新增的自实现请先改用 ui/ 基元（<Button> / ui/dialog / page-loading），不要用 --update 掩盖。",
      );
      process.exit(1);
    }
    writeBaseline(now);
    console.log(
      `[ui-primitives] 基线已更新：${before} → ${after}（${path.relative(ROOT, BASELINE)}）`,
    );
    process.exit(0);
  }

  /* 报告层：只出清单（排批次用，不判失败）。 */
  if (REPORT_ONLY) {
    for (const [id, rule] of Object.entries(RULES)) {
      const hits = Object.entries(now)
        .filter(([, c]) => c[id])
        .sort((a, b) => b[1][id] - a[1][id]);
      const sum = hits.reduce((n, [, c]) => n + c[id], 0);
      console.log(
        `[ui-primitives] ${id} ${rule.label} —— ${sum} 处 / ${hits.length} 文件`,
      );
      for (const [rel, c] of hits.slice(0, 15)) {
        console.log(`  · ${rel}（${c[id]} 处）`);
      }
      if (hits.length > 15) console.log(`  … 另 ${hits.length - 15} 个文件`);
    }
    console.log("[ui-primitives] --report 模式：只出清单，不判失败 ✓");
    process.exit(0);
  }

  if (!baseFiles) {
    console.error(
      "[ui-primitives] 基线文件缺失：先执行 node scripts/check-ui-primitives.cjs --update",
    );
    process.exit(1);
  }

  const problems = [];
  const dropped = [];
  for (const [rel, counts] of Object.entries(now)) {
    const b = baseFiles[rel];
    for (const [id, n] of Object.entries(counts)) {
      if (!b || b[id] === undefined) {
        problems.push(`新增 ${id}（${RULES[id].label}）→ ${rel}（${n} 处）`);
      } else if (n > b[id]) {
        problems.push(
          `${id} 上升 ${b[id]} → ${n} → ${rel}（${RULES[id].label}）`,
        );
      } else if (n < b[id]) {
        dropped.push(`${id} ${b[id]} → ${n}：${rel}`);
      }
    }
  }
  for (const [rel, b] of Object.entries(baseFiles)) {
    const cur = now[rel];
    for (const [id, n] of Object.entries(b)) {
      if (!cur || cur[id] === undefined) dropped.push(`${id} ${n} → 0：${rel}`);
    }
  }

  const sum = total(now);
  console.log(
    `[ui-primitives] 当前自实现存量 ${sum} 处 / ${Object.keys(now).length} 个文件` +
      `（规范 16 §16.2.3）`,
  );

  if (problems.length) {
    console.error("[ui-primitives] 违规（阻断）：\n  " + problems.join("\n  "));
    console.error(
      "  规范见 docs/standards/16-shadcn-ui与表单校验.md §16.2.3；\n" +
        "  改法：`<button>` → `<Button>`（~/components/ui/button）、自建 portal → ui/dialog / popover / sheet、\n" +
        "  自写 animate-spin → ui/page-loading。治理后执行 --update 收紧基线。",
    );
    process.exit(1);
  }

  if (dropped.length) {
    const msg =
      `[ui-primitives] 检测到 ${dropped.length} 处下降，请收紧基线：\n  ` +
      dropped.join("\n  ") +
      "\n  执行 node scripts/check-ui-primitives.cjs --update";
    if (STRICT) {
      console.error(msg);
      process.exit(1);
    }
    console.log(msg + "（当前非 --strict，仅提示）");
  }
  console.log("[ui-primitives] OK");
}

main();
