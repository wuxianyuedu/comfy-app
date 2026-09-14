// @ts-nocheck -- 提交门槛脚本:文件命名/组织硬规则(供 .githooks/pre-commit 调用)
/**
 * 文件组织硬规则(规范见 docs/standards/12-代码组织与文件结构.md):
 *   R1  src 下 .tsx 文件名必须 PascalCase(测试伙伴文件 X.test.tsx 同样以大写开头;
 *       豁免:src/app 下 Next 保留名、CONVENTION_EXEMPT 列出的库惯例文件、
 *       目录索引 index.tsx;src/components/ui/ 采用 shadcn 官方 kebab-case 约定
 *       (硬强制 kebab,禁止 PascalCase——§12.6/§12.8)
 *   R2  src 下 .ts 文件名禁止 PascalCase(非组件模块一律 kebab-case)
 *       (src/ 根下的 Next 约定文件 proxy.ts 由 R2_EXEMPT 豁免——它是框架
 *        保留名,不能改名;配套 R11 保证它没被放错位置或悄悄消失)
 *   R3  禁止时间戳备份文件(\d{8}_\d{6} 模式)——版本回退用 git,不进 src
 *   R4  src/lib 下禁止 .tsx(12.5:lib 无 React)
 *   R5  (提示)src/components 与 src/app 下超 900 行的文件列入拆分候选,仅提醒
 *       不阻塞(ISSUE #535:只扫 components 会让 src/app 下的巨型视图——如
 *       2498 行的 SettingsPageView.tsx——完全落在护栏之外)
 *   R7  Windows 双击入口一律 .ps1:仓库内禁止新增 .bat/.cmd/.vbs
 *       (ISSUE #23 / 规范 launch-and-build.md §8:.bat 走 cmd 的 GBK 代码页,
 *        中文必乱码,历史上被迫做成"不含中文不含逻辑"的哑壳)
 *   R8  scripts/ tools/ 下含中文的 .ps1 必须以 UTF-8 BOM 保存(否则 PowerShell
 *       5.1 按 GBK 解码,与 .bat 乱码同源)
 *   R9  根目录只放工程配置,禁止再散落 .ps1 双击入口(ISSUE #29):入口一律归入
 *       tools/<分类>/;根入口的 discoverability 由 README 的入口清单承担,
 *       不靠"铺在根目录第一眼看见"
 *   R10 注释里禁止「历史流水」:日期(2026-08-17)、改动编号(R-ardot114 / R83 /
 *       R-Next)、任务批次号(T12-3)。这些归 git log,写进注释会随代码搬迁过期
 *       失真(ISSUE #46 / 规范 12.4.2 / 反模式表 G4)
 *   R12 src/ 源码禁止内嵌控制字符(NUL 及其它 C0/C1 控制符,制表/换行除外)。
 *       源码里带一个真的 NUL 字节 = git / diff / grep / 多数编辑器一律当
 *       **二进制文件**处理:`git diff` 只回「Binary files differ」(评审看不到
 *       改动)、`git show --stat` 显示为 bin、`grep -rn` 静默跳过整个文件。
 *       曾经用来做「占位符」的 NUL 哨兵(规范 12.11)是它的来源,现已改为
 *       可打印形式;本条防回潮。
 * 违反 R1-R4、R7-R12 以退出码 1 阻断提交。
 */
const fs = require("node:fs");
const path = require("node:path");

const problems = [];
const splitHints = [];

// R7 禁用的 Windows 入口后缀(ISSUE #23 / launch-and-build.md §8)
const FORBIDDEN_SCRIPT_EXT = /\.(bat|cmd|vbs)$/i;
// R8 需 UTF-8 BOM 的目录:入口与逻辑脚本都在这里,含中文的是绝大多数
const BOM_REQUIRED_DIRS = ["scripts/", "tools/"];
// R8 只校验含非 ASCII 字符的 .ps1——纯 ASCII 脚本没有解码歧义,不强求 BOM
const NON_ASCII = /[^\x00-\x7F]/;
// R10 注释里的「历史流水」标记(ISSUE #46 / 规范 12.4.2)
const HISTORY_DATE = /\d{4}-\d{2}-\d{2}/;
const HISTORY_TAG =
  /\bR(?:[-_][A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*|\d{1,4}(?:[-_][A-Za-z]?[A-Za-z0-9]*)?)(?:\s*\/\s*(?:\d{1,4}|[A-Za-z][A-Za-z0-9]*))*/;
const HISTORY_TASK = /\bT\d{1,3}(?:-\d{1,3})?\b/;

/* R2 豁免:src/ 根下的 Next 约定文件。proxy.ts(Next 16 起取代 middleware.ts)
 * 是**框架保留名**——名字由 Next 决定,改成 kebab-case 就不再被加载,只能豁免;
 * 但豁免必须配 R11(位置 + 载荷判据),否则「豁免」会变成「改名/挪走后静默失效」
 * 的缺口(文件不在 src/ 根,警告与代理一起消失,构建期不报任何错)。 */
const R2_EXEMPT = new Set(["src/proxy.ts"]);

// Next.js App Router 保留文件名(框架强制小写,不可改名)——src/app 下豁免
const NEXT_RESERVED = new Set([
  "page", "layout", "error", "global-error", "loading", "not-found",
  "template", "default", "route", "manifest", "robots", "sitemap", "icon",
]);
// 库官方惯例文件(目录约定)
const CONVENTION_EXEMPT = new Set(["src/trpc/react.tsx"]);

(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).split(path.sep).join("/");
    if (e.isDirectory()) { walk(p); continue; }
    if (!/\.(tsx?|mjs|cjs|js)$/.test(e.name)) continue;
    const rel = p;
    // shadcn/ui 官方约定:组件文件 kebab-case(button.tsx/dialog.tsx),
    // 与本项目 R1(PascalCase)相反——本脚本对 src/components/ui/ 硬强制 kebab
    // (禁止大写开头,§12.6),不再豁免。
    const isUiDir = rel.startsWith("src/components/ui/");
    const base = e.name.replace(/\.(tsx?|mjs|cjs|js)$/, "").replace(/\.test$/, "");
    if (/\d{8}_\d{6}/.test(e.name)) problems.push("R3 时间戳备份文件:" + rel);
    /* R11 的位置判据:Next 约定文件只允许出现在 src/ 根。放进 app/ 或更深
     * 的目录 Next 不会加载 —— 文件在、代理不在,构建期毫无提示。 */
    if (base === "proxy" || base === "middleware") {
      const canonical = "src/" + base + ".ts";
      if (rel !== canonical)
        problems.push("R11 Next 约定文件位置错:" + rel + "(须在 " + canonical + ")");
    }
    if (/^\/\* eslint-disable @typescript-eslint\/no-explicit-any/.test(
      fs.readFileSync(p, "utf8").split("\n")[0] || "",
    ))
      problems.push("R6 文件级 no-explicit-any 禁用头(战役已清零,禁止回流):" + rel);
    if (/\.(tsx|mjs|cjs|js)$/.test(e.name) && rel.startsWith("src/")) {
      if (e.name.endsWith(".tsx")) {
        /* §12.6:目录索引 index.tsx 是 barrel,不承载组件实现,不受 R1 约束。
         *  src/components/ui/ 采用 shadcn 官方 kebab-case 约定(§12.6),
         *  故 ui/ 下组件文件须 kebab-case(禁止 PascalCase)。 */
        const isDirectoryIndex = base === "index";
        const reserved = (rel.startsWith("src/app/") && NEXT_RESERVED.has(base))
          || CONVENTION_EXEMPT.has(rel)
          || isDirectoryIndex;
        if (isUiDir) {
          // shadcn 约定:kebab-case,禁止大写开头
          if (/^[A-Z]/.test(base)) problems.push("R1(ui) 组件文件须 kebab-case:" + rel);
        } else if (!reserved && !/^[A-Z]/.test(base)) {
          problems.push("R1 组件文件须 PascalCase:" + rel);
        }
        if (rel.startsWith("src/lib/")) problems.push("R4 lib 下禁止 .tsx:" + rel);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
        // ui/ 下 .ts 模块同样须 kebab-case(shadcn 约定)
        if (/^[A-Z]/.test(base) && !R2_EXEMPT.has(rel))
          problems.push("R2 模块文件须 kebab-case:" + rel);
      }
      const lines = fs.readFileSync(p, "utf8").split("\n").length;
      /* R5 扫描范围含 src/app:页面的「纯展示视图」也落在那里
       * (settings/SettingsPageView.tsx),只扫 components 会让最大的那个视图
       * 反而无护栏。App Router 的保留文件(page/layout/route)同样计入——
       * 行数与「框架保留名」无关,超了就该拆。 */
      if ((rel.startsWith("src/components/") || rel.startsWith("src/app/")) && lines > 900)
        splitHints.push(rel + " (" + lines + " 行,建议拆分)");
    }
  }
})("src");

// ── R7/R8:仓库内 Windows 脚本入口扫描 ──
// 只排除「不可能放仓库入口」的目录:依赖、构建产物、被 gitignore 的打包输出、
// 以及 target(可能包含第三方 Rust 产物)。用相对路径前缀判断,避免按目录名
// 误伤 tools/registry 这类同名但受规范的目录。
const SCAN_EXCLUDED = [
  'node_modules/', '.git/', '.next/', 'coverage/', 'generated/', 'temp/',
  'python-venv/', 'log/', 'build-launcher/', 'dist/', 'docs/',
  'playwright-report/', '.workbuddy/',
  'src-tauri/target/', 'src-tauri/static/', 'start-tauri/', 'start-tauri-dev/',
  'start-tauri-standalone/', 'build-launcher-dev/', 'build-launcher-standalone/',
];
(function walkScripts(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name).split(path.sep).join('/');
    const rel = p.startsWith('./') ? p.slice(2) : p;
    if (e.isDirectory()) {
      if (SCAN_EXCLUDED.some((d) => rel === d.slice(0, -1) || rel.startsWith(d))) continue;
      walkScripts(p);
      continue;
    }
    if (FORBIDDEN_SCRIPT_EXT.test(e.name)) {
      problems.push('R7 Windows 入口须 .ps1(禁用 .bat/.cmd/.vbs):' + rel);
      continue;
    }
    if (!e.name.toLowerCase().endsWith('.ps1')) continue;
    if (!BOM_REQUIRED_DIRS.some((d) => rel.startsWith(d))) continue;
    const buf = fs.readFileSync(p);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) continue;
    // 无 BOM:只有含非 ASCII 字符(中文提示)的脚本才会被 PS5.1 按 GBK 误解码
    if (NON_ASCII.test(buf.toString('utf8'))) {
      problems.push('R8 含中文的 .ps1 须以 UTF-8 BOM 保存(否则 PS5.1 按 GBK 解码):' + rel);
    }
  }
})('.');

// ── R9:根目录禁止散落 .ps1 双击入口(ISSUE #29) ──
// 背景:6 个根入口(start-web/run-local/verify-quality/start-tauri/
// start-desktop/register-comfyapp-protocol)曾平铺在仓库根,与 package.json /
// tsconfig.json 等工程配置混排,一眼看不出"哪些是入口、哪些是配置"。现统一归入
// tools/start/,与 tools/build/、tools/registry/、tools/studio/ 同构。
// 这里只拦 .ps1——其它后缀的根文件(配置/文档)不受约束,避免过度收紧。
(function checkRootEntries() {
  for (const e of fs.readdirSync('.', { withFileTypes: true })) {
    if (!e.isFile()) continue;
    if (!e.name.toLowerCase().endsWith('.ps1')) continue;
    problems.push(
      'R9 根目录禁止 .ps1 双击入口(请放进 tools/<分类>/,启动类放 tools/start/):' + e.name,
    );
  }
})();

// ── R10:注释里禁止「历史流水」(日期 / 改动编号 / 任务批次号) ──
// 规范 12.4.2:作者、日期、版本流水归 git log / commit message,写进注释会随
// 代码搬迁过期失真。本条只扫「整行都是注释」的行,不碰字符串字面量与代码。
(function checkHistoryComments() {
  const files = [];
  (function walkComments(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name).split(path.sep).join('/');
      if (e.isDirectory()) { walkComments(p); continue; }
      if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  })('src');
  for (const rel of files) {
    const lines = fs.readFileSync(rel, 'utf8').split('\n');
    lines.forEach((l, i) => {
      const t = l.trim();
      const isComment =
        t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('{/*');
      if (!isComment) return;
      // 一行里可能同时有日期与编号,逐个报出来,便于一次改干净
      const found = new Set();
      for (const re of [HISTORY_DATE, HISTORY_TAG, HISTORY_TASK]) {
        for (const m of l.matchAll(new RegExp(re.source, 'g'))) {
          if (m[0] !== '') found.add(m[0]);
        }
      }
      for (const hit of found) {
        problems.push(
          'R10 注释禁止历史流水(日期 / 编号 / 批次号归 git):' +
            rel + ':' + (i + 1) + ' → ' + hit,
        );
      }
    });
  }
})();

// ── R11:Next 16 起 middleware 必须叫 proxy,且不得静默丢失(ISSUE #489) ──
// 两条判据合起来才拦得住:
//   ① 存在性——约定文件被删 = 代理凭空消失,构建期不报错,要等到真拦请求时
//      才发现「根本没跑」;本仓库唯一用途是挂 config.matcher 给后来人留落点,
//      删掉它等于把落点一起删了;
//   ② 片段存在性——文件在、但改名回 middleware = 重新吃 Next 16 的 deprecation
//      警告(改名是「消警告」而不是「消掉需求」的典型误修)。
(function checkProxyConvention() {
  const proxyPath = "src/proxy.ts";
  const legacyPath = "src/middleware.ts";
  if (!fs.existsSync(proxyPath)) {
    problems.push("R11 缺少 Next 16 代理约定文件:" + proxyPath + "(middleware 已废弃,勿删除本文件)");
  }
  if (fs.existsSync(legacyPath)) {
    problems.push("R11 middleware 约定名已废弃(Next 16):" + legacyPath + " → 改名为 src/proxy.ts");
  }
})();

// ── R12:src/ 源码禁止内嵌控制字符(规范 12.11) ──
// 判据是「这个字节在源码里是不是一个字符」,而不是「文件里有没有某个字符串」:
// 带 NUL 的文件被 git / diff / grep / 多数编辑器一律当二进制处理,评审与检索
// 从此对它失效——这正是历史上 markdown.ts 用 NUL 做占位符哨兵留下的坑。
// 详情与替代写法见 docs/standards/12-代码组织与文件结构.md §12.11。
(function checkControlCharacters() {
  /** 允许的控制字符:制表符、换行、回车(源码里的正常排版)。 */
  const ALLOWED = new Set([0x09, 0x0a, 0x0d]);
  /** C0(0x00-0x1f,除上列)、DEL(0x7f)、C1(0x80-0x9f / U+0080-U+009F)。 */
  function isForbidden(code) {
    if (code <= 0x1f) return !ALLOWED.has(code);
    if (code === 0x7f) return true;
    return code >= 0x80 && code <= 0x9f;
  }
  function describe(code) {
    const hex = "U+00" + code.toString(16).toUpperCase().padStart(2, "0");
    return code === 0 ? hex + " (NUL)" : hex;
  }
  const files = [];
  (function walkControl(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name).split(path.sep).join("/");
      if (e.isDirectory()) { walkControl(p); continue; }
      if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  })("src");
  for (const rel of files) {
    const text = fs.readFileSync(rel, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      const hits = new Set();
      for (const char of line) {
        const code = char.codePointAt(0);
        if (isForbidden(code)) hits.add(describe(code));
      }
      for (const hit of hits) {
        problems.push(
          "R12 源码禁止内嵌控制字符(" + rel + ":" + (i + 1) + " → " + hit +
          ")。改可打印哨兵,见规范 §12.11;若确需 NUL 请显式写成转义 `\\u0000`",
        );
      }
    });
  }
})();

if (splitHints.length) {
  console.log("[structure] 拆分候选(仅提醒):\n  " + splitHints.join("\n  "));
}
if (problems.length) {
  console.error("[structure] 违规(阻断提交):\n  " + problems.join("\n  "));
  console.error("规范见 docs/standards/12-代码组织与文件结构.md §12.6/§12.8/§12.11");
  console.error("      以及 docs/standards/launch-and-build.md §8(Windows 入口 .ps1 化)");
  process.exit(1);
}
console.log("[structure] OK");
