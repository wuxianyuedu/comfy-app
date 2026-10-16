## Fixed

- **「工具链自证」与「Python 可用性」两步在自托管 Windows 节点上**双双空转** ——
  守卫拼的 `file://` 串与 `import.meta.url` 恒不相等，`main()` 一次都不跑、
  进程正常退 0 且零输出**（ISSUE #1961 的最后一格：CI 红在 `E2E 关键流程`，
  真因却在第一步）。

  读数是这样的（节点 `cnb-g36-1k50hvu52`）：

  ```
  工具链自证    exit code: 0, duration: 544ms   ← 各自的第一行都没打出来
  Python 可用性 exit code: 0, duration: 597ms
  单元测试      9431 passed | 38 skipped        ← 38 = 缺 Python 的档位
  E2E 关键流程  ❌ PATH 上没有可用的 Python
  ```

  `scripts/ci-toolchain-selfcheck.mjs` 与 `scripts/python-probe.mjs` 用
  ``import.meta.url === `file://${path.resolve(process.argv[1])}` `` 判「自己有没有
  被直接执行」。`import.meta.url` 在 Windows 上是 `file:///F:/…/x.mjs`（三斜杠 +
  正斜杠 + 盘符），而拼出来的是 `file://F:\…\x.mjs`（两斜杠 + 反斜杠）——
  **恒不相等**。于是 `main()` / `pythonOnly()` 一次都不跑，进程**正常退 0**。

  代价不对称：这两处探针的设计意图正是「缺 Python 在**最便宜的位置**报出来」
  （§13.5.3.9 把它们提到了所有慢 stage 之前）。守卫失效之后这个意图**静默地**没了，
  缺件一路滑到 18 分钟后的 E2E，以「执行器收口失败」的功能红暴露 ——
  一件事报成两条，报错不指向真因。**是「这一步没跑」被读成了「这一步过了」。**

  修法：三处改用本仓既有的正确写法 ——
  `path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))`
  （两侧都过 `path.resolve`，两种平台上都成立）。`scripts/db-legacy-sweep.mjs` 的
  直接执行分支是同一形态，一并改掉（它当前只被 import，但留着就是下一个地雷）。

  **同批立判据**：`tests/script-main-guard.test.ts` 按代码行扫 `scripts/**` /
  `tools/**`（剥注释与字符串里的同形文本 —— 本仓另三处的反面教材注释正当地写着这个
  形状），命中「拿拼接的 `file://` 串与 `import.meta.url` 比」即红；并反向钉住三个
  改过的入口确实带着规范化比较。反向复算：把守卫改回拼串，判据当场点名
  （实测 2 failed）。已登记进 `scripts/fixed-structural-tests.mjs` 的固定清单 ——
  新脚本是「新增文件」，静态 import 图追不到它，而那正是这条要守的场景。

  本仓另三处（`check-merge-parents.mjs` / `check-merged-side-loss.mjs` /
  `check-pending-merge-loss.mjs`）早已为这同一形态写过注释，只是没有判据守着 ——
  **靠注释传的约定，下一次新增脚本时必然再犯一次**（这一次就是）。

  **同批的 `Python 探针读数` 那一步（`7045db70` 新增）也因此才真的出得来**：
  它跑的正是 `scripts/python-probe.mjs` —— 同一形态的守卫，同一份静默
  （Windows 上退 0、零输出）。也就是说那一笔"把两条链的结论并列打出来"的意图，
  在它自己想排查的那台机器上**一个字都没打**。
