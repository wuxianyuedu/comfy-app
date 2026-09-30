## Fixed

- **进程重启后影片永远停在「生成中」（`GENERATING`）：既不出片也不判失败**（P3 §5 ADR 5-A）。`startFilm` 末尾那条 `void watchFilm()` 只活在**当前进程**里，而镜头对应的任务还在库里由执行侧推进（宿主不跟着 Next 一起死）——dev 的热编译重启、桌包的重启都会把监看弄丢，于是影片停在 `GENERATING`，界面是一个转不完的圈，没有任何一行日志说「没人监看它」。
  - 修法 = **唯一一处** boot 恢复扫描：`src/instrumentation.ts` 的 nodejs 分支（与 `startReaper` / `startDispatchLoop` 并排、排在其后）调 `resumeStalledFilms()`，`isSchemaReady()` 不过就整轮跳过，与回收器同一口径。扫描自己炸了只 Warn、**不许把启动打死**。
  - 判据 ①：同一部影片**至多一条**循环。去重表挂在 `globalThis.filmWatchInFlight_v1`（带版本号是既定的坑：`??=` 只认键名，模块级 `Set` 在热重启后看不见旧循环 ⇒ 两条循环都会去调 `composeFilm`，而 `markComposing` 是无条件写 ⇒ 同一部片被 ffmpeg 合成两次）。
  - 判据 ②：停在 `COMPOSING` 的**不续跑、直接判 `FAILED`**。`composeFilm` 一见到 `COMPOSING` 就早退，那一格连界面上「重新合成」这个唯一出口都被自己的状态挡住；判成 `FAILED`（它允许重跑的状态）才把出口接回来，也避免开机时静默重跑 ffmpeg。
  - 判据 ③：被捡起来的 `GENERATING` 若一行镜头都没有（`markGenerating` 之后、逐镜提交之前崩的）当场判失败并写清下一步 —— 这条状态此前不可达（监看只由 `startFilm` 起，那时 shots 必然非空），放过去就是 `0/0` 的 NaN 进度 + 拿空时间线去合成。
  - 顺带把监看预算的**文案与判据收到同一处**：`WATCH_POLL_MS` / `WATCH_MAX_ITER` / `WATCH_BUDGET_MIN`，续跑与超时两条文案都插值同一个常量（原先注释写「~16 min」、报错写「超过 16 分钟」，改一个不动另一个）。
  - 为什么不是「把 `watchFilm` 搬进执行宿主」（ADR 那条字面写法）：宿主运行时图引不到 `src/server/**`（`tests/lib-server-imports.test.ts` 的 `REGISTERED` 现为空），film 仓储还带 `import "server-only"`、`composeFilm` 还要 `./compose-steps` —— 那是 §11 明写「独立议题、未落」的数据层双宿主；而桌包里 server 与宿主同生死（关窗整树回收），搬过去也**多不了一次关闭**。前置清单记在 **ISSUE #1255**（四条墙与落地顺序都在里面）。
- 影片侧新增按状态查询 `filmRepository.listByStatus(statuses)`（恢复扫描用，`createdAt` 升序 = 先起先续；刻意不带 userId —— 这条查询的语义是「本机这份库里还有哪些行该有人推进」）。

## Tests

- `tests/film-resume-startup-point.test.ts`：启动点唯一 + 顺序（先 stdout 转录 → reaper → 派发循环 → 影片续跑）+ Edge 分支里不许出现 + 执行宿主不另起扫描 + 在飞表的 globalThis 键带版本号 + 预算分钟数只有一处出处。变异核过：删掉那个启动点 → 三条红；把分钟数写死 → 预算那条红；在飞表退回模块级 `Set` → 去重那条红（**行为用例在全绿**，正是它必须是源形态判据的理由）。
- `src/server/film/orchestrator.test.ts` 新增 `resumeStalledFilms` 判决组：`GENERATING` 被接回并留痕是续跑、零镜头当场判掉、`COMPOSING` 判 `FAILED` 且**不**自己重跑 ffmpeg（断 `markComposing` 未被调）、在飞时第二次扫描不起第二条、表没建一条都不查、扫描失败只 Warn。

## Docs

- 规范 §5 一行（症状 = 「一直停在生成中/合成中」）、`docs/guide-executor-host.md` 崩溃恢复一节新增一条、ADR §19 记 5-A 的签字与为什么不走宿主形态。
