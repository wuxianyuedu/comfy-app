## Fixed

- **`{ ...process.env }` 的复制品在 Windows 上拿不到 `PATH` —— E2E 因此判「这台机没有 Python」**
  （ISSUE #1961，平台侧 `cnb-5fd-1k50s26f3` 的最后一格）。

  这一跑是**第一次**跑到最后一个 stage（前 30 个全绿：`工具链自证` 2.1s、
  `Python 可用性` 718ms、`Python 探针读数` 991ms、`单元测试` 723s、`生产构建` 69s）。
  而 `E2E 关键流程` 在 **710ms** 退 1，报的还是那句
  「PATH 上没有可用的 Python（试过 python / py / python3）」。

  **决定性读数来自同一次构建里的 `Python 探针读数`**（那一步就是为这轮定位加的）：

  ```
  ok   python --version  →  Python 3.12.10
  resolvePython（手工扫 PATH × PATHEXT）:
  ok   python   →  D:\Program Files\Python312\python.exe
  ```

  **两条链都找得到** —— 而 `E2E 关键流程` 报「没有」。差的不是「这台机有没有 Python」，
  是**读的是哪一份 env**（同批 `c42b15f3` 给了另一条同样成立的线索：探针在满载机上
  `ETIMEDOUT` 被读成「命令不存在」—— 两条各自独立，且都不与对方互斥）：

  - `python-probe.mjs` 调 `resolvePython({})` ⇒ 默认读 `process.env` —— Windows 上它是
    一个**大小写不敏感**的代理，`env.PATH` 拿得到；
  - `e2e-run.mjs` 调 `checkPythonReady({ env })`，而那个 `env` 是 `{ ...process.env }`
    —— **普通对象**，键名按系统存的写法来（Windows 常把 `PATH` 存成 `Path`）。
    于是 `env.PATH === undefined` ⇒ `whichCommand` 扫一个**空 PATH** ⇒ 判「没有」。

  修法：新增 `envVar(env, name, platform)`（`src/lib/process/executable-resolve.ts`），
  `whichCommand` / `executableExts` / `powershellHost` 三处读 `PATH` / `PATHEXT` 都走它。
  **大小写不敏感只按目标平台**（不是宿主 `process.platform`）—— 判据跑在 POSIX 上、
  判的是 win32 形态，读宿主会让那条判据只在 POSIX 上自证。POSIX 上行为一字未改
  （那边 `Path` 与 `PATH` 本来就是两个变量）。

  同批：`checkPythonReady` 的缺件话术里加**两条链各自的结论**（裸名字起不起得来 +
  `env` 里 PATH 有几条、键写成什么）。这一格之所以能定位，靠的正是「把读数摆出来」，
  所以把它也放进失败话术里 —— 下一次同类问题不必再多跑一轮。

- **判据**（`src/lib/process/executable-resolve.test.ts`）：新增一组 ——
  win32 上键写成 `Path` 时也找得到（复制品的形态）、键写成 `PATH` 时同样找得到（对照组）、
  POSIX 上 `Path` **不算** `PATH`（这一层不改 POSIX 行为）。
  反向复算：把 `envVar` 摘回 `env[name]`，第一条当场红。
