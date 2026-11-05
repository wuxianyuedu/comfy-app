#!/usr/bin/env node
// @ts-nocheck -- 浮层层级刻度棘轮（供 .githooks/pre-commit 调用）
/**
 * 浮层层级刻度护栏 —— 规范见 docs/standards/16-shadcn-ui与表单校验.md §16.2.5。
 *
 * 背景（ISSUE #672）：同一件事（下拉浮层 / 模态 / 全屏抽屉）的 z-index 在
 * 十几个文件里各挑一个魔数 —— `9000` / `9001` / `9998` / `9999` / `10000` /
 * `10005` / `10020`，谁也说不清「它比谁高」。P2 把自搓浮层收拢到 `ui/` 原语、
 * 并定下「应用浮层 / 提示」两条刻度；P4 复查时余量里**仍有 7 处自成一档**。
 *
 * 这件事的难点不在「改不改」，而在**判据**：z-index 写错的表现是「时灵时不灵」
 * —— jsdom 不做层叠与命中测试，单测全绿也照样复现（同 §16.2.5 日志面板那条
 * 回归）。本仓库的历史结论是「只提醒 = 没有判据」（§12.13 / §12.16 同款），
 * 所以这里给**计数棘轮**：把存量冻结在基线，只许降不许升。
 *
 * 判据（三条）：
 *   Z1 `zIndex: <数字>`（行内数字字面量）—— 应改走 `Z.*`（~/lib/shell/overlay-z）
 *   Z2 任意值写法 `z-[<数字>]` —— 规范 03 §3.2 已禁（Tailwind v4 用 `z-99`）
 *   Z3 **刻度之外的具名档** `z-<数字>` —— 刻度表里的档各有一个名字
 *      （`z-base` / `z-canvas-ui` / `z-canvas-max` / `z-modal` / `z-popup` /
 *      `z-toast`），写裸数字等于又编了一档
 *
 * 三条**全部是硬闸**：Z1/Z2 很早即清零；Z3 的存量也已清零，于是它的棘轮车道
 * 没有任何成员（`--update` 写回去的永远是一份空账），留着那份基线只剩
 * 「手改 JSON 就能把新违规登记成已知存量」这一条通道 —— 那是硬闸类本来没有的
 * 中间态（规范 §13.6.2 的两类对照）。所以 ISSUE #1811 收尾时删基线、删
 * `--update` / `--strict`，命中即退 1。
 *
 * 豁免（显式，不做模糊放行）：
 *   · 刻度表自身（`src/lib/shell/overlay-z.ts`）与它的类型/契约测试；
 *   · `src/components/ui/**` —— shadcn 工具生成、尽量不手改的目录（同
 *     `check-ui-primitives.cjs` 的 EXEMPT_DIRS 口径）：基元内部的 `z-50`
 *     是**工具生成物**的形态，改成项目 token 会在下一次 `shadcn add` 被改回去，
 *     而 `popup` 在刻度表里高于 `modal`、`z-50` 低于它 —— 机械换算只会算错；
 *   · `*.test.*` / `__tests__/**` 测试里断言的 DOM 与 mock 不算视图实现。
 *
 * 用法：
 *   node scripts/check-overlay-z.cjs            # 检查（硬闸：命中即退 1）
 *   node scripts/check-overlay-z.cjs --staged   # 只在暂存改动触及扫描面时判（钩子用）
 *   node scripts/check-overlay-z.cjs --report   # 只出清单，不判失败（排批次用）
 *
 * `--report` 保留：清零之后的自证靠它（一个永远返回空的扫描器会让「清单为空」
 * 全绿，这与「判据真的在扫」是两件事）。
 */
const fs = require("node:fs");
const path = require("node:path");
const { skipUnlessStagedTouches } = require("./gate-scan-read.cjs");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const STAGED = ARGS.has("--staged");

/** 棘轮作用域：视图层（组件 + 路由页面）——与 UI 基元棘轮同口径。 */
const SCAN_DIRS = ["src/components", "src/app"];

/**
 * 豁免（仓库相对 POSIX 路径）。刻度表自身与 `ui/` 基元目录见上方文件头注释。
 */
const EXEMPT_DIRS = [
  {
    re: /^src\/components\/ui\//,
    reason: "shadcn 工具生成目录（§16.1），不手改",
  },
  { re: /\/hooks\//, reason: "§16.2.1 第②层（逻辑层），不是视图实现" },
];

/** 刻度表里的具名档（与 globals.css 的 `--z-index-*` 同名）。 */
const NAMED_TONES = [
  "base",
  "canvas-ui",
  "canvas-max",
  "modal",
  "popup",
  "toast",
  "overlay",
  "chrome",
];

/**
 * 去掉 `//` 行注释与 `/* … *\/` 块注释（保留换行，便于定位）。
 *
 * 说明性注释里会出现被禁形态（「此前是 `z-9999`」），不剥离会让计数停在原地 ——
 * 棘轮于是永远降不下去，而代码其实已经合规（同 `check-ui-primitives.cjs`
 * 的 stripComments 与 `check-theme-colors.cjs` 的注释剥离）。
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
      } else {
        out += " ";
      }
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
  Z1: {
    label: "行内数字 zIndex（应改走 Z.*，~/lib/shell/overlay-z）",
    count: (t) => (stripComments(t).match(/\bzIndex:\s*\d+/g) ?? []).length,
  },
  Z2: {
    label: "任意值写法 z-[<数字>]（规范 03 §3.2 应写 z-<数字>）",
    count: (t) => (stripComments(t).match(/\bz-\[\d+\]/g) ?? []).length,
  },
  Z3: {
    label:
      "刻度表之外的裸数字档 z-<数字>（应写 z-base / z-canvas-ui / z-canvas-max / z-modal / z-popup / z-toast / z-chrome）",
    count: (t) => {
      const stripped = stripComments(t);
      let n = 0;
      for (const m of stripped.matchAll(/\bz-(?<level>\d+)\b/g)) {
        if (!NAMED_TONES.includes(m.groups?.level ?? "")) {
          n++;
        }
      }
      return n;
    },
  },
};

/* ── 采集 ────────────────────────────────────────────────── */

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) {
    return out;
  }
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__snapshots__") {
        continue;
      }
      walk(rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

const isTest = (r) => /\.test\.[cm]?[jt]sx?$/.test(r) || r.includes("/__tests__/");

/** 收集当前各文件违规计数：rel -> { Z1?, Z2?, Z3? }。 */
function collect() {
  const files = {};
  for (const dir of SCAN_DIRS) {
    for (const rel of walk(dir)) {
      if (!/\.[jt]sx?$/.test(rel) || rel.endsWith(".d.ts")) {
        continue;
      }
      if (isTest(rel)) {
        continue;
      }
      if (EXEMPT_DIRS.some((e) => e.re.test(rel))) {
        continue;
      }
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      for (const [id, rule] of Object.entries(RULES)) {
        const n = rule.count(text);
        if (n > 0) {
          files[rel] ??= {};
          files[rel][id] = n;
        }
      }
    }
  }
  return files;
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

function main() {
  if (STAGED && !REPORT_ONLY) {
    skipUnlessStagedTouches({ roots: SCAN_DIRS, tag: "[overlay-z]" });
  }
  /* 固定入口：判据只认这一个 `--update` 之外的旗标集合，其余一律按检查档跑。
   * `--update` / `--strict` 在本条已不存在（基线删了），传进来也只是被忽略 ——
   * 那正是「断头」的形态：没有隐藏的放宽通道。 */
  const now = collect();

  if (REPORT_ONLY) {
    for (const [id, rule] of Object.entries(RULES)) {
      const hits = Object.entries(now)
        .filter(([, c]) => c[id])
        .sort((a, b) => b[1][id] - a[1][id]);
      const sum = hits.reduce((n, [, c]) => n + c[id], 0);
      console.log(`[overlay-z] ${id} ${rule.label} —— ${sum} 处 / ${hits.length} 文件`);
      for (const [rel, c] of hits.slice(0, 15)) {
        console.log(`  · ${rel}（${c[id]} 处）`);
      }
      if (hits.length > 15) {
        console.log(`  … 另 ${hits.length - 15} 个文件`);
      }
    }
    console.log("[overlay-z] --report 模式：只出清单，不判失败 ✓");
    process.exit(0);
  }

  const problems = [];
  for (const [rel, counts] of Object.entries(now)) {
    for (const [id, n] of Object.entries(counts)) {
      problems.push(`${id}（${RULES[id].label}）→ ${rel}（${n} 处）`);
    }
  }

  const sum = total(now);
  console.log(
    `[overlay-z] 刻度表之外的层级存量 ${sum} 处 / ${Object.keys(now).length} 个文件` +
      `（规范 16 §16.2.5）`,
  );

  if (problems.length) {
    console.error(`[overlay-z] 违规（阻断）：\n  ${problems.join("\n  ")}`);
    console.error(
      "  本判据是硬闸（无基线、无 --update）：存量已清零，新增即阻断。\n" +
        "  规范见 docs/standards/16-shadcn-ui与表单校验.md §16.2.5；\n" +
        "  改法：层级取自刻度表（~/lib/shell/overlay-z 的 Z.* 或 z-modal / z-popup / z-canvas-ui 工具类），\n" +
        "  不要再写裸数字或任意值写法。",
    );
    process.exit(1);
  }
  console.log("[overlay-z] OK");
}

main();
