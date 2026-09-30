## Fixed

- **`/api/comfy/stats` 的降级包补回 `online` 字段**（复算 master 基线时发现的别线红，不是本批引起的）。
  加了「进程级判活」之后，路由的判据写成 `if (stats !== null)` —— 于是采集器返回
  `undefined` 时走的是**在线那一支**，回包变成 `{ processAlive: true }`：既没有
  `online` 也没有指标字段。状态栏那一格按 `online` 渲染，缺字段就是它原本要消灭的
  「第三种状态」，而路由自己的注释仍写着「未运行时返回 `{ online: false }`」。
  改成按真值判（`if (stats)`）：`null` 与 `undefined` 都落到那个**带 `online` 的完整降级包**，
  `{}`（采到了但没字段）继续在在线那一支。
- **`comfy-stats-store` 里一个永不可达的判断**：`processAlive` 分支先赋值
  `processAlive = true`，再写 `online: processAlive || snapshot.stats?.online === true`
  —— 右操作数永远求不到。这一支的 v8 分支覆盖因此卡在 95.23%，而 100% 那条门槛
  是被一个**死式**顶住的（不是「没人测」）。按这一支的实际语义写成 `online: true`，
  行为一字不变。

## Added

- **`/api/comfy/stats` 用例按新契约重写（6 条，路由仍 100% 满档）**：在线转发时
  `processAlive` 补上且**不覆盖采集器自己的字段**、这一拍**不该再去查进程表**；
  采不到时按进程快照回落（`running` 真/假两档分别验）；`undefined` 也给完整降级包；
  `{}` 不算离线；`force-dynamic` 不许掉（GET 被缓存 = 状态栏停在第一次的数）。
- **`getComfyStatsServerSnapshot` 的契约用例**：它只在 React 走 SSR 时被调用，
  jsdom 那一路永远碰不到，所以它是「用不到但必须存在」的出口 —— 判的是**同一对象身份**
  （`useSyncExternalStore` 按 `Object.is` 判等，服务端返回新对象会让 hydration 之后
  再渲染一次）与「未观测时就是无数据那一档，不凭空造出离线或连接中」。
