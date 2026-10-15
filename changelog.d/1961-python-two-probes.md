## Fixed

- **「Python 在不在」的两条探针看的不是同一个世界**（ISSUE #1961 平台侧第八跑）：
  上一笔把 `resolvePython` 探 `py` 缺 `-3` 那格修掉之后，`E2E 关键流程` 的读数
  **一模一样**——仍是 `[e2e] ✗ PATH 上没有可用的 Python（试过 python / py / python3）`，
  而**同一跑**里 `Python 可用性` 是 success。说明那是两个并存的成因。

  第二个成因：两个 stage 用的探针不是同一个。自证那侧 `findPython` 走
  `spawnSync("<裸名字>")` —— 交给 OS 解析，**看得到** Windows 的应用执行别名与注册表
  `App Paths`；E2E 那侧 `whichCommand` 是本仓自己写的「PATH × PATHEXT 逐目录扫文件 +
  `fs.accessSync(X_OK)`」，**看不到**那两个机制。而 `python.exe` 在 Windows 上常常**只**
  经前两条被认得 —— 于是同一台机器上自证答「有」、E2E 答「没有」，两份都说得通，
  人看到的是「上一步说我装好了、下一步说我没有」，且红在整条流水线的**最后一个** stage。

  处置：`resolvePython` 补**第二层** —— PATH 上一个都扫不到时，拿裸名字**再问 OS 一次**
  （`bareSpawn`，注入口与 `probe` 同族）。这一层返回的 `path` 是**裸名字**而非绝对路径
  （别名与 `App Paths` 不是盘上的固定落点，扫盘扫不出来，只有 CreateProcess 答得了）；
  要绝对路径的调用方仍走第一层。它让「这个命令在这台机器上起得来」只有一个答案（§12.18）。

  判据两向都钉（`tests/python-probe.test.ts`）：`bareSpawn` 答「起得来」时判「有」、
  答 `ENOENT` 时判 `null`；外加**反穿透** —— 注入 `probe` 就是「在模拟这台机器」，
  第二层必须整条让开。第 ③ 条是判据自己踩出来的：第二层接上后
  `e2e-fake-comfyui-executor-env` 两条「PATH 上一个都没有 ⇒ null」在 Linux 上当场翻红
  （宿主真有 `python3`）——判据被自己的宿主环境污染，会在别的机器上给出不一样的结论。

  规范 13 §13.5.3.10 补「同族的第二个面」一节（含两条探针的判据面并排表）。
