## Fixed

- **脚本档清账批 12：`scripts/build-desktop.mjs` 16 格清零，账从 95 处 / 11 份降到 79 处 / 10 份
  （ISSUE #2589 / 规范 §13.5.14.1）**：**一半以上的账来自同一件小事** ——
  `fail(msg)` 这个「打印错误然后 `process.exit(1)`」的入口没有声明返回类型，
  于是检查器按 `void` 处理，认为 `if (!invocation) { fail(…) }` **之后还会继续走**，
  接下来四句 `invocation.command` / `invocation.args` 全部报 `TS18047`（8 格）。
  补 `@returns {never}` 之后 8 格一次消失。

  这一条值得单独留档，因为它不是「少写注解」而是**语义没写成类型**：
  一个「只会终止、不会返回」的函数如果在类型上表现得像会返回，
  它每一个调用点都要替它再判一次空 —— 而这些判据既不改变行为、又会随调用点数量增长，
  最终没人敢删。**口径：报错即终止的出口一律 `@returns {never}`**
  （`fail` 这一族在本仓有多份实现，本批只改被判到的这一份；其余各份等自己的账被清到再收）。

  其余 8 格：4 格形参（`fail` 的 `msg`、`dirSize(dir)`、`staticAllowed(abs)`、`collectLevel(base)`）、
  2 格是 spawn 层挂在 `Error` 上的 `code`（声明面里没有这个字段，按既有口径收成一次
  `/** @type {NodeJS.ErrnoException} */` 的局部判型，而不是在使用点上写 `as any`）、
  2 格是 `dirSize` 有了参数类型之后**新冒出来的** ——
  **这是「补类型不是纯减法」的第五次现场**（批 1 的 4 格、批 6 的 5 格、批 8 的 1 格、
  批 11 的 3 格之后）：`stack.pop()` 在类型上是 `string | undefined`，
  而 `while (stack.length)` 已经保证取得出 —— 那是我知道的不是类型知道的，
  加一句 `if (cur === undefined) break`（与那句长度判据同一件事的两种写法，不是新增容错）。

  **凭据的边界要说清**（这份文件是「跑一次就是一场桌包构建」的入口，没有 `--help` / 无操作档）：
  ① 读它源码的两份用例串行复跑 = **40 条全绿**（
  `tests/build-desktop-step-readings.test.ts` 7 条 —— 它判的就是「每一步有没有念得出读数」，
  本批动到的正是那几行附近；`tests/dist-artifact-hygiene.test.ts` 33 条）；
  ② `node --check` 通过、`pnpm exec eslint` 对该文件零输出、`pnpm doc:check` 一致；
  ③ 棘轮 `--update` 后复算 = 面 214 / 存量 **79** / **10** 份（零残留新格）；
  ④ **完整桌包构建这一轮没有跑** —— 一次 `node scripts/build-desktop.mjs` 会真起
  `next build` + 壳侧打包并改动产物目录，不属于「顺手能验」的量级。
  它的真机执行者是平台那一条**桌包独立档**（每日 02:00 那一跑），
  所以这一笔的最终验收按既有口径：**认合并之后那一次派发的逐格原值**，不是本地绿灯。
  改动面本身是类型层 + 一句可证等价的守卫，没有触碰任何命令行拼装、白名单或裁剪逻辑。
