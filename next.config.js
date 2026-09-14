/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import path from "node:path";
import withBundleAnalyzer from "@next/bundle-analyzer";

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
  },
  // 整治 standalone file tracing 把非 Next 运行时的根级目录纳入 .next/standalone
  // （此前实验键位写错导致完全不生效；Next 16 已把 outputFileTracingExcludes 移为顶层键）。
  // 排除 src-tauri / python-venv / 仓库工具与缓存目录，避免整仓库根被复制进
  // static 进而嵌入 exe。
  // 注意：`generated/**` 不能排除——generated/prisma 是 Prisma 运行时必需。
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
  // ── 生产级安全响应头（OWASP 2025 A05/A08）────────────────────
  // 全站生效，同时覆盖 /api/*（tRPC、better-auth、文件流等）。
  // 本地开发保留 'unsafe-inline'：Next.js dev 模式需要内联脚本；
  // 严格 nonce 方案可在此基础上按需收紧（见 t3-fullstack 技能 security-hardening）。
  async headers() {
    // 开发模式（Next 16 + Turbopack）依赖 eval() 做调试堆栈重构，
    // CSP 需放行 'unsafe-eval'；生产环境保持严格策略不变。
    const isDev = process.env.NODE_ENV !== "production";
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'";
    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // ComfyUI 本地服务 / SSE 流 / WebSocket（ws://127.0.0.1:8188）
      "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https:",
      // 应用级「ComfyUI 页签」以 iframe 内嵌本地 ComfyUI（跨端口即跨源）：
      // frame-src 不写就回退到 default-src 'self'，页签里只剩
      // Edge 的「已阻止此内容」（WebView2 的 --disable-web-security 不豁免
      // 嵌入方页面自己的 CSP）。与 tauri.conf.json 的 frame-src 同口径。
      "frame-src 'self' http://127.0.0.1:* http://localhost:*",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
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

// ── @next/bundle-analyzer（可选体积分析）────────────────────────────
// 仅当 ANALYZE=true 时启用（先跑 `pnpm analyze`，由 scripts/analyze-bundle.mjs 注入该变量）。
// 注意：@next/bundle-analyzer 挂在 webpack 上，Turbopack 不支持；因此分析时
// 必须强制走 webpack（analyze 脚本内 `next build --webpack`），默认
// `next build`（Turbopack）不受影响。构建完成后输出可视化报告到
// .next/analyze/*.html（client / nodejs / edge 三份），并监听
// http://127.0.0.1:8888 供浏览器查看。
const withBundleAnalyzerConfig = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

export default withBundleAnalyzerConfig(config);
