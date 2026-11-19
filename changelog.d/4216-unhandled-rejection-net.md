## Fixed

- **成片监看循环的 rejection 就地收口**（#4216）：`void watchFilm(id)` 起的常驻后台链
  整段没有 try/catch，任一 DB/ffmpeg reject 就是 unhandledRejection。现在失败写影片
  日志（error）并把影片判 FAILED（不留 GENERATING 假活），收口自身再各兜一层。
- **进程级兜底显式化**：`instrumentation.ts`（nodejs）与 `scripts/executor-host.mjs`
  显式注册 `unhandledRejection` / `uncaughtException`（只记日志、不退出）——此前只有
  `@sentry/node` 默认集成的隐式副作用在兜，executor-host 等宿主进程没有这层。
  补测试：orchestrator 收口 1 例、instrumentation 契约 2 例。
