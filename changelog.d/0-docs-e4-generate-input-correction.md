## Fixed

- **订正台账 E4 里我自己写错的一格判断**（立案时把「从 schema 反向派生的类型」当成了手写镜像）：
  原文写着「`GenerateSchema` 被多处 `RouterInputs` 镜像复用，而 mutate 侧在用例里是桩 ——
  真实入参校验从没跑过」。`RouterInputs["generate"]["generate"]` 那几处不是手写表 ——
  它是从真 schema 反向派生的类型，字段改名会当场编译红，所以它**不构成漂移面**；
  真正存在的是两条 cast：`src/lib/project-canvas/canvas-api.ts` 的
  `startGenerate(payload: Record<string, unknown>)` 在传输前塞一句 `as GenerateInput`，
  以及 `use-generate.ts` 的重试通路把任务行 `params` 列里存的**旧载荷**原样送回同一个 cast
  （两端之间没有客户端可读的形状，服务端 zod 是唯一判点）。
  条目按这个形状重写，并把下一刀的判据范围写明（抽纯函数 + 用真 `GenerateSchema` 判四格）。
