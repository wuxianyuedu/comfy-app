## Fixed

- **脚本档清账批 11：`e2e/support/fake-comfyui-server.mjs` 17 格清零，账从 95 处 / 11 份
  （原 112 / 12）（ISSUE #2589 / 规范 §13.5.14.1）**：这份是 e2e 的**假 ComfyUI 服务端** ——
  它的正确性不靠类型，靠「与真件同形」，所以这一批的凭据全部落在**真起一次服务再打它**上
  （见下）。17 格里 12 格是形参（`isLoopback` / `isCrossOriginRequest` / `readBody` /
  `sendJson` / `handle` 五个函数 + 一个事件回调的参数），其余 5 格是一处下标读、一处
  被字面量推窄的响应头表、以及 `chunks` 那个累加数组。

  **全账唯一那一格 `TS2464`（计算属性名必须是 string）与同一行的 `TS2345` 是同一个根因**：
  `/api/history/{id}` 那一段把 `historyMatch[1]` **按了两遍下标** —— 一遍进
  `decodeURIComponent(…)`（要 `string`），一遍当 `{ [historyMatch[1]]: entry }` 的键
  （也要 `string`）。解构成 `const [, historyId = ""] = historyMatch` 一次，两格同时消失，
  而且**读两遍变读一遍**这件事本身就是要收的东西（与批 7 那处「同一个 `.get()` 点两次」同族）。

  **这是「补类型不是纯减法」的第四次现场**（批 1 的 4 格、批 6 的 5 格、批 8 的 1 格）：
  把 `handle(…)` 的形参从隐式 any 指成 `string` 之后，调用点
  `const path = (req.url ?? "/").split("?")[0]` 立刻新冒一格 `TS2345`，
  `isLoopback(hostCompare.split(":")[0])` 冒两格（`TS2345` + 随后那句赋值 `TS2322`）。
  全部按既有口径在**产生端**收（解构给默认值），不抬严格度、不写非空断言，
  也没有借 `--update` 把任何新格登记成已知存量。

  行为恒等的凭据（这一批是**真起服务打它**，不是只跑用例）：
  ① 两份消费方用例串行复跑 = **62 条全绿**（`tests/e2e-fake-comfyui-endpoint.test.ts` 33 条、
  `tests/e2e-reclaim-own-fake-port.test.ts` 29 条），其中那一组的名字就是口径本身：
  「探针真的探（拿真 HTTP 服务喂它，不复刻一份实现）」；
  ② 仓库外写一份探针脚本，`spawn` 起这份替身（`listening on http://127.0.0.1:18188 cors=true`），
  把被改动碰到的每条口都打一遍：未登记的 `/api/history/nope-1` → `200 {}`（真件同形、
  也是轮询等待那一段）；`POST /e2e/record-history` 登记 `prompt-e2e-1` 后再取
  `/api/history/prompt-e2e-1` → `200`，**键集合逐字是 `["prompt-e2e-1"]`**、
  `outputs["9"].images[0].filename` 在场（这正是那一处解构改动经手的那一格）；
  `POST /prompt` 带 `{"client_id":"c42"}` → 回 `prompt-c42-2`（证明 `readBody` 的
  `Buffer[]` 累加与 `chunks` 注解没把请求体读坏）；`/`、`/queue`、`/api/view`、
  `/system_stats` 四路口状态与 `content-type` 照旧（`image/png` 那路 61 字节）；
  WebSocket 两条口 `/ws` 与 `/api/ws` 都能连上并收到 `{"type":"status",…}` 回帧；
  ③ 再把 `E2E_FAKE_COMFY_CORS=0` 起一遍打同一句带 `Origin` 的请求 → **403**
  （默认档根本不调 `isCrossOriginRequest`，所以那一格的类型注解必须有这一档才算被读过；
  netloc 含端口的比较行为未变）；
  ④ `node --check` 通过、`pnpm exec eslint` 零输出、依赖新鲜度复算 `EXIT=0`；
  棘轮 `--update` 后复算 = 面 214 / 存量 **95** / **11** 份。
