/**
 * Next.js 遥测/观测初始化入口（Next 15 约定文件，自动执行）。
 * 仅在配置了 SENTRY_DSN 时启用 Sentry；未配置则全部 no-op。
 *
 * 注意：本文件在 Node.js 与 Edge 两种 runtime 下都会执行，
 * 必须按 runtime 分别加载对应配置，禁止在此处引入 server-only 模块。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    /* 把本进程（应用服务）的 stdout / stderr 转录一份进面板可见日志文件：
     * 此前首屏编译错误、Turbopack FATAL、未捕获的服务端异常只落在
     * log/nextjs/nextjs-stderr-*.log，而「应用日志」面板不读它——应用服务起不来
     * 时用户打开面板看到一片空白（ISSUE #360）。
     * 用动态 import 是刻意的：本文件在 Edge runtime 也会执行，Node-only 模块
     * 不能进入 Edge 图（同下方 sentry.server.config 的处理）。 */
    await import("./lib/log/capture-streams.server").then((m) =>
      m.installStreamCapture(),
    );
    /* ComfyUI 孤儿任务回收的**唯一** Next 侧启动点（P3 §5 ADR §14 D3）：
     * 它过去靠 `enqueue.ts` 的裸副作用 import 顺带起来，那条隐式耦合让
     * 「谁起 reaper」在模块图上不可见、且被删 import 时会静默失效。
     * 动态 import 的理由与上面两条相同：本文件在 Edge runtime 也执行，
     * Node-only 模块不能进 Edge 图。 */
    await import("./lib/comfyui/reaper").then((m) => m.startReaper());
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
