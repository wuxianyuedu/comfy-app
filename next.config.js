/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // ── 生产级安全响应头（OWASP 2025 A05/A08）────────────────────
  // 全站生效，同时覆盖 /api/*（tRPC、better-auth、文件流等）。
  // 本地开发保留 'unsafe-inline'：Next.js dev 模式需要内联脚本；
  // 严格 nonce 方案可在此基础上按需收紧（见 t3-fullstack 技能 security-hardening）。
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
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
