/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";
import path from "node:path";

/** @type {import("next").NextConfig} */
const config = {
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
