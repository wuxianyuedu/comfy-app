## Fixed

- **`preflight-python.mjs` 第二次问 PATH 要绝对路径时没带探针参数 —— 那一格此前能过
  靠的是 `whichCommand` 的记忆化，不是判据**（ISSUE #1961，接在 `resolvePython`
  那一笔之后）。

  `e2e/support/preflight-python.mjs` 在判定「这档要用的 Python 在不在」时会**问两次
  PATH**：第一次由 `resolvePython()` 挑出候选，第二次再解析它的**绝对路径**（应用侧
  `spawn(COMFY_CLI_PYTHON)`，Windows 上 Node 不认 PATHEXT，裸名字必然 ENOENT）。
  第二次那一问此前用的是 `whichCommand` 的缺省 `probeArgs: ["--version"]` ——
  而 `py` 启动器的可用判据是 `py -3 --version`（裸 `py --version` 是「列出已装版本」
  并退非零）。

  它**当时没红**，靠的是 `whichCommand` 的记忆化键**不含 `probeArgs`**：第一次探
  `py` 时已按 `-3` 缓存了结论，第二次读到的是同一条。换句话说这是**巧合不是判据** ——
  换个调用顺序（先解析绝对路径、或第一次命中别的候选）它就会按裸 `py` 判死、退回
  那条「PATH 上解析不到绝对路径」的话术。现在第二次也带上同一组
  `[...found.args, "--version"]`（`found.args` 就是那组宿主参数）。

## Added

- **`tests/e2e-python-preflight.test.ts` 钉住「第二次也带 `-3`」**（同一 ISSUE）：
  记下注入的 `which` 真收到的 `probeArgs`，断言它是 `["-3", "--version"]`。
  反向复算：把那一行去掉，判据当场点名（实测 `Tests 1 failed | 11 passed`）。

- **规范 13 §13.5.3.5 的失败形态表补「第六类」**：同一个「这台机器上有 X 吗」的问题
  被两条链各答一次时，除了问「两条链的**解析规则**是不是同一个」（第五类），还要问
  **「喂进去的判据参数是不是同一组」**；而同一个真因可能有**两个落点**（这里就是
  探测参数 + 第二次解析），修一处不够。再有第二处解析时，还要问它**靠的是判据还是
  缓存** —— 靠缓存过的那一格，换个调用顺序就会红。
