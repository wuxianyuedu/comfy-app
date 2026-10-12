## Fixed

- **`COMFY_EXECUTOR=host` 下 `pnpm dev` / `tauri dev` 不起执行器宿主，任务永远到不了终态**
  （ISSUE #1767 的后续那一格）。上一批收掉了 `scripts/start.mjs`（Playwright 的
  `CI=1` 档 webServer），而 `scripts/dev.mjs` 是**四个启动入口里最后一个缺口** ——
  `pnpm dev` 与 `tauri.conf.json` 的 `beforeDevCommand` 都走它，两条都不经
  `dev-launcher.mjs` 的编排 6.5 步。host 模式下行被写成 `claimedBy='host'`，而只有
  宿主会去领它（inline 那侧的回收器刻意不跨片误杀，ISSUE #1204），于是行安静留在
  `QUEUED`、没有任何失败判决，界面表现是「一直不动、排队数一直涨」，行上只有一句
  「⏳ 等待…」。
  - 修法与 `start.mjs` 同一处：`maybeSpawnExecutorHost()`（`scripts/launcher-core/executor-host-spawn.mjs`）
    接上同一次调用，排在起 Next **之前**（宿主 boot 的行与 Next 的启动行在时间上可比）。
    四个入口至此全部接线，共用一份实现（§12.18 / §12.12）。
  - **判据顺带收紧**：`tests/executor-host-spawn.test.ts` 原来用
    `indexOf("maybeSpawnExecutorHost({")` 判「入口接没接线」—— 它只证明**字符串在文件里**，
    把调用改成 `if (false) …`、加 `//` 注释掉、或整段删掉，三种「事实上没接线」的形态
    都能骗过（实测确实全绿）。新增 `topLevelCallAt()`：剥注释后按「行首即 `name(`」定位，
    三条形态现在各红一条（已反向验证）。该断言的覆盖面同时补上 `dev.mjs`。
  - 文档口径同步：`launch-and-build.md` §5 那格与 `docs/guide-executor-host.md` 的
    「⚠️ `pnpm dev` 不会拉起 host」改写成现状（不再有「已知未修」的入口）。
