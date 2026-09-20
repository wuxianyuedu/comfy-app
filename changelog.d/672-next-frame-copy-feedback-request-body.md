## Changed

- **「等一帧再做事」收成一处出口**（规范 16 §16.2.4.42，判据 P39）：新增 `~/lib/next-frame` 的 `onNextFrame`（一帧，读刚渲染出来的 DOM）与 `afterNextPaint`（两帧，等 React Flow 这类三方布局库重排），**两者都返回取消函数**。此前 8 处各写一遍，其中 4 处写在 effect 里而没有清理（effect 因依赖抖动重跑时旧帧仍会落地，表现为往已经翻走的面板上滚一次），另有 2 处各写一份双 rAF 且理由各写一遍注释。调度本身现在只有一处定义；帧循环（`use-fps` 的采样器、贴合收敛循环）刻意不收。
- **「复制到剪贴板之后给什么反馈」收成一处出口**（规范 16 §16.2.4.43，判据 P40）：新增 `~/components/ui/use-copy-feedback` 的 `useCopyFeedback`（成败各给一条出口、`onFailure: "silent"` 是显式静默、同步 ref 判重入）与 `useCopyResult`（只要成败、不报反馈）。此前 14 个落点给出六种答案，其中设置页加载错误与 `ui/json-viewer` **只判成功、没有失败分支**，`logs` 的「复制全部」则把结果整个吞掉（`log-export` 的注释写着「按钮上已有反馈」，而那段反馈并不存在）。现在失败都能被说出口，反馈形态仍留在调用处。
- **REST 路由的入参收窄收成一处出口**（规范 16 §16.2.4.44，判据 P41）：新增 `~/server/lib/request-body` 的 `readJsonRecord` / `isErrorResponse`，`unknown` 的收窄统一走 `~/lib/is-record` 的 `isRecord` / `isPlainRecord`（此前有 **9 份**逐字相同的实现）。11 个 POST 路由的「读体 → 判对象 → 400」不再各写一遍。

## Fixed

- **畸形 JSON 请求体被静默当成空对象**：`custom-nodes` / `llm/test` / `workshop/logs` 三处用 `await req.json().catch(() => ({}))`，于是同一个坏请求在一种写法下回「请求格式错误」、在另一种下走到「字段缺失」分支回一句与病因无关的话。现在统一回 `400` + `{ error: { code: "validation.invalid", message: "请求格式错误：正文不是合法 JSON" } }`。
- **`logs/export` 用类型断言代替校验，坏请求体被兜成 500**：`(await request.json()) as { label?: unknown; content?: unknown }` 不是校验 —— 畸形正文或非对象会在下一行属性访问处抛 `TypeError`，被 `catch` 兜成 500（用户看到「服务端错误」而病因在自己的请求体）。现在格式不对明确回 400。
- **`logs` 面板的「复制全部」失败在界面上完全不可见**：`copyAll` 把剪贴板结果吞掉、按钮自己没有任何状态。现在成功短暂换成对勾、失败原地换成「复制失败」并在 `title` 里说清怎么自救，`copyLogText` 改为把成败原样返回。
- **`ValidationError` 从规范落进代码**：规范 10 §10.9 的对照表长期写着「入参校验失败 → `errorResponse(new ValidationError(...))`」，而 `core/errors.ts` 按「无生产调用方不立类」的裁决把它删掉之后这条只剩文档。`readJsonRecord` 是它的第一个真实调用方，据此补上（仍走 `{ error: { code, message } }` 的唯一信封）。
