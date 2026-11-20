## Fixed

- **应用服务 stderr 不再每次编译刷「Node.js API is used (process.on) which is not
  supported in the Edge Runtime」+「Ecmascript file had an error」**（#4568）：
  `src/instrumentation.ts` 会被 Next 按 Node / Edge 两种 runtime 各编译一份，
  进程级兜底的 `process.on` 只要写在 instrumentation 本体里，Edge 编译面也会
  静态看到它（调用点虽在 `NEXT_RUNTIME === "nodejs"` 分支内、Edge 产物里被死代码
  消除，但源码级 API 引用仍留在编译单元里），于是每次编译都向 stderr 重复告警
  （现场一次启动 152 条）。兜底实现拆到 `src/lib/process/process-safety-net.server.ts`
  （与 capture-streams / event-loop-watch 等 Node-only 分件同一形态），经 nodejs
  分支动态 import 进 Node 编译图 —— 行为不变（只记日志、不退出；限频与 LRU 封顶
  口径原样保留），Edge 编译面从此干净。
