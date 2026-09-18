#!/usr/bin/env node
// @ts-nocheck
/**
 * doc-facts.cjs — 文档引用事实提取共享模块（供 doc:check / doc:render 复用）
 *
 * 单一事实原则：真实值只存在于源码/配置，本模块运行时从权威源动态提取。
 * scripts/check-doc-references.cjs（doc:check）与 scripts/render-doc-placeholders.cjs
 * （doc:render）都从这里取同一份 FACTS —— 避免出现"第二事实"。
 * 人类可读映射见 docs/reference-facts.md，本文件 FACTS 与其 key 一一对应。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
// 纳入「单一事实引用校验」的文档集合（编辑态用占位符/核对，生成态 doc:render 出原文）。
// 范围：standards 规范正文（01~17 章）+ guides 规范指南 + 启动链路/含值类文档，全量纳入。

const SCOPED_DOCS = [
  // 试点：启动链路类（首批纳入）
  "docs/standards/launch-and-build.md",
  "docs/startup-hotreload.md",
  "docs/guide-non-developer.md",
  "docs/guide-stale-code.md",
  // 扩展：含值类引用的文档
  "docs/standards/Comfy-APP-T3-项目开发规范.md",
  "docs/standards/16-shadcn-ui与表单校验.md",
  "docs/workshop-mcp.md",
  // 全量：standards 规范正文（01~18 章，除已纳入的 16）
  "docs/standards/01-架构与状态管理.md",
  "docs/standards/02-性能规范.md",
  "docs/standards/03-样式与-tailwind.md",
  "docs/standards/04-组件设计.md",
  "docs/standards/05-类型安全.md",
  "docs/standards/06-无障碍访问-a11y.md",
  "docs/standards/07-日志系统.md",
  "docs/standards/08-异步与副作用.md",
  "docs/standards/09-路由与导航.md",
  "docs/standards/10-错误处理与降级.md",
  "docs/standards/11-测试与可观测性.md",
  "docs/standards/12-代码组织与文件结构.md",
  "docs/standards/13-提交与-code-review.md",
  "docs/standards/14-反模式速查表.md",
  "docs/standards/15-附录.md",
  "docs/standards/17-UI与逻辑分离.md",
  "docs/standards/18-lib层规范.md",
  // 全量：guides 规范指南（不含 reviews 评审归档、api 自动生成、superpowers 设计归档、audits 过程文件）
  // 功能流程图：与规范同样纳入，保证图里引用的路径 / 值不会随源码静默过期。
  "docs/guides/feature-workshop-flow.md",
  "docs/guides/feature-workflow-library-flow.md",
  "docs/guides/DEV-QUERIES.md",
  "docs/guides/PRODUCTION-GAPS.md",
  "docs/guides/TESTING.md",
  "docs/guides/sync-after-pull.md",
];
function readJson(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); }
function readText(p) { return fs.readFileSync(path.join(ROOT, p), "utf8"); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }
function splitHostPort(url) {
  const m = url.match(/\/\/([^:/]+):(\d+)/);
  if (!m) throw new Error(`无法从 URL 提取 host:port: ${url}`);
  return { host: m[1], port: Number(m[2]) };
}

// ---- 权威值提取（运行时从源码/配置动态读取） ----
function extractDevHostPort() {
  const conf = readJson("src-tauri/tauri.conf.json");
  const { host, port } = splitHostPort(conf.build.devUrl);
  // 端口演进：dev-launcher.ps1 现已从 .env 的 COMFYAPP_PORT 读取（默认 3100），
  // 仓库内唯一权威源是 tauri.conf.json 的 build.devUrl。交叉核对提交的
  // .env.example 里 COMFYAPP_PORT 是否与 devUrl 一致（.env 为本地可覆盖变体）。
  // .env.example 的 COMFYAPP_PORT 在示例里是**注释行**（「需要固定端口时取消注释」），
  // 读取前必须先剔除注释行——否则「取消注释把示例改成某个具体端口」这种再正常不过的
  // 改动会被当成权威源冲突，把 doc:check 变成误报机器（ISSUE #489）。
  if (exists(".env.example")) {
    const m = readText(".env.example")
      .split(/\r?\n/)
      .filter((l) => !/^\s*#/.test(l))
      .join("\n")
      .match(/COMFYAPP_PORT\s*=\s*["']?([0-9]+)["']?/);
    if (m && Number(m[1]) !== port) {
      throw new Error(`端口权威源冲突：tauri.conf.json devUrl=${port} 但 .env.example COMFYAPP_PORT=${m[1]}`);
    }
  }
  return { host, port };
}
function extractFallbackPorts() {
  // fallback 端口由 dev-launcher.ps1 运行时基于 appPort 推导（\$scanPorts = appPort/+1/+2），
  // 源码无字面量可读；据其逻辑按主端口推导返回。见 scripts/dev-launcher.ps1 的 scanPorts。
  const { port: mainPort } = extractDevHostPort();
  return [mainPort + 1, mainPort + 2].map(String);
}
/**
 * 「按检出路径推导的端口族」（3200~3999）——作者本机 `pnpm dev` 实际会拿到的端口。
 *
 * 与 `extractDevHostPort()` 的区别（这正是 ISSUE #489 的根因）：
 *   - `tauri.conf.json` 的 `devUrl` **不参与主导航**，它是 Windows 启动器链路与
 *     编译期兜底值；`pnpm dev` 走的是 `scripts/app-port.mjs` 的解析（.env → 路径
 *     推导 → 兜底 3100），在 `.env` 未固定端口时**永远落不到那条静态值上**。
 *   - 于是「用静态 devUrl 值去核对 pnpm dev 语境下的文档」= 拿一个与事实无关的
 *     oracle 做校验：实测本工作区路径推导结果是 3311，而 README / 新手指南写的
 *     `localhost:3100` 在 doc:check 眼里永远是「一致」的（静态值也是 3100），
 *     照文档打开 3100 就是 ERR_CONNECTION_REFUSED。
 *
 * 因此端口事实按**链路**拆成两条，各自用自己的 oracle：
 *   静态链（启动器 / 壳 / 兜底）：`dev.port`        ← tauri.conf.json devUrl
 *   解析链（pnpm dev / start / Playwright）：`dev.port.derived` ← scripts/app-port.mjs
 *
 * 提取方式直接复用 `scripts/app-port.mjs`（唯一事实源）在本工作区路径上的解析结果，
 * 而不是再实现一遍算法——算法本体已有四语言实现，第五份必然是漂移源。
 */
function extractDerivedAppPort() {
  const { createRequire } = require("node:module");
  const req = createRequire(__filename);
  const port = req(path.join(ROOT, "scripts", "app-port.mjs")).resolveAppPort(ROOT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`无法从 scripts/app-port.mjs 解析本检出端口：${port}`);
  }
  return String(port);
}

function extractLauncherExe() {
  const spec = readText("tools/start-tauri.spec");
  const m = spec.match(/os\.environ\.get\(\s*['"]LAUNCHER_NAME['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
  return `${(m ? m[1] : "start-tauri")}.exe`;
}
function extractLauncherExeByName(ps1) {
  const t = readText(ps1);
  const m = t.match(/\$env:LAUNCHER_NAME\s*=\s*["']([^"']+)["']/);
  if (!m) throw new Error(`无法从 ${ps1} 提取 LAUNCHER_NAME`);
  return `${m[1]}.exe`;
}
function extractSplash() {
  const conf = readJson("src-tauri/tauri.conf.json");
  const win = conf.app.windows.find((w) => w.label === "splash") || conf.app.windows[0];
  return win.url;
}

// ---- 扩展：项目自身"值类"端口（独立单值，非 dev 端口族） ----
function extractRegistryPort() {
  // shadcn 团队 Registry 服务端口，权威源 tools/scripts/start-registry.ps1 的 $Port = <n>。
  const t = readText("tools/scripts/start-registry.ps1");
  const m = t.match(/\$Port\s*=\s*(\d+)/);
  if (!m) throw new Error("无法从 tools/scripts/start-registry.ps1 提取 Port");
  return m[1];
}
function extractMcpHttpPort() {
  // Workshop MCP HTTP 服务端口，权威源 tools/mcp-http.ts 的 MCP_HTTP_PORT ?? 4300。
  const t = readText("tools/mcp-http.ts");
  const m = t.match(/MCP_HTTP_PORT\s*\?\?\s*(\d+)/);
  if (!m) throw new Error("无法从 tools/mcp-http.ts 提取 MCP_HTTP_PORT 默认值");
  return m[1];
}
function extractComfyUIPort() {
  /* ComfyUI 默认监听端口的权威源是 `src/lib/endpoints.ts` 的常量
   * `COMFYUI_DEFAULT_PORT`（ISSUE #536 P3 之前它散落在 5 个文件里，client.ts
   * 只是其中一处；#534 P1 又把定义从 app-settings.ts 搬到了零依赖的常量层，
   * 因为设置页视图也要读它，而 app-settings.ts 顶层 import fs 会让浏览器图
   * 整页 500）。app-settings.ts 只再导出同名，因此这里必须读**定义处**。 */
  const t = readText("src/lib/endpoints.ts");
  const m = t.match(/export\s+const\s+COMFYUI_DEFAULT_PORT\s*=\s*(\d+)/);
  if (!m) throw new Error("无法从 src/lib/endpoints.ts 的 COMFYUI_DEFAULT_PORT 提取 ComfyUI 默认端口");

  return m[1];
}

// --------------------------------------------------------------------------

/* ── 注释语言的「纯 ASCII 模块」白名单（ISSUE #678 / 规范 12 §12.4.6）────
 * 口径：注释一律中文；只有「会被 `next-code-frame` 渲染到」的构建期模块写英文，
 * 且必须保持纯 ASCII —— Next 的 code frame 按**字节**切串，高亮区间端点落在
 * 多字节字符内部时 Rust 侧直接 panic，整个 `next build` 被一个与业务无关的错误
 * 带走（规范 launch-and-build §5）。
 *
 * 这份名单必须**只定义一次**：文档（docs/reference-facts.md / 规范 12 §12.4.6 /
 * launch-and-build §9.6）写的与脚本读的如果各存一份，两边必然各自漂移 ——
 * 表现是「文档说允许、判据说违规」而没人知道该信哪个。因此这里刻意**反向读文档**：
 * 白名单在 reference-facts 的那一行里以 `path（判定符号）` 列表登记，本函数解析它。
 * 与 §1.x 的值类事实相反，这里没有「第二个事实源」——路径清单本身就是权威定义，
 * 解析出来的结果直接喂给判据。
 */
const ASCII_ONLY_FACT_DOCS = ["docs/reference-facts.md"];

/** 解析 reference-facts 里 `comment.language.asciiOnly` 那一行登记的模块路径。 */
function extractAsciiOnlyModules() {
  for (const doc of ASCII_ONLY_FACT_DOCS) {
    if (!exists(doc)) continue;
    const text = readText(doc);
    // 取登记行：`| comment.language.asciiOnly | <路径清单> | ... |`
    const line = text.split("\n").find((l) => l.includes("comment.language.asciiOnly"));
    if (!line) continue;
    // 取「名单」那一格（第 2 列），逐项提取反引号包裹的模块路径。
    // 括号里的理由（「构建期被加载」这类）写在路径的**同一对反引号之外**，
    // 因此 `[^`]+?` 天然不会把它吃进来 —— 不需要按「（」二次切分。
    const cell = line.split("|")[2] ?? "";
    const paths = [...cell.matchAll(/`((?:src|scripts|e2e|tests)\/[^`]+?\.(?:ts|tsx|mjs|cjs))`/g)].map((m) => m[1]);
    // 名单可以为**空**（棘轮基线归零是这条规则的目标形态），但「读不到登记行」
    // 必须报错：一个永远返回空数组的解析器会让所有断言全绿（§12.16 的同款教训）。
    // 判据因此落在「登记行在不在」上，而不是「解析出几项」。
    if (line) return paths;
  }
  throw new Error("docs/reference-facts.md 里读不到 comment.language.asciiOnly 的登记行");
}

// FACTS：机器可读事实定义（与 docs/reference-facts.md 的 key 一一对应）
//   placeholder 类：文档用占位符替代裸值，doc:check 发现裸值即报错，
//                    doc:render 把占位符替换成真实值。
//   verify 类：文档保留直观值，doc:check 核对权威源当前端口族。
//   path 类：核对路径指向的文件存在。
// --------------------------------------------------------------------------
const FACTS = [
  // 占位符类：文档用占位符替代裸值
  { key: "shell.exe.prebuilt", placeholder: "{{shell.exe.prebuilt}}", kind: "placeholder", extract: extractLauncherExe },
  { key: "shell.exe.dev", placeholder: "{{shell.exe.dev}}", kind: "placeholder", extract: () => extractLauncherExeByName("tools/scripts/build-launcher-dev.ps1") },
  { key: "shell.exe.standalone", placeholder: "{{shell.exe.standalone}}", kind: "placeholder", extract: () => extractLauncherExeByName("tools/scripts/build-launcher-standalone.ps1") },
  { key: "shell.app.exe", placeholder: "{{shell.app.exe}}", kind: "placeholder", extract: () => "app.exe" },
  { key: "shell.splash", placeholder: "{{shell.splash}}", kind: "placeholder", extract: extractSplash },
  // 核对类：文档保留直观值，脚本核对权威源当前端口族
  { key: "dev.host", kind: "verify", extract: () => extractDevHostPort().host },
  // dev 端口族仅对描述 dev 启动链路的文档校验；workshop-mcp.md 的 4300 是 MCP HTTP
  // 端口（非 dev 回落），若参与 verify 会误判「缺 dev 主端口 3100」，故排除该文档。
  // 静态链端口（tauri.conf.json devUrl）：只对**描述启动器 / 壳 / 兜底**的文档适用。
  { key: "dev.port", kind: "verify", extract: () => String(extractDevHostPort().port), excludeDocs: ["docs/workshop-mcp.md"] },
  // 解析链端口（scripts/app-port.mjs）：对**描述 pnpm dev / start 的文档**适用。
  // 与静态链互斥：同一篇文档里不能同时把两条链路的端口都写成裸值，否则两条事实
  // 会互相打架（见上方 extractDerivedAppPort 的说明）。
  {
    key: "dev.port.derived",
    kind: "verify",
    extract: extractDerivedAppPort,
    // 新手指南只讲「浏览器模式 / Windows 启动器」两条起点，两条都经 dev.mjs 解析端口
    //（start-web.ps1 → dev-launcher.ps1 → pnpm dev），故适用解析链。
    onlyDocs: ["docs/guide-non-developer.md"],
  },
  { key: "dev.port.fallback", kind: "verify", extract: extractFallbackPorts, excludeDocs: ["docs/workshop-mcp.md"] },
  // 独立单值端口（非 dev 端口族）。workshop-mcp.md 的端口（MCP 4300 / ComfyUI 8188）
  // 属独立语义，用占位符替代裸值，doc:render 替换成真实值。
  { key: "registry.port", placeholder: "{{registry.port}}", kind: "placeholder", extract: extractRegistryPort },
  // MCP / ComfyUI 端口是「独立单值」；MCP 默认端口已取在 dev 回落族之外（4300），
  // 但为明确语义仍用占位符，并限定仅在 workshop-mcp.md 校验避免跨文档误判。
  { key: "mcp.http.port", placeholder: "{{mcp.http.port}}", kind: "placeholder", extract: extractMcpHttpPort, onlyDocs: ["docs/workshop-mcp.md"] },
  // otherDocs：该值在别的文档里的「引用点」不是无括号端口形态（如主规范的
  //          `localhost:3100` / `:8188` 并列行），须在另一套文档里也防裸值回潮。
  { key: "comfyui.port", placeholder: "{{comfyui.port}}", kind: "placeholder", extract: extractComfyUIPort, onlyDocs: ["docs/workshop-mcp.md"], otherDocs: ["docs/standards/Comfy-APP-T3-项目开发规范.md"] },
  // 注释语言白名单（ISSUE #678 / 规范 12 §12.4.6）：名单本身是权威定义，
  // 由 reference-facts 的一行承载，脚本解析它 —— 两侧只有一份清单。
  { key: "comment.language.asciiOnly", kind: "list", extract: extractAsciiOnlyModules },
  // 路径类：核对文件存在
  { key: "path.tauri.conf", kind: "path", source: "src-tauri/tauri.conf.json" },
  { key: "path.lib.rs", kind: "path", source: "src-tauri/src/lib.rs" },
  { key: "path.dev-launcher", kind: "path", source: "scripts/dev-launcher.ps1" },
  { key: "path.start-launcher-py", kind: "path", source: "scripts/start_tauri_launcher.py" },
  { key: "path.spec", kind: "path", source: "tools/start-tauri.spec" },
  { key: "path.build-launcher", kind: "path", source: "tools/scripts/build-launcher.ps1" },
  { key: "path.build-desktop", kind: "path", source: "scripts/build-desktop.mjs" },
  { key: "path.rebuild-static", kind: "path", source: "tools/build/rebuild-static.ps1" },
  { key: "path.build-tauri-release", kind: "path", source: "tools/build/build-tauri-release.ps1" },
  { key: "path.nvmrc", kind: "path", source: ".nvmrc" },
  // 平台侧 CI 配置（.cnb.yml）**已删除**（ISSUE #623：免费额度 160 核时/月，
  // 跑不起）。这里不再登记它的路径——path 类事实的语义是「文档里指向的文件必须
  // 存在」，登记一个刻意不存在的文件只会让 doc:check 恒红。
];

/* ── 校验范围守卫（ISSUE #316）─────────────────────────────────────────
 * `doc:check` 只校验 SCOPED_DOCS 里的文档。**未登记的文档会被静默跳过**——
 * 文档里写死过期值也没人报错，于是「全量纳管」只是人工承诺，不是机器事实。
 * 以下两张表把这件事变成可判定的：
 *   - 规范文档目录：新文件默认**必须在 SCOPED_DOCS 里**，否则报错；
 *   - 豁免名单：确实不该纳入校验的文档，必须**显式列在这里并写清理由**，
 *     不允许靠「没登记」沉默跳过。
 * 新增文档时的动作因此只有两种：登记进 SCOPED_DOCS，或写进豁免名单附理由。
 */

/** 规范文档目录：其中的 .md 默认全部纳入校验。 */
const SCOPED_DOC_DIRS = ["docs/standards", "docs/guides"];

/**
 * 豁免名单：不纳入 doc:check 的规范目录文档，key 为相对路径，value 为理由。
 * 每一条都必须是「纳入会造成误报或本就非规范正文」这类可核验的理由。
 */
const SCOPED_DOC_EXEMPTIONS = {
  // 文档集索引：只有导航与关系说明，不含值类裸值或可失效的路径引用。
  "docs/standards/README.md": "文档集索引（导航与章节映射），不含被校验的值类引用",
  // 评审归档：记录一次性的审查结论与处置，历史快照，不随源码演进。
  "docs/guides/reviews/2026-08-30-canvasnode-review.md": "代码审查归档，历史快照，不随源码演进",
};

/** 生成文档输出目录（相对 ROOT） */
const GENERATED_DOCS_DIR = "docs/generated";

module.exports = {
  ROOT,
  SCOPED_DOCS,
  SCOPED_DOC_DIRS,
  SCOPED_DOC_EXEMPTIONS,
  FACTS,
  GENERATED_DOCS_DIR,
  readJson,
  readText,
  exists,
  extractDevHostPort,
  extractFallbackPorts,
  extractLauncherExe,
  extractLauncherExeByName,
  extractSplash,
  extractRegistryPort,
  extractMcpHttpPort,
  extractAsciiOnlyModules,
};
