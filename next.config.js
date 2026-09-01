/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import path from "node:path";

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
  // Next 16 默认 useTypeScriptCli=true 要求 typescript/bin/tsc，而双版本并存下
  // TS6 alias 包只提供 bin/tsc6，会导致误报 missing。显式关闭走 API 检测
  // （lib/typescript.js 存在，配合 ignoreBuildErrors 仅做 setup 验证）。
  experimental: {
    useTypeScriptCli: false,
    // ── 整治 standalone file tracing 把整个仓库根塞进 .next/standalone（>8GB）──
    // Prisma 的 schema.prisma 引用导致 Next tracing 把仓库根（含 src-tauri 7.5GB、
    // python-venv、generated 等）整份纳入 standalone，进而被 build-desktop.mjs
    // 复制进 src-tauri/static 并嵌入 exe。此处从源头排除所有非 Next 运行时的
    // 根级目录，使 standalone 仅保留 server.js + 裁剪 node_modules + 必要 chunks。
    outputFileTracingExcludes: {
      "/**": [
        "./src-tauri/**",
        "./python-venv/**",
        "./generated/**",
        "./node_modules/.cache/**",
        "./.git/**",
        "./.workbuddy/**",
        "./coverage/**",
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

export default config;
