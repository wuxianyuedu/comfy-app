## Fixed

- **「这台机器上有没有某个工具」的探测不再只认退出码 —— 起不来 / 起不来但退非零都不算在场，
  每个候选探完必须说得出「哪一个、什么原因」**（ISSUE #2316）。现场：非 Windows 机器上一旦
  能 spawn 出一个叫 `powershell` / `pwsh` 的东西（发行版附带的 shell 别名之类）而它根本不是
  PowerShell，`tests/check-file-structure.test.ts` 的 `Build-Guard.ps1` 那一组不再跳过，转以
  `Test timed out in 20000ms` 失败、连带「受影响用例」整格转红；同一份种子在另一台 Linux 上
  整组 skipped —— **判定「这一格能不能判」的那一步，在两台机器上给出相反结论**。
  - 根因：探测只认 `execFileSync` 抛没抛错。判据要的是「起得来**且**解释得了参数」两件，
    而冒牌同名文件退 0 就被认成 PowerShell，真跑那一条 `spawnSync(candidate, ["-NoProfile", …])`
    起来却退 2 ⇒ 守卫脚本的 `HITS=` 一个都不出现 ⇒ `toContain` 等满 20s 才抛超时，
    报错行指向「超时」而指不到「进程根本不是 PowerShell」。
  - 判据收成**一处**：新增叶子模块 `src/lib/process/probe-exe.ts`（`node:child_process` 一个
    依赖，§18.4 第三类登记），`probeExecutable()` 把一次探测的三种结局分开答 ——
    `spawn-error`（起不来）、`nonzero-exit`（起来了但退非零 / 被信号结束）、`timeout`
    （没在预算内给出读数，属「没量到」而不是「起不来」，§13.6.4 那条口径）；
    `firstRunnable()` 依次探候选并**留下每个候选的失败形态**，`describeProbeMisses()`
    把「哪一个候选、什么原因」一次说出来。
  - 两处调用点同批换成它（`powershell` 与 `python` 是同一形态，单收 `python` 那一半等于下一台
    机器再红一次）：探测与真跑用**同一条参数形态**，且探不到时打一行读数 ——
    否则下一次只看到一片 `skipped`，说不出「安静地跳过了」还是「安静地判错了」。
  - 反向的机器判据：`.githooks/pre-commit` 的 D 组新增
    `scripts/check-skip-probe-readings.mjs`（**纯文本、零子进程、<0.1s**）——
    有 `firstRunnable(` 站点却没有 `describeProbeMisses(` 即红；零站点时它自己报「空转」
    （读不到输入 ≠ 没有问题）。登记进 `scripts/.declaration-readers.json` 的
    「声明 ⇄ 读者」索引（读者 / 执行者双向核）。
  - 钩子那一格另有它的清单读者面：`docs/standards/13-提交与-code-review.md` 的 §13.1
    命令清单同批补上这一步 —— 那份清单是「手跑全套」的唯一入口，漏一格 = 照着清单跑的人
    以为它不存在（`pnpm doc:check` 双向核）。
  - 顺带的一格：`scripts/python-probe.mjs` 的「手工扫 PATH」那一节原先只打一句
    「扫不到 / 起不来」，现在带上逐候选的失败形态（`findPython()` 的 `missed`）——
    那个脚本存在的意义正是「两条链的读数摆在一起分得出是哪一边错」，而分不出
    「压根没有」与「有同名冒牌」就等于没分。

  - 合并主干之后的读数（`a95426c1` 把 `origin/master` 并进来，两边都改过这处探测）：
    留**地基那一份**（`probe-exe.ts`），master 侧那个文件内夹具删掉 —— 同一条判据不该有
    第二份实现（§12.18），而这份地基的另外两个消费方已经在用它；「探不到时打逐候选读数」
    也随之收进 `firstRunnableOrEmpty()`，两处调用点各写成一行。
  - **「那一行读数往哪写」踩了两脚，两次都红在平台侧**（同一条判据的两头）：
    - 第一跑（`cnb-ugs-1k5ooa6la`）红在 `tests/single-logger-channel.test.ts`：
      「探不到时打一行读数」写的是裸 `console.log`，而那条判据判的是「除日志门面外，
      服务端库代码里没有直接写 console」—— `probe-exe.ts` 当场被点名。判据是对的：
      `console` 绕开 pino 的 redact 与 ERROR 镜像（规范 07 §7.18.2.1）。
    - 第二跑（`cnb-8a8-1k5op440e`）换成 `logger.warn(...)` 之后红在
      `tests/host-ts-loads-in-node.test.ts`：本模块是 `.mjs` 宿主**直接加载**的跨宿主
      地基层，裸 Node 只认相对说明符 —— 那行 `~/lib/core/logger` 让加载期报
      `ERR_MODULE_NOT_FOUND: Cannot find package '~'`，E2E 崩在起跑线上。
    - 两条判据不打架，同时满足的形状只有一个：**本模块一个日志实现都不 import**，
      出口由宿主注入（`elevateLogLevel()`，返回还原函数）。应用侧
      `process-launch.ts` 在加载时把它接到 `~/lib/core/logger`（服务端可达的那条路上
      仍然只有一条通道），裸 Node 宿主与用例各注入自己的收集器；没注入时缺省**空转**
      而不是 `console` —— 后者等于留一条绕过脱敏的后门。`probe-exe.test.ts` 的断言也跟着
      从「拦 `console` / 拦 `logger`」改成「注入收集器」：出口可换之后，前两种拦法都会
      **静默收到空**，红出来的会是一句指不到真因的断言。
