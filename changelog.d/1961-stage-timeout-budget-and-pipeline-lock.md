## Fixed

- **自托管节点上「stage 卡死要等满 2 小时」不再发生：四个真花钱的 stage 带上超时预算**
  （ISSUE #1961）。平台对每个 Job 的默认上限是 **2 小时**（无输出超时 10 分钟），而本档
  此前**一个 stage 都没声明 `timeout`** —— 于是 `ESLint 零警告` 与 `单元测试` 各有跑次挂在
  **8640s（2h24m）** 才被掐断，留下的只有一句 `timeout of 8640000ms exceeded`，
  **一条失败原因都读不到**。而这两步在别的跑次上是 114s / 256s / 827s —— 差两个数量级，
  说明不是变慢，是这台机被压死、它根本没在算。

  现在 `ESLint 零警告` 给 `20m`、`单元测试` `45m`、`生产构建` `30m`、`E2E 关键流程` `30m`
  （各自按实测读数取量级余量）。其余 stage 是秒级的 `node scripts/check-*.cjs` 一族，
  **刻意不给** —— 「所有 stage 都要有预算」那种规则本身就会长成一张没人看的名单。

- **同分支上并发只留一条流水线：流水线级 `lock.cancel-in-progress`**（同一 ISSUE）。
  自托管只有**一台**节点，而一次 PR 上连着推几个提交，每个 `pull_request` 事件都起一条
  **全量**流水线、全落到同一台机上（实测三条并行、三条一起冻结）。被压死的那一条拿不到
  CPU，**既不推进也不报错**。现在同分支上新一跑终止旧一跑（key 默认 `分支名-流水线名`），
  不同分支互不影响 —— 被终止的那条对应的修订号已经不在分支上了。

## Added

- **上面两条现在有执行者**（同一 ISSUE）：`tests/no-platform-ci-config.test.ts` 新增
  `stageTimeouts()` 与 `hasPipelineLockCancelInProgress()` 两条判据，逐条带反向复算
  （把 `lock` 那两行去掉、或把四个 `timeout` 去掉，判据当场点名）。判据还判**量级** ——
  写成 `2h` 与平台默认同值等于没写、写成 `1m` 会误杀真跑得完的形态。

- **`resolvePython` 探 `py` 时用的是裸 `py --version` —— 于是它在有 Python 的机器上答「没有」**
  （同一 ISSUE，平台侧实测）。`E2E 关键流程` 在新一跑上的红已经不是加载期那个了，换成了
  一句**错的**判决：

      [e2e] ✗ PATH 上没有可用的 Python（试过 python / py / python3）

  而**同一次构建里**第一步的「工具链自证」与「Python 可用性」都是 597ms 绿、`单元测试`
  照常跑完（相关用例走 `env` 档跳过，全量档因此是 `38 skipped` 而不是本机的 24）。

  真因：`resolvePython` 调 `whichCommand(name, { probeArgs: ["--version"] })` ——
  **硬编码的 `["--version"]`**，绕过了本模块自己的 `pythonProbeArgs`（它存在的唯一理由
  就是给 `py` 补 `-3`）。裸 `py --version` 是「列出已装版本」并退非零，于是 `py` 在
  `whichCommand` 里被**当成不可用跳过** —— 而 `resolvePython` 却在 `return` 里写着
  `args: ["-3"]`：它知道 `-3`，但只用在「选中之后怎么起它」，管不了「选不选得中」。

  这与 #1959 第二轮「两处各探一次、各判一次没有」是**同一个病**：同一台机器上两条探针
  互相矛盾。修法是让探针参数也走 `pythonProbeArgs(name, ["--version"])` —— 一份事实源。

  **判据**（`src/lib/process/python-resolve.test.ts`）：上一版的用例为什么没照出来 ——
  那个注入探针只看**文件名**、把 `args` 整个丢掉，所以「选中了 py」这一条恒真。新增的
  那条**记下真收到了什么参数**，并让探针「只有带 `-3` 才答起得来」，于是它判的正是
  `whichCommand` 眼里 `py` 到底可不可用。反向复算：把 `probeArgs` 改回硬编码，判据当场点名。
