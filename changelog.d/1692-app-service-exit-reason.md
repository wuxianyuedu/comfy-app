## Fixed

- **应用服务断了，前端只会说「已断开」、说不出原因**（ISSUE #1692）。状态栏那一格探测的是 `GET /api/dev/server-id`——那是应用服务**自己**的 HTTP，它一旦不在，这条通道必然不通，于是「为什么没了」在事后**根本问不到**：用户看到的永远是同一句「应用服务已断开」，是编译失败、端口被顶、还是自己崩了，全靠猜。
  - 修法是把原因交给**死的那一刻还活着的旁证人**写下来：启动编排的收尾定性（`scripts/dev-launcher.mjs` 的 `concludeDownstreamExit`）本来就判出了成因（`downstreamExitKind` + dev 的 `exitCode` / `signalCode`），过去只在启动失败弹窗里讲一次，现在同一份结论落进 `run/app-service-exit.json`，且**写在回收整棵进程树之前**——顺序是语义的一部分。
  - 读取侧只能发生在**服务恢复应答之后**（探活通道随服务一起没了），因此这份记录**刻意不在启动时清掉**：清了就恰好把恢复后要读的东西清没。陈旧记录不会误报——它带着结束那一次的 `runId`，而当前进程的 `runId` 由 `COMFYAPP_RUN_ID` 透传，判据在 `~/lib/shell/app-service-exit` 一处（`isPreviousRunExit`）。
  - 新端点 `GET /api/dev/last-exit` 回「记了什么 + 当前 runId」；读不到 / JSON 坏了都回 `{ record: null }` 而不是 404——「没有原因可讲」是**正常状态**，显示成「接口挂了」正是 §10.3.1 要消灭的静默失败。
  - 界面按 §10.3.1 的两问说话：状态栏第 2 区把**一句原因**摆成可见文字（悬停不是可发现的动作），完整三句（为什么 / 这一次具体是什么结束的 / 现在该做什么）在该格的 `title` 里；「刚重启」那档把「后果」与「为什么」接成一句（过去只有后果）。
  - 退出事实的取舍：**信号优先于退出码**（被 SIGKILL 强杀与自己 `exit 1` 的排查方向完全相反，而 Windows 上两者都表现成一个非零码）；两者都拿不到时**说拿不到**，不编一个「退出码 0」（0 是「正常退出」这个具体结论）。
  - 「用户放弃启动」不许被说成故障、「真故障」不许被说成设计内行为——两种误报都会把人引向一个已经不会复现的方向。

## Tests

- `src/lib/shell/app-service-exit.test.ts`：记录解析（坏文件回 null、未知成因收成 `unknown` 而不是丢掉整条）、退出事实取舍（信号优先 / 编不出 0）、成因文案（每档都有 why+action+detail、放弃启动不许说成故障、真故障不许说成设计内）、`isPreviousRunExit`（runId 相同不显示、任一方为空按可显示处理）。
- `tests/app-service-exit-contract.test.ts`：跨侧同源的可失败判据——文件名两侧逐字相同、JS 侧 `downstreamExitKind` 的返回取值集合每个都被 TS 的联合类型认得出（**不是包含**：多写一个 TS 认不出的取值也是漂移）、字段名同源、无 BOM、写入排在 `await shutdown(` 之前、启动编排里**不许出现** clear 调用。变异核过：改 JS 侧文件名 → 红。
- `tests/app-service-exit-writer.test.ts`：落点、无 BOM、拿不到退出码写 null 不写 0、type 不对退回 null、重复写覆盖、写不进去返回 false 而不抛错。
- `src/app/api/dev/last-exit/route.test.ts`：回记录原文与当前 runId、无记录 / 空文件 / 坏 JSON 一律 200 + `record: null`（不许 404 / 500）。
- `src/components/studio/hooks/use-dev-server-liveness.test.ts`：探通之后才读记录、**每个 bootId 只读一次**（假定时器真推进 4 拍，断言探活跑了多拍而读取仍是 1 次）、runId 相同不显示、`record: null` 不编原因、端点挂了不影响探活。变异核过：去掉 bootId 去重闸 → 红（**第一版用例用真 `setTimeout` 等 50ms，恒绿且测不到那道闸，同一条变异不红——已按 §11.14 改成 `expect.poll` 并推进假定时器**）。
- `src/lib/shell/dev-server-status.test.ts` + `src/components/studio/BrowserStatusBar.test.tsx`：断开且原因已知 → title 三句齐全、可见文字摆出原因；断开但原因未知 → 保留原来的「怎么恢复」；刚重启 → 后果与原因接成一句；在线且没刚重启 → 不挂旧结论（几小时前的旧结论不该一直贴着「运行中」）；没有原因可讲时不占位。
