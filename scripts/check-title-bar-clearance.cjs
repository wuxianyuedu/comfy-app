#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:标题行(页签栏)让位硬规则(供 .githooks/pre-commit 与 CI 调用)
/**
 * 标题行让位门禁 —— 规范见 docs/standards/launch-and-build.md §5 与
 * docs/standards/12-代码组织与文件结构.md(反模式表)。
 *
 * 背景(ISSUE #310 回归只改了一半)：应用级页签搬到窗口标题行后，「全屏视图」
 * 的 `fixed inset-0` 会把标题行整条盖住 —— 页签看不见、右上角的窗口按钮
 * (关闭/最大化)也点不到。首轮修复只逐个文件改了全屏视图，**居中弹窗 / 遮罩
 * 这类浮层漏改**，于是「应用日志」打开后依旧挡住页签与关闭按钮。
 *
 * 根因不是「漏了一个文件」，而是**判据只写在人脑里**：`fixed inset-0` 是
 * 全项目通用的弹窗写法，新增一处就多一次回归。本条把它变成机器判据：
 * `src/components/**`、`src/app/**` 里的顶层浮层（`fixed inset-0`）必须
 * 改为「顶部让出标题行」的写法，即 class 串里带 `top-title-bar`。
 *
 * 判定口径(与 src/lib/full-screen-layer.ts 的 blocksTitleBar 同源)：
 *   命中 = class 串以「fixed inset-0」开头(即铺满整个视口)；
 *   否则若该元素是 fixed 且另一个 class 含 inset-0，则要求同一 class 串内
 *        出现 `top-title-bar`；
 *   豁免 = 非 fixed 的 `inset-0`(只铺自己的定位祖先，够不到标题行)、
 *        给全屏视图/模态弹窗用 overlayClass()/fullScreenLayerClass() 拼串、
 *         以及同文件内出现 `top-title-bar`(常量拼接，本脚本看不到运行时值)。
 *
 * 第二条规则(标题行的层级，ISSUE #310 第三次回归)：**几何让位只管「不被盖住」，
 * 不管「可点」**。让位是把标题行让出来，但标题行自己是流内元素(`z-index: auto`)，
 * 任何后出现在 DOM 里的定位元素都会在命中测试里压过它 —— base-ui 的 Dialog 在
 * modal 打开时注入 `InternalBackdrop`(`div[data-base-ui-inert]`，
 * `position: fixed; inset: 0; z-index: auto; pointer-events: auto`)，铺满整个
 * 视口(含标题行)，用户实测「设置页启动日志全屏后，页签与右上角窗口按钮整排点不动」。
 * 第三方浮层不受本仓库让位规则约束，所以标题行的**可点性必须由层级保证**：
 * 凡渲染标题行的文件(用到高度量 `h-title-bar`/`TITLE_BAR_HEIGHT_CLASS` 的地方)，
 * 必须同时带上 `TITLE_BAR_CHROME_CLASS`(`relative z-chrome`，刻度表最高档)。
 *
 *
 * 第四条规则(整屏页面铺满视口，ISSUE #1794)：第三条只管浮层，**路由页**不在它
 * 射程里 —— 错误页 / 404 / 加载态写的是 `min-h-screen`（在壳里等于 `100svh`，
 * 从视口顶起算），同样把标题行整条盖住：用户看到「页面出错了」的同时，
 * 右上角的**关闭**按钮也点不到了。判据与浮层同源(让出标题行)，只是形态写成
 * 语义标记：整屏必须在 `top-title-bar` 之外，落成内容区高度那一档
 * (`min-h-0`，见 `~/lib/full-screen-layer` 的 `FULL_PAGE_CLEARANCE_CLASS`)。
 *
 * 用法:node scripts/check-title-bar-clearance.cjs
 *   --staged(钩子用)仅当暂存改动落在扫描面(src/components + src/app)内才扫,口径见 §13.5.8.2
 */
const fs = require("node:fs");
const path = require("node:path");
const { skipUnlessStagedTouches } = require("./gate-scan-read.cjs");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["src/components", "src/app"];
/**
 * 豁免清单 —— 只有「压根不是内容浮层」的东西才配进来，注释里必须写清理由
 * （本文件允许出现被禁字面量，因为它就是判定口径本身）。
 *   文件路径 → 豁免理由
 */
const EXEMPT = new Map([
  // 判据模块与门禁自身的注释里必然出现被禁字面量
  ["src/lib/full-screen-layer.ts", "让位判据模块，注释即口径说明"],
  // 注释里说明「旧写法是什么」的全屏视图组件本身用常量拼串，静态扫不到
  [
    "src/components/studio/fullscreen/FullScreenLayer.tsx",
    "注释引用旧写法；实现走 fullScreenLayerClass",
  ],
  // 应用级背景层：标题行自身半透明，背景若从标题行下方才开始，顶部会露出亮带
  [
    "src/components/ui/aurora-background.tsx",
    "应用级装饰背景，非内容浮层，需覆盖标题行避免顶部亮带",
  ],
]);
/** 顶层浮层的最小判定：铺满整个视口。 */
const FIXED_INSET = /\bfixed\b[^"'`]*\binset-0\b/;
/** 让位标记：出现在 class 串里即视为已让出标题行。 */
const CLEARANCE = /\btop-title-bar\b/;
/** 整屏页面的视口高度写法(第四条规则)：壳里等于 `100svh`，从视口顶起算。 */
const SCREEN_HEIGHT = /\b(?:min-h-screen|h-screen|h-svh|min-h-svh)\b/;
/** 整屏页面的让位写法：高度收到内容区那一档(`min-h-0` + 父级高度)。 */
const CONTENT_HEIGHT = /\bmin-h-0\b/;
/** 只扫路由挂载点：整屏页面都在 `src/app`，`src/components` 里的同名字面量另有归属。 */
const PAGE_DIR = "src/app";
/** 注释行(含块注释续行 ` * `)不算用法：文件里讲「从前写的是什么」是正常的。 */
const COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/;
/** 标题行的渲染点：class 串里取高度量（`h-title-bar` 或它的常量）。 */
const TITLE_BAR_RENDER = /\bTITLE_BAR_HEIGHT_CLASS\b|\bh-title-bar\b/;
/** 标题行的层级标记：常量名或它拼出来的类名都算（见文件头第二条规则）。 */
const CHROME_Z = /\bTITLE_BAR_CHROME_CLASS\b|\bz-chrome\b/;
/** 导入行不算渲染点（`import { TITLE_BAR_HEIGHT_CLASS }` 里也有这个标识符）。 */
const IMPORT_LINE = /^\s*import\b/;
/** 锚定浮层的定位层（base-ui 的 Positioner）—— 第三种让位形态的判定入口。
 * 锚 `.<` 与行尾（标签可能紧跟属性或直接换行）：`Positioner.Props` 这类**类型
 * 引用**不能被算进来（`Pick<…Positioner.Props, …>` 会误报）。 */
const POSITIONER_OPEN = /<[A-Za-z]+Primitive\.Positioner(\s|>|$)/;
/** 锚定浮层交出可用区域的那一行（`useOverlayBoundary` 的唯一消费形状）。 */
const COLLISION_BOUNDARY = /collisionBoundary=\{boundary \?\? undefined\}/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.[jt]sx?$/.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name))
      out.push(p);
  }
  return out;
}

const rel = (p) => p.split(path.sep).join("/");

/* --staged：扫描面就是 SCAN_DIRS，未触及即跳过（见 §13.5.8.2）。 */
if (process.argv.includes("--staged")) {
  skipUnlessStagedTouches({ roots: SCAN_DIRS, tag: "[title-bar]" });
}

const problems = [];
const notes = [];

for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const r = rel(path.relative(ROOT, file));
    if (EXEMPT.has(r)) continue;
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split("\n");
    let hits = 0;
    lines.forEach((line, i) => {
      if (!FIXED_INSET.test(line)) return;
      if (CLEARANCE.test(line)) return;
      hits += 1;
      problems.push(
        `${r}:${i + 1} 顶层浮层铺满视口(fixed + inset-0)未让出标题行\n` +
          `    → ${line.trim()}\n` +
          `    改用 overlayClass("modal", …) 或 fullScreenLayerClass(…)（顶部为 top-title-bar）`,
      );
    });
    if (hits && CLEARANCE.test(text)) {
      notes.push(r);
    }

    /* 第三条规则（ISSUE #1377）：锚定浮层（气泡 / 下拉 / 气泡卡）必须把
     * 「可用区域」交给定位引擎 —— 前两条只覆盖 `fixed inset-0` 那两类，锚定
     * 浮层写不出固定的 `top-*`，它的让位只能表达成 `collisionBoundary`。
     * 漏了的表现是：气泡觉得视口里放得下（Base UI 的 flip 只对**视口**判溢出），
     * 于是照旧往上摆，而标题行 z-chrome(2000) 比它 z-popup(100) 高一个数量级
     * —— 上半截被标题行盖掉，用户只看到一条白边加一个箭头。 */
    const positioners = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => POSITIONER_OPEN.test(line));
    for (const { line, i } of positioners) {
      /* Positioner 的属性可能跨行，判据要覆盖到闭合标签为止（最多 20 行）。 */
      const block = lines.slice(i, i + 20).join("\n");
      if (COLLISION_BOUNDARY.test(block)) continue;
      problems.push(
        `${r}:${i + 1} 锚定浮层（base-ui Positioner）没有交出可用区域\n` +
          `    → ${line.trim()}\n` +
          `    补 collisionBoundary={boundary ?? undefined}，boundary 取自 useOverlayBoundary()` +
          `（~/components/ui/use-overlay-boundary）；` +
          `漏了会让浮层摆进应用级标题行、被它整块盖掉`,
      );
    }

    /* 第四条规则（ISSUE #1794）：整屏页面必须让出标题行。
     * 第三条只覆盖浮层，路由页（错误页 / 404 / 加载态 / 登录页）写的是视口高度，
     * 而壳里那条 36px 的标题行就在视口顶部 —— 整屏铺开即盖住它，右上角的关闭
     * 按钮随之点不动。判据：`src/app/**` 里用了视口高度字面量的元素，必须与
     * 「内容区高度」同源（出现 `min-h-0`）—— 落点就是那条共享的
     * `FULL_PAGE_CLEARANCE_CLASS`。 */
    if (r.startsWith(`${PAGE_DIR}/`)) {
      lines.forEach((line, i) => {
        if (COMMENT_LINE.test(line)) return;
        if (!SCREEN_HEIGHT.test(line)) return;
        if (CONTENT_HEIGHT.test(line)) return;
        problems.push(
          `${r}:${i + 1} 整屏页面按视口高度铺开，会盖住右上角的窗口按钮（关闭/最大化）\n` +
            `    → ${line.trim()}\n` +
            `    改用 FULL_PAGE_CLEARANCE_CLASS（~/lib/full-screen-layer，让出标题行、高度收到内容区）；` +
            `壳里 min-h-screen = 100svh，从视口顶起算，正好连标题行一起盖住`,
        );
      });
    }

    // 第二条规则：渲染标题行的文件必须给 chrome 档层级（整文件判据，容忍
    // class 串换行书写；误报会让成员直接删掉门禁，见 tests 的注释）。
    const renderLines = lines
      .map((line, i) => ({ line, i }))
      .filter(
        ({ line }) => !IMPORT_LINE.test(line) && TITLE_BAR_RENDER.test(line),
      );
    if (renderLines.length && !CHROME_Z.test(text)) {
      const at = renderLines[0];
      problems.push(
        `${r}:${at.i + 1} 渲染标题行但没给 chrome 档层级（标题行会被整视口遮罩压住命中测试）\n` +
          `    → ${at.line.trim()}\n` +
          `    改用 TITLE_BAR_CHROME_CLASS（~/lib/full-screen-layer，= relative z-chrome）；` +
          `几何让位（top-title-bar）只保证不被盖住，不保证可点`,
      );
    }
  }
}

if (notes.length) {
  console.log(
    "[title-bar] 同文件已出现 top-title-bar（常量拼接的让位不在此静态扫描内，需人工确认）：\n  " +
      notes.join("\n  "),
  );
}

if (problems.length) {
  console.error("[title-bar] 违规(阻断提交):\n  " + problems.join("\n  "));
  console.error(
    "背景与修法见 docs/standards/launch-and-build.md §5「页签/窗口按钮被浮层盖住」条",
  );
  process.exit(1);
}
console.log("[title-bar] OK");
