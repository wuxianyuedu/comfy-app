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
  - 顺带的一格：`scripts/python-probe.mjs` 的「手工扫 PATH」那一节原先只打一句
    「扫不到 / 起不来」，现在带上逐候选的失败形态（`findPython()` 的 `missed`）——
    那个脚本存在的意义正是「两条链的读数摆在一起分得出是哪一边错」，而分不出
    「压根没有」与「有同名冒牌」就等于没分。
