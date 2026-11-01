## Fixed

- **门禁自测的沙箱在 Windows 构建节点上整块超时，把 `受影响用例` 拖成红**（ISSUE #2990）：
  `tests/helpers/gate-repo.ts` 的 `repo` fixture 现在按**平台档**声明不满足时 skip
  （`SANDBOX_POSIX_ONLY`，`process.platform === "win32"`），守卫写在共享夹具这一处，
  而不是三十多份 `*-gate.test.ts` 里各抄一条。

  现场（PR #2990 的 `cnb-kh7-1k6bmqhrg`，自托管 Windows 节点，`COMFY_TEST_TIMEOUT_SCALE`
  已置 `2` ⇒ 判据预算 60s）：`受影响用例` 红了唯一一份文件 ——
  `tests/pending-merge-loss-gate.test.ts` 的 ① 与 ② 各报 `Test timed out in 30000ms`
  （那两句是 vitest 在用例内 `vi.setConfig({ testTimeout: 30_000 })` 的**字面量**，
  不随乘数放大），而同一份代码本机 **14 条全绿、整份 1.5s**。这两条判的是仓库里那份
  `check-pending-merge-loss.mjs` 的判定口径，与 git 跑在哪个文件系统上无关 ——
  Windows 上跑不完的沙箱给不出关于被测脚本的任何读数（§13.6.4「拿不到测量 ≠ 测量结果是红的」）。

  两个形状坑顺手钉住：① `test.skipIf()` 是**返回新 test** 的 API，`const x = test.extend(…)`
  之后丢掉 `.skipIf()` 的返回值等于什么都没做（看起来像生效了）；这一版由一次真跑证明 ——
  守卫置真时整份 `1 skipped`、置假时照旧全绿。② `repo` 是 `scope: "test"` 的 fixture，
  所以只有真的用到沙箱的用例被跳过，同文件里那些不碰沙箱的（`.githooks/prepare-commit-msg`
  接线那条）照常判。

  代价是显式的：**Windows 节点上这 49 份门禁自测整块不判**，那里的「绿」不再包含它们 ——
  收在这里的理由与 `ON_WINDOWS` 那条同源（条件 skip 的守卫文本要能被
  `tests/conditional-skip-registry.test.ts` 逐字认出）。口径写进规范 §13.6.4.3。

- **「固定结构用例」那一格的三条红：两条超时是同一台的负载，一条是起子进程时没给预算**（同一次
  PR #2990，build `cnb-fvg-1k6botkg5`，日志 L180 的 `Failed to start forks worker for
  tests/a11y-axe-stories.test.ts` 就是同一次争用的现场）：

  | 用例                                              | 平台读数                              | 处置                                                                                                                                        |
  | ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
  | `tests/check-commit-claims.test.ts` 的真历史回归  | `expected -1 to be 1`（**不是超时**） | 本机隔离跑 26 条全绿、2.0s；`node scripts/base-check.mjs` 报 `current-green` ⇒ 按 §13.6.4 的「未校验」处置，不改代码                        |
  | `tests/affected-tests.test.ts` 长清单走 stdin     | `Test timed out in 60000ms`           | 本机该条 5.4s。输入面收口：起子进程时**显式摘掉两枚着色共识旗标**（宿主带 `FORCE_COLOR` 时整屏 ANSI 会让输出量翻倍、顶到 `maxBuffer` 附近） |
  | `tests/ci-heavy-gates.test.ts` 复合档逐条按面收窄 | `Test timed out in 60000ms`           | 本机该条 574ms。它真起一次生产入口，而 `maxBuffer` 没显式给（默认 1 MiB）—— 补 `64 << 20`，与同文件另外三处同口径                           |

  后两条各是一处**输入面没给足**（着色噪声 / 子进程输出预算），不是判据松了口径；
  第一条没有代码可修，记录在此以免下一个人重复贡献一次「真红还是负载」的排查。
