/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ── 生产级安全响应头（OWASP 2025 A05/A08）────────────────────
// 全站生效，同时覆盖 /api/*（tRPC、better-auth、文件流等）。
// 本地开发保留 'unsafe-inline'：Next.js dev 模式需要内联脚本；
// 严格 nonce 方案可在此基础上按需收紧（见 t3-fullstack 技能 security-hardening）。
//
// CSP 在这里**算一次**：它的输入只有 `NODE_ENV`（只两种取值：dev / prod），
// 而 `next dev` 与 `next build` 都会在加载本配置之前把该变量定好 —— 模块级求值
// 与原先「每次请求各求一次」的结果完全一致；省掉的是每个响应都重新拼一遍字符串
//（`isDev` 那一行当初也确实只取一次环境变量，结果只有两种）。
const IS_DEV = process.env.NODE_ENV !== "production";

/** dev 模式（Next 16 + Turbopack）依赖 eval() 做调试堆栈重构，需放行 'unsafe-eval'；
生产环境保持严格策略不变。 */
const SCRIPT_SRC = IS_DEV
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

/**
 * 依赖缓存槽的根目录（与 `scripts/ci-cache-slot.mjs` 的 `resolveCacheRoot` 同源）：
 * `<store 卷>/ci-cache/<包名小写>`。Turbopack 需要它作为附加根，是因为接槽后作业的
 * `node_modules` 是**指向该根之下某个指纹键目录的 junction**（出项目根），不登记
 * Turbopack 会硬拒 `next build`（见 changelog.d/2081-* 与 issue #2521）。
 *
 * 这里**内联**一份最小推导、不 import 槽脚本：next.config 在每次构建/开发都被加载，
 * 把会 spawn `pnpm` 的槽脚本拖进配置加载面不划算，且会让非 CI 场景也跑那段逻辑。
 * 仅当 `COMFY_CI_SLOT === "1"`（CI 接槽）时调用；任意失败都返回 `null`，由调用方
 * 配 `ignoreIfMissing` 兜底（路径存疑时只告警忽略，不阻断构建）。
 *
 * ⚠️ 与 `resolveCacheRoot` 漂移的责任同 §12.12：改这里必须同步改那里。
 *
 * @returns {string | null}
 */
function resolveCiSlotCacheRoot() {
  try {
    const res = spawnSync("pnpm", ["store", "path"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- spawnSync 出参：起不来 / 无输出时 stdout 实测为 null，@types/node 按非空标，保留空串兜底
    const store = String(res.stdout ?? "").trim();
    if (res.status !== 0 || !store) {
      return null;
    }
    const volumeRoot = path.parse(store).root;
    let name = "repo";
    try {
      name = String(
        JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).name ??
          "repo",
      ).toLowerCase();
    } catch {
      /* 读不到包名用中性目录名，与 resolveCacheRoot 同口径 */
    }
    return path.join(volumeRoot, "ci-cache", name);
  } catch {
    return null;
  }
}

const CSP = [
  "default-src 'self'",
  SCRIPT_SRC,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // ComfyUI 本地服务 / SSE 流 / WebSocket（ws://127.0.0.1:8188）
  //
  // `ipc:` / `http://ipc.localhost` 是 **Tauri 事件系统（listen / emit）的
  // IPC 通道**，不是业务网络请求：缺了它，`@tauri-apps/api/event` 的每一次
  // `listen` 都会被这条 CSP 挡掉（控制台报 "violates ... connect-src"），
  // 壳转发的日志进不了前端日志面板（LogProvider 的 log:emit）。
  // `invoke` 不受影响 —— 它走 postMessage 通道、不经 fetch，**只有事件监听
  // 受这条约束**，所以「命令能调通但监听静默失效」正是本条漏掉时的症状。
  // 与 tauri.conf.json 的 connect-src 同口径（两处都要，形态不同各管一半：
  // dev/prebuilt 走本条，standalone 走 tauri.conf.json 那条）。
  "connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* ws://127.0.0.1:* https:",
  // 应用级「ComfyUI 页签」以 iframe 内嵌本地 ComfyUI（跨端口即跨源）：
  // frame-src 不写就回退到 default-src 'self'，页签里只剩
  // Edge 的「已阻止此内容」（WebView2 的 --disable-web-security 不豁免
  // 嵌入方页面自己的 CSP）。与 tauri.conf.json 的 frame-src 同口径。
  "frame-src 'self' http://127.0.0.1:* http://localhost:*",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import("next").NextConfig} */
const config = {
  // Tauri 桌面壳生产链路：输出 standalone（server.js + 裁剪版 node_modules），
  // 由 scripts/build-desktop.mjs 组装进 src-tauri/static，并以 Node sidecar 运行
  output: "standalone",
  // 双版本并存（typescript=TS6 alias / @typescript/native=TS7）下，Next 内置
  // TypeScript 检测无法识别 alias 包（误报 missing typescript）。
  // 类型正确性由独立 `tsc --noEmit`（CI 门禁）保证，此处跳过内嵌检查。
  typescript: {
    ignoreBuildErrors: true,
  },
  // Next 16.3.2 起 experimental.useTypeScriptCli 默认 true（CLI 模式要求
  // typescript 包带 bin/tsc 文件）。本仓库 typescript 别名到 @typescript/typescript6
  // （bin 只有 tsc6，无 bin/tsc），CLI 模式会误报「typescript 未安装」并使 dev
  // server 所有请求挂死。关掉回退到 typescript-api 模式（TS6 别名带完整
  // lib/typescript.js API）；类型正确性仍由独立 `tsc --noEmit`（TS7 native）门禁保证。
  experimental: {
    useTypeScriptCli: false,
    // ⚠️ Turbopack dev 持久缓存必须关闭（Next 16.4.3 默认 true，config-shared.js L293）。
    // 为什么：16.4 起持久缓存跨会话存活 + turbopack-subscribe 的 hmrVersion 校验
    // （上游 #97966 引入）组合出「整页 reload 死循环」——每次页面加载，主 client 入口
    // 的 chunk list 首条消息是 restart，经 subscribeToClientHmrEvents 推送后
    // clientHmrVersion 自增；页面随后发出的 turbopack-subscribe 携带构建时刻的旧版本，
    // 服务端判 mismatch 直接回 RELOAD_PAGE（hot-reloader-turbopack.js 的
    // turbopack-subscribe 分支），客户端静默 window.location.reload()。新页面自己的
    // 路由请求又 bump 版本 → 下一轮订阅再次过期 → 无限循环。现场特征：整页每 ~2.3s
    // 重载一次（dev server 每 cycle 打一条 GET /workspace 200 + ✓ Compiled）、浏览器
    // console 零报错、无 CSP/ChunkLoadError，任务栏图标随 on_page_load 反复闪烁
    // （CNB issue #3559「启动后界面不断切换」的真实根因）。
    // 上游复现与记录：vercel/next.js #100267（16.4.1 起，16.3.8 不复现；
    // 「plain restart on a cache the previous session had just built looped 3 of 3」
    // —— 与本项目每次启动都命中上一次会话留下的 .next/dev/cache 的场景一致）。
    // 官方记录的规避手段就是关掉它（issue 原文：the loop goes away if you …
    // set experimental.turbopackFileSystemCacheForDev: false）。
    // 代价：放弃 dev 暖启动的编译缓存（冷启动变慢）；等上游修复（跟踪 #100267）
    // 后删掉这一行即可回退。
    turbopackFileSystemCacheForDev: false,
    // #2542 第一格：Turbopack 插件运行时从默认的 childProcesses 换成 workerThreads
    // （Next 16.4.3 config-shared.d.ts L691：'workerThreads' | 'childProcesses' |
    // 'forceWorkerThreads'，默认 childProcesses）。动机是子进程冷启开销：每个插件
    // 作业起一个真进程（Windows 上进程冷启最贵），换 worker 线程省掉进程冷启与
    // IPC 序列化。判法见 issue #2542：冷/暖 next build 墙钟前后对比，不达标即回退。
    // #2081 后续（issue #2521）：依赖缓存槽把作业 node_modules 接成指向项目根外的
    // junction，Turbopack 对 next build 硬拒（Symlink ... is invalid, it points out of
    // the filesystem root）。Next 16.4.3 起提供 experimental.turbopackAdditionalRoots，
    // 把「symlinked dependencies 可能解析进的那份槽根」登记为附加根，Turbopack 即顺着
    // 链解析而不再拒。仅当 CI 接槽（COMFY_CI_SLOT=1）时登记；其余场景无出根 junction，
    // 配 ignoreIfMissing 仅告警忽略。槽根推导与 ci-cache-slot.mjs 同源（不在此另抄事实）。
    ...(process.env.COMFY_CI_SLOT === "1"
      ? (() => {
          const root = resolveCiSlotCacheRoot();
          return root
            ? {
                turbopackAdditionalRoots: {
                  "ci-cache": { path: root, ignoreIfMissing: true },
                },
              }
            : {};
        })()
      : {}),
  },
  // 整治 standalone file tracing 把非 Next 运行时的根级目录纳入 .next/standalone
  // （此前实验键位写错导致完全不生效；Next 16 已把 outputFileTracingExcludes 移为顶层键）。
  // 排除 src-tauri / python-venv / 仓库工具与缓存目录，避免整仓库根被复制进
  // static 进而嵌入 exe。
  // 注意：`generated/**` 不能排除——generated/prisma 是 Prisma 运行时必需。
  // ⚠️ 这份清单是**意图声明**，不是减法：实测它对「全项目 tracing」带进来的文件
  // 一条都没减掉（`./changelog.d/**`、`./src/**/*.test.ts`、`./src-tauri/**` 都写在
  // 下面，产物里对应的那些真文件一个没少）。把文件真正拿掉的是产物层显式删除
  // （`scripts/standalone-private-inputs.mjs`），判据是数产物的
  // `scripts/check-standalone-contents.cjs` —— 别在这里补一条就当修好了，
  // 下面 `.env` 那条注释记的是同一个坑。规范 §7.2。
  outputFileTracingExcludes: {
    "/**": [
      "./src-tauri/**",
      "./python-venv/**",
      // 开发机私有输入不得进产物：`db.sqlite` 是运行期数据库（动态路径 tracing
      // 会把它带进来），`.env` 是密钥文件。两者随 static 被编译期内嵌进 exe ——
      // 密钥明文随包分发，开发库还会成为应用首次启动时读写的那个库
      // （壳以 current_dir(res_dir) 起 sidecar，db 路径按 process.cwd() 解析）。
      // 注意 `.env` 这一项只是尽力而为：Next standalone 的环境加载是**无条件
      // 复制**的（实测写 `./.env` / `./**/.env` 都删不掉），所以真正的兜底是
      // `scripts/build-desktop.mjs` 的「分发卫生」显式删除 +
      // `scripts/check-standalone-contents.cjs` 的产物层检查。
      "./db.sqlite",
      "./db.sqlite-wal",
      "./db.sqlite-shm",
      "./.env",
      "./.env.local",
      "./.env.production",
      "./node_modules/.cache/**",
      "./.git/**",
      "./.workbuddy/**",
      "./coverage/**",
      "./changelog.d/**",
      "./src/**/*.test.ts",
      "./src/**/*.test.tsx",
      "./src/**/__tests__/**",
      "./src/**/*.spec.ts",
      "./docs/**",
      "./tests/**",
      "./test-results/**",
      "./e2e/**",
      "./tools/**",
      "./log/**",
      "./temp/**",
      "./run/**",
      "./dist/**",
      "./build-launcher*/**",
      "./start-tauri*/**",
    ],
  },
  // standalone 产物里的 Next 自带运行时脚本：**这份条目是意图声明，不是防线**。
  //
  // 症状（ISSUE #489）：缺那份运行时脚本时，页面（RSC 走 `app-page-turbo`）与
  // middleware 全正常，而每个 `route.ts` 都要的
  // `app-route-turbo.runtime.prod.js` 加载不到 → **所有 API 路由 500**
  // （`Failed to load external module`），看起来像业务 bug，实际是产物缺口。
  //
  // 为什么这份条目今天不承重（A/B 复测，同机同依赖、只有 `distDir` 隔离）：把它整段
  // 注释掉再构建，两份产物**逐字节同构** ——
  // `standalone/node_modules/next/dist/compiled/next-server/` 两次都是 74 个文件
  //（= 源目录整份复制），四份 `*-turbo.runtime.prod.js` 都在位。
  // ⚠️ 原因**不是**「Turbopack 不读这份键」（那句是错的）：这两个键在 Rust 侧按**路由**
  // 实现（`crates/next-api/src/nft.rs` 用 route glob 匹配 `page_name`，结果由
  // `nft_json.rs` 写进每路由的 `.nft.json`），JS 那边被跳过的只是 webpack 用的
  // `collect-build-traces`。真实原因是**重叠**：每路由清单已经自带整份目录（连这颗
  // glob 给不出的 `*.runtime.prod.js.map` 都在），所以它要补的东西原生追踪都补过了。
  //
  // ⇒ 承重的是**产物层那两处**：`scripts/check-standalone-contents.cjs` 的
  // `REQUIRED_RUNTIME_FILES` 反向数产物，与 `tests/standalone-runtime-completeness.test.ts`
  // 的产物探针。别把「往这里补一条」当成修好了缺件，也别因为「摘掉它产物没变」就判
  // 那份数产物的检查失效 —— 承重的从来是数产物。定位手法见规范 launch-and-build.md §7.4。
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/next/dist/compiled/next-server/*runtime.prod.js",
      // pnpm 12 + Next 16.4.3 在 Windows runner 上做 standalone 产物追踪时漏收 styled-jsx
      // 实体：`.pnpm/node_modules/styled-jsx` 这条 symlink 被复制进了产物，但其真实目录
      // `styled-jsx@5.1.7_@babel+cor…/node_modules/styled-jsx` 没被追进去，导致
      // standalone-link-repair 在 Windows 上报断链、每日生产构建挂掉（连带所有 PR 的
      // check-daily-attendance 一起红）。显式把该变体目录（含其私有 node_modules）收进产物。
      // 见仓库独立 issue（standalone 构建回归）。
      "./node_modules/.pnpm/styled-jsx@*/node_modules/**",
    ],
  },
  // ── dev 期回环两种拼法都要放行（Next 16 的 dev 资源跨源闸门）────────
  // 撞车点：本仓把回环主机统一收成 `127.0.0.1`（硬规则 20 / §12.14，Node fetch
  // 会把 `localhost` 先解析成 `::1`），而 `pnpm dev` 这条裸链路起的是
  // `next dev --turbo -p <port>`（**不带 `-H`**）—— 此时 Next 认定的规范 dev 源是
  // `localhost:<port>`，于是从 `http://127.0.0.1:<port>` 打开页面时，它的
  // `/_next/hmr` WebSocket 被判成跨源并直接掐断（实测：该请求拿到的是「连接被
  // 撕掉」而不是 101，Chrome 侧表现为 `ERR_INVALID_HTTP_RESPONSE`）。HMR 客户端
  // 连不上就反复整页重载 —— 症状是「页面自己一直刷、侧栏点了没反应」，而不是
  // 一条能读出的错误。
  // 启动器那条链（`scripts/dev-launcher.mjs` → `next dev … -H 127.0.0.1`）不会
  // 撞上：`-H 127.0.0.1` 时两种拼法实测都回 101。所以这里补的是**裸链路**那一格。
  // 只放两个回环名，不放局域网地址：这颗键是 dev-only 的安全默认，收紧的方向不是
  // 靠扩大豁免面去修另一个入口。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // tsconfig paths 在无 baseUrl（TS6/7 已移除）时 Next 不自动生成 alias，手动补齐
  turbopack: {
    resolveAlias: {
      "~/*": "./src/*",
      "@/*": "./src/*",
    },
  },
  webpack: (webpackConfig) => {
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      "~": path.join(process.cwd(), "src"),
      "@": path.join(process.cwd(), "src"),
    };
    return webpackConfig;
  },
  async headers() {
    return [
      {
        // 静态字体：Next 对 `/_next/static/**` 自带长缓存，但 `public/` 下的资源
        // 不在此列（默认走 `max-age=0`）—— 而 public 下躺着**三份内嵌字面**
        //（正文 / 标题 / 等宽，合计约 25 MB），每次进界面都重新协商一遍。
        //
        // 敢标 `immutable` 的前提是**文件名即内容标识**：这三档都是压缩产物，
        // 换字面就是换文件名（`tests/embedded-title-font.test.ts` 把「CSS 指向的文件
        // 必须真在磁盘上」钉住了，它同时也是「不许原地换内容」的间接约束）。
        // ⚠️ 这条前提对**新增字面**同样成立，别把服务端渲染出来的字体文件放进这个前缀；
        // 换字面时文件名要变（这也是判据把文件名与 `@font-face` 逐条对齐的原因）。
        source: "/fonts/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // HSTS：仅 HTTPS 部署时生效（本地 http 下浏览器会忽略，无副作用）
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

// 体积分析走 Next 16 内置的 Turbopack 分析器：`pnpm analyze`（= `next analyze`），
// 与默认构建链同链（#2538）。老的 @next/bundle-analyzer 挂在 webpack 上、产物形状
// 与 Turbopack 不可比，已随本改动删除。快照与 JSONL 导出见 `next analyze --help`
// （`--snapshot` 命名快照 / `analyze export` 流式导出给脚本或 AI）。

export default config;
