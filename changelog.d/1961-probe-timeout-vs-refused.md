## Fixed

- **探针把「没等到」读成「没人」——「真件坐在替身端口上」这条判据在负载高时会静默
  放行**（`e2e/global-setup.ts` + `tests/e2e-fake-comfyui-endpoint.test.ts`）。

  CI 第五次首跑红在「单元测试」一步，读数是：

  ```
  FAIL tests/e2e-fake-comfyui-endpoint.test.ts > 替身形状 ⇒ fake；真件形状 ⇒ real
  AssertionError: expected 'free' to be 'real'
  ```

  `probeFakeComfySlot` 把 `status: 0` **同时**用于「连接被拒」与「预算耗尽」（超时），
  而 `classifyFakeSlot` 把 `status: 0` 判成 `free` —— 于是端口上**明明坐着服务**，
  探针只因为没在 1500ms 内拿到应答就答「没人」。

  **这一格的代价不对称**：`free` 会让 `assertFakeSlotFree()` 放行，而「真件坐在替身
  端口上」那一格本意是要**当场阻断**的（见该文件头「修复取向」）—— 判成 `free`
  等于把那条判据在负载高的时候关掉，而且**不报错**。

  本机复现（不是推演）：8 核机上把 CPU 占满，对一台**已监听**的临时服务探一次，
  拿到 `status 0 / The operation was aborted due to timeout`，判 `free`。

  修法按 `err.cause.code` 分岔，**不是**抬高那个 1500ms —— 抬它只会让真挂死晚一点
  被看见，而静默放行那半边一字未变：

  - 只有 `ECONNREFUSED` / `ENOTFOUND` / `EHOSTUNREACH` / `ENETUNREACH` 才是
    「空着」⇒ `status: 0` ⇒ `free`；
  - 预算耗尽（`TimeoutError`）与**认不出的失败**都归 `status: -1` ⇒ `unknown`
    （判据拦下，并说清是「没在预算内拿到应答」而不是「端口上有人」）。

  顺带照出一条被这层同形掩盖的差异：`http://127.0.0.1:1/` 在 undici 那里报的是
  `bad port`（`cause` 上**没有** `ECONNREFUSED`），旧用例拿它验「端口空着」，
  验的其实是「端口号非法」。改成拿一个**刚关闭的真端口**。

- **`installPython` 的注入面按结构补全：`scoop` 通道绕过了 `findExe` 直取模块实现**
  （`scripts/ci-toolchain-python.mjs` + `tests/ci-toolchain-selfcheck.test.ts`）。

  三条通道的注入面此前是按「用例传了什么」攒出来的，于是 `viaScoop` 一边收着注入的
  `findExe`、一边用**模块内**的 `findExeUnder` 去读真 fs —— 那个注入面管不到它，
  「scoop 报成功但找不到解释器」这条结论于是会随宿主上碰巧有没有 Python 而变。

  补的是**两层查找各自的注入面**（这不是同一个东西）：`findExe` 回答「这台机器上
  有没有」（扫全部安装根），`findExeUnder` 回答「这个目录下有没有」（`scoop` 通道
  按落点逐个问）。`listDirs` / `existing` 一并透传，通道壳不再直取模块级实现。

  判据按**源码结构**判而不是按用例数它传没传（后者要维护一张会过期的名单）：
  「每个会伸出去的边界都在注入面上」+「通道内部不许出现模块级实现的直呼」+
  「Windows 分支的每个调用点都带 `noExternalAction()`」。
  **只判 Windows 分支** —— POSIX 那条只经 `run` 起包管理器，没有网络与解压那两截，
  只注入 `run` 在那里是真的够，判它等于误报。

  反向复算：把 `viaScoop` 的 `findExe(root)` 还原成 `findExeUnder(root)`，判据当场
  点名「viaScoop 又直接调了模块级的 findExeUnder（读真 fs）：注入面形同虚设」。
