## Changed

- **平台 / 宿主依赖改用 vitest 5 的 `test.extend` fixture 表达（ISSUE #1485，第四件）**：新增 `tests/helpers/platform-fixtures.ts`，把「这条用例依赖什么环境」从**包装函数 + 裸全局读**变成**用例签名里的入参**；三个文件按它收口，顺带照出并修掉一条判据的静默盲区。
  - 新增 fixture 层（`AsPlatform` / `OnWindows` / `MakeHost`）与共享守卫常量 `ON_WINDOWS`。`asPlatform` 的收尾挂在 `use` 之后 —— 用例中途 throw 也照样恢复，这是它相对手写 `try/finally` 的实质收益。
  - `src/lib/process/kill-process-tree.windows.test.ts`：删掉手写的 `withWindows()` + `try/finally`（每个文件各抄一份、且是过程式的），三条用例改成 `platformTest(..., { asPlatform })`；两条真起 shebang 脚本的用例改成 `platformTest.skipIf(ON_WINDOWS)`（守卫取共享常量而不是散写裸表达式）。
  - `src/lib/process/kill-process-tree.posix.test.ts`：删掉手写的 `withLinux()` 与 `afterEach` 里的手动回滚，13 处调用点改成 `asPlatform("linux")`。
  - `src/lib/process/executable-resolve.test.ts`：删掉本文件自带的 `posixHost()`（与另一处同形），6 处改用 `makeHost`。
  - `src/lib/process/kill-process-tree.test.ts`：两处 `describe.runIf(!isWindowsPlatform())` 换成局部 `const posixOnly = isWindowsPlatform() ? describe.skip : describe`，并把「为什么这一组**只能**留在真 POSIX 机器上」写进注释（它们问的是「`ps` 报什么」与「真信号带不带走整棵树」，没有注入形态；决策面那一半已在 `kill-process-tree.posix.test.ts` 用注入的 `ps` 表判过）。

- **顺带照出并修掉一条判据的静默盲区**：`tests/conditional-skip-registry.test.ts` 的站点扫描原来把标识符写成白名单 `(?:it|test|describe)\.skip` —— 于是**从 `test.extend` 派生出来的 test 对象**（`platformTest`）上的 `skipIf` 站点**整片漏出扫描面**。表现不是「这里红」，而是「一条静默不跑的用例没人登记」（比红更糟）。标识符放宽成 `\w+`，并在「三种站点形状都要被扫出来」那条里补上**第四条执行者**（点名 `ON_WINDOWS` × 2）—— 改了扫描口径就要同批补它的执行者，否则放宽与收窄都无人判。
  - 同步更新登记表那一条的 `guard` 与 `why`（守卫从裸表达式换成共享常量，档位与理由同源）。

- **fixture 自己的收尾有执行者**：`tests/helpers/platform-fixtures.failure.test.ts` 用 `test.fails` 故意抛一条（于是整份套件仍然绿），第二条断言平台已恢复 —— 「恢复逻辑被删掉」会当场红，而不是靠某条永久红被人看见；`tests/helpers/platform-fixtures.test.ts` 钉 fixture 本身的语义（切换生效、可切多段、`onWindows` 是 `realPlatform` 的派生而不看被改过的值、`makeHost` 的名单内外两态）。

- `eslint.config.js`：给 `tests/helpers/**` 关掉 `react-hooks/rules-of-hooks` —— `test.extend` 把回调第二参叫 `use`，规则按名字判 Hook 会逐条误报，而 `use` 是 vitest 的 API、改不得。按**目录**关（不是文件级 disable），别处的 React 规则照旧生效。

- 规范 [11 §11.16](docs/standards/11-测试与可观测性.md) 落地口径（三对照表、四条纪律、与「显式入参优于 fixture」的边界）；`docs/guides/TESTING.md` 补「平台 / 宿主依赖：用 fixture 表达」一节。
