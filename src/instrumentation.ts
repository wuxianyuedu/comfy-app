/**
 * Next.js 遥测/观测初始化入口（Next 15 约定文件，自动执行）。
 * 仅在配置了 SENTRY_DSN 时启用 Sentry；未配置则全部 no-op。
 *
 * 注意：本文件在 Node.js 与 Edge 两种 runtime 下都会执行，
 * 必须按 runtime 分别加载对应配置，禁止在此处引入 server-only 模块。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
