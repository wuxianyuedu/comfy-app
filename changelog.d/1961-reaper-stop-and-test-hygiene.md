## Fixed

- **`startReaper()` 起了不收 = 跨用例泄漏：CI 上那条 `Test timed out in 30000ms`
  的真因与超时无关**（`src/lib/comfyui/reaper.ts` + `src/lib/db-schema-ready.test.ts`）。

  `startReaper()` 的 handle 挂在 `globalThis` 上（HMR 单例，见 `ReaperGlobal`），
  一被调用就活到**整个 worker 进程结束**、每 `REAPER_MS` 真去查一次库。而用例用
  `vi.spyOn(taskRepository, …)` 断言「这一轮**不该**被调用」时，命中的是**上一条用例
  留下的那个实例** —— `vi.resetModules()` 换的是模块实例，换不掉已经跑起来的定时器。

  隔离复现拿到的读数是 `AssertionError: … but actually been called 1 times`；
  而在慢机 / 并行负载（`--maxWorkers=4` + `--coverage`）下，那一轮恰好落在 30s
  窗口里就退化成超时读数 —— **同一份代码、同一台机，红的话术能有两种**。

  修法是补上缺的那一端（硬规则 24）：新增 `stopReaper()`（`clearInterval` +
  清在途守卫，**生产路径零调用点**），用例 `afterEach` 收尾，并在
  `tests/reaper-side-effect.test.ts` 立一条判据 —— 「用例里 `startReaper()` 与
  `stopReaper()` 必须成对出现」。这条判据自己踩的两个坑也一并钉住：只认成员调用
  （`m.startReaper()`）会把解构后直呼的正当形态误报；不剥注释与字符串字面量会把
  说明段落、报错文案与自己数进去（第一版把 `reaper.test.ts` 的文件头与
  `db-schema-ready.test.ts` 的收尾说明各数一次，第二版把自己数成「起 4 收 2」）。

  反向复算：删掉用例里那行 `stopReaper()`，判据当场点名
  `db-schema-ready.test.ts（起 1 / 收 0）`；不删时同一条断言实测为 `0 次`。

- **规范 §11.26 补一节「跨用例的资源泄漏」**：这类红的形态是超时、真因是状态被带过来，
  与 §11.13 的定性顺序接上（先隔离重跑 → 才判真假 → 发现是用例自己的既有债时按
  「生产侧补 `stop*` / 用例侧收尾 / 判据侧判成对」三端收）。同时记下「不把所有
  `setInterval` 都判一遍」这条边界：判据落在**调用点**上，不落在形状上。
