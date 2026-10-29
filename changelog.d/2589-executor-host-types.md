## Fixed

- **脚本档清账批 13：`scripts/executor-host.mjs` 13 格清零，账从 79 处 / 10 份降到 66 处 / 9 份
  （ISSUE #2589 / 规范 §13.5.14.1）**：这一份是 ComfyUI 执行链的**宿主进程外壳**
  （规范 §3 / §5：领取节拍、注入链、取消收尾都在这）。13 格里 7 格是两个模块级
  `let x = null`（`hostRuntime` / `claimHandle`）—— 「句柄」这一类状态在类型上等于「没有形状」，
  于是每个使用点都是隐式 any。

  **给 `hostRuntime` 写出形状之后，当场暴露两处「一句守卫管不到第二处」的真问题**
  （不是补注解补出来的假问题）：

  ① `reconcileCancelled()` 第一句就 `const { hostRepo, cliProcs } = hostRuntime;`，
  而它的**空值守卫在调用点**（`claimTickOnce` 顶上那句 `if (!hostRuntime) return;`）——
  一个函数依赖调用点替它保证的前提，在类型上是看不见的。改法不是在这里再判一次空，
  而是**把那个前提写成入参**（`reconcileCancelled(runtime)`，由已经守卫过的调用点交出）。
  ② 同一条 tick 里 `hostRuntime` 被读了三次（`claimAndDispatch` / `interrupt` / 解构），
  而它是模块级 `let`、由 `bootRuntime` 赋值 —— 跨 `await` 之后检查器不再相信上面那句守卫。
  改成一次 tick 读一次进局部（`const runtime = hostRuntime; if (!runtime) return;`），
  守卫的作用域就写实了。这不是多余判据：**「读一次」与「信三次」在崩溃形态上是两件事**。

  **顺带抓到同文件内两处判据不一致**（这类只有在把类型指实时才会现形）：
  `catch (err)` 之后 `err?.message ?? err` 那一句 —— 同一个文件里另一处 catch
  （`claim-tick 异常`）用的正是 `err instanceof Error ? err.message : String(err)`。
  `err` 是 `unknown`，`err?.message` 在类型上**根本不存在**（`TS2339`），
  而不是「运行时会给 message」；按已有那一条补齐，话术一字未改。

  `HostRuntime` 这个 typedef **刻意只写本文件用到的四件**，其中 `hostRepo` / `cliProcs`
  留 `any`：真正产生它们的 `src/lib/comfyui/host-runtime.ts` 是**动态 import**
  （构建期走预编译 bundle、开发期经 tsx），从这一侧拿不到它的导出类型 ——
  写得更细就是**编一份**（与批 4 那张假 `@returns` 同一族、方向相反：那里声明比实现少，
  这里若写细就是声明比实现多）。这一条取舍写在 typedef 的注释里，不留给下一个人猜。

  凭据（**这些用例是真起这个进程**，不是 mock）：
  ① `tests/executor-host.test.ts` + `tests/executor-host-spawn.test.ts` +
  `tests/executor-host-artifact.test.ts` 串行复跑 = **3 份文件 / 33 条全绿**，其中被本次改动
  直接碰到的三条是：`--claim-once` 领走恰好一行 host 行（走 `claimTickOnce` → `reconcileCancelled`
  这条链）、「库不可达 → 注入链失败 → exit 1 + 日志行，不退化成心跳假活」（失败路径），
  以及「在 `.next/standalone` 内跑 `executor-host --once`：exit 0 且注入链完成」（产物侧）；
  ② `node --check` 通过、`pnpm exec eslint` 对该文件零输出；
  ③ 棘轮 `--update` 后复算 = 面 214 / 存量 **66** / **9** 份 —— 本批零新格，
  没有借 `--update` 登记任何新增。
