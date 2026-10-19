## Fixed

- `每日单元测试` 在平台侧又报出两条**只在节点上红**的（本机绿，现场
  `cnb-1d9-1k59h8hsv`：`Test Files 2 failed / 773 passed`）：
- `tests/ci-cp936-exit.test.ts` 四格用裸 `echo` 却没注入解析口 ⇒ 它们的答案取决于
  **跑它的那个进程的 PATH**。CI 那个账号的 PATH 里没有 Git 附带的 `echo.exe` ⇒
  `resolved: false` ⇒ 外壳打「PATH 上找不到这条命令」并退 127，于是
  `toContain("没做成")` 红 —— 而这几格判的是**输出通道**（原样转出 / 转码失败时原文照打 /
  转码成功时不许打两份），从来不是「这台机找不找得到 echo」。补上本文件已有的
  `passthroughResolve`（它的注释就写着「不关心解析的那几条用它，免得去碰真 PATH」），
  「bare 名字要交给解析口」那一判仍由 `pnpm` 那几格判，没有搬走也没有放宽。
- `tests/ci-toolchain-selfcheck.test.ts` 的「片长自适应地退档」成本 =
  停顿片数 × `chunkTimeoutMs`：本机空载 **17.9s**，而每日档带 4 个 worker 并发时
  **40.4s**，全局 `testTimeout` 30s 在第二种场合必红（那句红什么也没说）。
  上一笔已经把 `chunkTimeoutMs` 从 700ms 降到 200ms（**先降成本**，35.4s → 17.9s），
  这一笔把降完之后仍然存在的**并发余量**登记下来：`{ timeout: 120_000 }`，
  依据就是上面那两个实测数（与 `tests/check-a11y-rules.test.ts` 的
  `CONFIG_BUDGET` / `CLI_BUDGET` 同一处置；§11.13 禁的是拿预算换绿，这里是先降后登记）。
