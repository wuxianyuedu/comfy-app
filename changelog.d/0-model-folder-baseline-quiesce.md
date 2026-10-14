## Fixed

- **修掉一条能稳定复现的负载假红**（`src/components/studio/hooks/use-model-folder-config.test.ts`
  的「重渲染不复发首屏加载：configList 只在挂载时取一次」）：基数快照从前取在
  `expect.poll(() => configListCalls).toBeGreaterThan(0)` 刚返回的那一刻 —— 那条件只说明
  「第一发已经出发」，而挂载期是两发（`useQuery` 首发 + 首次加载 effect 用 `setTimeout(0)`
  排的一次 `refetch`，正是 #1803 那条修法留下的形状）。于是第二发被记到重渲染之后，
  断言读成 `expected 2 to be 1`。改法是等**被测对象自己的落定信号**再记基数：
  该 hook 的 `loading === false` 只在被等那次 `refetch` 的 `finally` 里被写。
- **前后读数（本机 16 核 + 24 个忙等进程，只跑这一条用例）**：改前 **3/3 红**、改后 **4/4 绿**；
  隔离串行跑整文件 9 条全绿。这条是上一刀查负载红时顺手撞出来的另一处墙钟依赖，
  与「一个用例一把时钟」同族 —— 都是拿墙钟的偶然瞬间当结论。
- 规范 11 §11.14 补一条口径：**基数与断言的起点要挂在落定信号上**（`loading` / `status` /
  `hasError` 这类由被等动作写的位），别拿「计数 > 0」当落定 —— 前者是「这件事做完了」，
  后者只是「这件事开始过」。
- 同节那条「这一形状的存量」改写为**不写死条数**：本仓条数随合并漂（同一台机器上一晚就从
  21 份含 `vi.useFakeTimers()` 的用例文件变到 22 份），所以只留重数入口
  （`grep -rl "vi.useFakeTimers" src tests` + 逐用例体问「第一次挂载在换时钟之前还是之后」）
  和那个陷阱：粗数会跨 `describe` 边界误报，量具输出必须逐处人工读。
