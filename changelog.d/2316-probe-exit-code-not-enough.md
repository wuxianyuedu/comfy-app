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
  - **CI 第一跑的读数与修法**（`cnb-ugs-1k5ooa6la`，红在「受影响用例」一格）：上面那句
    「探不到时打一行读数」写的是 `console.log`，而 `tests/single-logger-channel.test.ts`
    判的正是「除日志门面外，服务端库代码里没有直接写 console」—— 新增的
    `src/lib/process/probe-exe.ts` 当场被点名（`expected [ 'src/lib/process/probe-exe.ts' ] to deeply equal []`）。
    错不在那条判据：`console` 绕开 pino 的 redact 与 ERROR 镜像，这行读数本该走唯一通道。
    改成 `logger.warn(...)`（`~/lib/core/logger`，它**刻意不带** `server-only`，
    所以第三类登记的纯 Node 宿主那一侧不被说反）；`probe-exe.test.ts` 的断言随之从
    「拦 console」改成「拦 logger」—— 拦 console 在实现改走 logger 之后会**静默收到空**，
    那样红出来的会是一句指向不到真因的断言。
  - **CI 第二跑的读数与修法**（`cnb-8a8-1k5op440e`，仍红在「受影响用例」一格）：上一轮换成
    `logger.warn` 之后，`tests/host-ts-loads-in-node.test.ts` 当场红 ——
    `src/lib/process/probe-exe.ts` 在真 Node 里 `ERR_MODULE_NOT_FOUND: Cannot find package '~'`。
    根因不是 pino 缺 `server-only`（它确实没带），而是**加载形态**：本模块要被
    `scripts/python-probe.mjs` 与平台侧 `node scripts/e2e-run.mjs` 直接 `import`，那一跳没有
    `~` 别名解析器 —— 静态 import 写下一行日志的代价，是把整条链拖崩在**加载期**。
    两条约束（「`lib` 里不许自己 `console`」与「真 Node 里必须加载得起来」）只剩一种同时成立的
    形状：**本模块连日志通道都不碰**。读数改为注入 —— `FirstRunnableOptions.report`
    （缺省不写），`lib` 只负责说清「哪个候选、什么原因」，往哪写由宿主决定：
    `tests/check-file-structure.test.ts` 那两处 `process.stdout.write` 写出去（跑用例的人
    要的是终端上那一眼），`.mjs` 宿主按自己的出口来。中间试过的两条弯路都留着当反例：
    「拿不到通道就 `console.warn` 兜底」被 `single-logger-channel` 当场判红（那就是第二套
    日志实现），「`logger.warn` 与 `report` 双出口并存」让真 Node 那一跳照旧崩在加载期 ——
    一条静态 import 就足够把整条链拖死，这与它同时被注入多少个出口无关。
    探测结论与「这行字落不落得下去」由此解耦，加载期少了一条能把它拖崩的边。
