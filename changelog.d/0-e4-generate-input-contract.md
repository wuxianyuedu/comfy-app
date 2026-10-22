## Added

- **台账 E4 的第四格配上判据：`generate.generate` 的入参通路（画布构造 ↔ 服务端判据）**。
  这条通路此前有三条 cast（立案时记成两条，动手时数出来三条），其中两条在画布那一头：
  `canvas-api.startGenerate(payload: Record<string, unknown>)` 传输前一句 `as`，以及
  重试通路把**任务行 `params` 列里存的旧载荷**原样送回同一个 cast。类型别名
  `RouterInputs["generate"]["generate"]` 不是漂移面（它由 schema 反向派生，改名当场编译红），
  那两条 cast 才是 —— 它们让客户端在运行时对「线上要什么形状」一无所知，服务端 zod 是唯一判点，
  而界面上只剩一句「生成失败」。
- **修法是把判据搬到客户端读得到的地方，不是再写一份收窄**：入参 schema 从
  `src/server/api/routers/generate.ts` 搬进 `src/lib/workflow/workflow-generate-input.ts`
  （与 `workflow-io-types.ts` 同一手法 —— 形状住 lib，服务端只是它的消费方之一），
  导出 `generateInputSchema` / `GenerateInput` / `parseStoredGenerateInput`。
  画布那段载荷构造从 `runGenerate` 抽成纯函数 `buildCanvasGeneratePayload`
  （`CanvasNode/generate-payload.ts`，返回类型即 `GenerateInput`，`projectId` 由调用点注入
  而不是函数体内读 store —— 读 store 写进构造函数就没法在没有人造上下文的条件下被测），
  `startGenerate` 改吃 `GenerateInput`（cast 存在的条件被拆掉）。
- **重试现在先过同一个 schema**：拒了就不发这次请求，并把「哪一列不对 + 下一步做什么」
  拼成一句中文交给错误面板（内层仍嵌着 zod 那句原文，判据断的是路径、出路、可重跑三样都在）。
  只给 `workflow` 这一条补了 schema 级中文文案 —— 它是重试旧记录时真会缺的那一列。
- 判据 `tests/generate-input-wire-contract.test.ts`（5 条）**不造夹具载荷**：把画布真构造出的
  那一份接进真 router 走一次，判 ① 收得下且逐键等于落进 `params` 列的那一份（含
  `control_after_generate` 那条并数组派生与 `random → randomize` 的换算）② 缺必填 `workflow`
  时 router 与客户端预检同拒（信号来自 schema，不是来自画布那句界面 guard）
  ③ 从库里翻出来的载荷再过一次判据仍然**建得出任务**（重试的幂等前提）
  ④ 旧形状（`workflowInputs` 写成对象）被拒时的读数 ⑤ 三层 `paramMap`
  （`source.mode:<模式>`）在这一列上仍是那份权威形状。变异两刀打在不同的半边：
  构造里漏掉 `referenceImages` → 只有 ① 红；把预检改成「不判、原样发」→ ②④ 红而 ① 绿。
- **`video-queue-client.submitGeneration` 那第三条 cast 留着没动**，因为它撞在一份有主的既有
  契约上：`tests/task-list-wire-contract.test.ts` 显式判「`params` 缺省时照样把只有 `prompt`
  的入参发出去」与「服务端拒绝时把拒绝原样交回调用方（出口在视图，这里不吞）」。要给它加预检
  就得先改掉那份判据 —— 那是改别人的口径，不在这一格里顺手做；已登记进台账 E4 的「还留着」。
