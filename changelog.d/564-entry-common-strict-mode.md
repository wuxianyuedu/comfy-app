## Fixed

- **双击 `run-local.ps1` 在打开逻辑脚本之前就报错，且报的是一个内部变量名（ISSUE #564）**。
  现象：双击入口（`run-local.ps1` / `verify-quality.ps1` / `run-tests.ps1` /
  `generate-docs.ps1` / `sync-lint.ps1` / `register-comfyapp-protocol.ps1` …）弹出

  ```
  Invoke-Entry: …\tools\start\run-local.ps1:32
  无法检索变量 '$NodeScript'，因为尚未设置该变量。
  ```

  成因：入口公共库 `scripts/entry-common.ps1` 的 `Invoke-Entry` 里有一处
  `if ($NodeScript) { … }`，而 `$NodeScript` 只是注释块里的一个 `.PARAMETER` 说明
  ——**从未进过 `param()` 参数表，也从未被任何入口传过**。本库顶部是
  `Set-StrictMode -Version Latest`，这一档会把「引用不存在的变量」从 `$null` 升级成
  **终止性错误**；而这条判断在主路径上，于是**每一个**走 `Invoke-Entry` 的双击入口
  都在调起逻辑脚本之前就炸掉（用户看到的是英文函数名 + 内部变量名，看不出该做什么）。

  它躲过了所有门禁：`.ps1` 引用未声明变量**在解析期不报错**，只有执行到那一行才炸；
  `pnpm lint` / `tsc` / 文件结构门禁都读不到它。

  修法：删掉这条从未接线的分支与配套的 `Invoke-NodeEntry`。本库只认 PowerShell
  逻辑脚本，要调 `.mjs`（如启动编排器 `scripts/dev-launcher.mjs`）的入口各自做薄壳
  （`scripts/dev-launcher.ps1` 就是参考形态）——在 `param()` 之外新增一个没人传的
  开关，只会再养出一个同类地雷。库头注释补上「为什么不在这里加 `.mjs` 支持」。

  回归测试 `tests/entry-common-strict-mode.test.ts`：静态核「`param()` 声明的变量
  覆盖函数体引用的每一个变量」（反向验证：还原旧文件即失败），并在有 PowerShell 的
  环境里**真跑**一次 `Invoke-Entry`，断言它走到自己的「未找到逻辑脚本」出口，而不是
  被 StrictMode 终止。规范同步：`launch-and-build.md` §5 症状表、§8.4 新增第 5 条
  「碰 `entry-common.ps1` 时遵守 StrictMode」、§8.5 排障表。
