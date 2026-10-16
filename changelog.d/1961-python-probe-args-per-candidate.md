## Added

- **`python-probe.mjs` 现在把「两条链」的结论并列打出来，并挂在流水线最便宜的位置**
  （ISSUE #1961）。起因是一次**两条链给出相反结论**的现场（`cnb-g36-1k50hvu52`）：

  ```
  Python 可用性   ✅ 697ms   （findPython：起裸名字，Windows 交给 CreateProcess 解析 PATH）
  E2E 关键流程    ❌ 703ms   （resolvePython：手工扫 PATH × PATHEXT，再对绝对路径起一次）
  [e2e] ✗ PATH 上没有可用的 Python（试过 python / py / python3）
  ```

  只看一边的日志**分不出是哪一边错**，而 E2E 那一步要等十几分钟（前面有 728s 的
  `单元测试` 与 69s 的 `生产构建`）才轮得到。所以：

  - `scripts/python-probe.mjs` 新增「`resolvePython`（手工扫 PATH × PATHEXT）」一节，
    把第二条链的结论与第一条并列打（`resolve` 做成可注入，判据才不会被宿主环境左右）；
  - `.cnb.yml` 新增 `Python 探针读数` 这一步（紧跟 `Python 可用性`，退出码恒为 0、
    **只打印不阻断**），`COMFYAPP_CI_GATES` 同批登记它；
  - `describePythonMissing()` 的出口里加上这条排障命令 —— 它判的是第二条链，
    而人最容易去看的是第一条链的绿。

## Fixed

- **`preflight-python.mjs` 第二次问 PATH 要绝对路径时没带探针参数 —— 那一格此前能过
  靠的是 `whichCommand` 的记忆化，不是判据**（同一 ISSUE，接在 `resolvePython`
  探 `py` 漏 `-3` 那一笔之后）。

  `checkPythonReady()` 会问 PATH **两次**：第一次由 `resolvePython()` 挑出候选，第二次
  再解析它的**绝对路径**（应用侧 `spawn(COMFY_CLI_PYTHON)`，Windows 上 Node 不认
  PATHEXT，裸名字必然 ENOENT）。第二次此前用 `whichCommand` 的缺省
  `probeArgs: ["--version"]`，而 `py` 的可用判据是 `py -3 --version`。

  它**当时没红**，靠的是 `whichCommand` 的记忆化键**不含 `probeArgs`**（第一次探 `py`
  时已按 `-3` 缓存了结论）。那是**巧合不是判据** —— 换个调用顺序就会按裸 `py` 判死、
  退回「PATH 上解析不到绝对路径」那条话术。现在第二次也带上
  `[...found.args, "--version"]`。

  顺带把 `resolvePython` 交回的 `args` 从手写 `name === "py" ? ["-3"] : []` 改成
  `pythonProbeArgs(name)` —— 探测与最终起它同源，不再各写一遍。

- **判据**：`tests/e2e-python-preflight.test.ts` 记下注入的 `which` 真收到的 `probeArgs`，
  断言是 `["-3", "--version"]`（反向复算：去掉那一行当场红，`1 failed | 11 passed`）。

- **规范 §13.5.3.5 失败形态表补「第六类」**：同一个「这台机器上有 X 吗」的问题被两条链
  各答一次时，除了问「两条链的**解析规则**是不是同一个」（第五类），还要问
  **「喂进去的判据参数是不是同一组」**；而同一个真因可能有**两个落点**，修一处不够。
