## Fixed

- 发布构建的三个双击入口把「外部命令压根没起来」记成**执行成功**，然后照常打印「全部完成 /
  可双击 app.exe」，而那个 exe 并不存在（ISSUE #1350）。判决来自共享内核
  `tools/scripts/Log-Common.ps1` 的 `Invoke-Logged()`：`& $sb` 解析不到命令时 PowerShell 只发
  一条非终止错误、**不写 `$LASTEXITCODE`**，于是内核读回来的是**上一次成功调用留下的 0**。
  实测两层：内核层（pwsh 7，真 dot-source 跑）成功之后紧接一条不存在的命令 ⇒
  `LAST_INVOKE_CODE=0`；语言层 `$global:LASTEXITCODE = 0` 后跑一条起不来的命令，
  **pwsh 7 与 powershell 5.1 都还是 0**。三个读者全在发布路径上：
  `build-standalone.ps1:57`（`pnpm tauri build`）、`build-tauri-release.ps1:127`（`cargo build`）、
  `rebuild-static.ps1:26`（`node scripts/build-desktop.mjs`）—— 也就是「这台机器没装 cargo」
  这种最普通的现场，会产出一句成功。
- `Invoke-Logged` 现在三态分开：跑成给 0、跑了且失败给**真码**、**命令没起来给 127** 并打
  `[CMD-NOTFOUND]`（ASCII 标签的理由同 #1345 的 `[GATE-NOEXEC]`：5.1 管道按 GBK 解码）。
  做法是调用前先 `Get-Command` 解析命令名（带引号的路径也认）、解析不到就当场定性，调用前
  `$global:LASTEXITCODE = $null`、调用后仍为 `$null` 同样判 127，并给 `&` 套 try/catch 兜住
  「解析通过但仍起不来」。
- 顺手删掉 `ForEach-Object` 循环体内那次 `$script:LAST_INVOKE_CODE = $LASTEXITCODE`：子进程
  **没有任何输出**时循环体一次都不执行，那份赋值就漏写结论，判决只能有循环外那一次。
- `rebuild-static.ps1` 从直接判 `$LASTEXITCODE` 改成读 `$script:LAST_INVOKE_CODE` —— 它是这条
  链上的**第二个读者**，两份读者意味着同一步可能给出两个结论，而陈旧码那一侧永远是绿的。

## Added

- `tests/log-common-invoke.test.ts`（4 条：静态 2 + 两个宿主各 1 真跑）：这份内核此前**零执行者**
  （`grep -rl "Log-Common" tests/` = 0，别的用例只对它做文本断言），本条给它补执行者。真跑那组把 harness 落到一次性临时目录
  （`Initialize-Log` 会往 `$PROJECT_ROOT\log\tools` 写字，不能让它写进仓库），**两个 PowerShell
  宿主各跑一遍**，四步顺序是有讲究的：成功（0）之后**立刻**跑一条起不来的命令 —— 那条才是
  决定性的，反先前置一条退 3 的，陈旧值也是 3、非零，用例会绿着放过这个洞。静态两条：
  `[CMD-NOTFOUND]` 必须在、判决只许赋一次、三个入口共用同一份结论且没有在 `Invoke-Logged`
  之后另起一份 `$LASTEXITCODE` 判决。`skipIf(!hasPs)` 已登记。

## Verified

- **变异验证**：把内核退回旧形状 ⇒ 两个宿主的真跑用例**各自红在**
  「命令起不来却记成 0（陈旧码）」这一句上，静态那条也一起红 —— 说明判据钉的是这次修的洞本身。
  修复后 4 条全过（pwsh 5.5s / powershell 4.6s）。
- `build-all.ps1:22` 那种 `& 子脚本` + `if ($LASTEXITCODE -ne 0)` 的形状**实测不是**同一条通道，
  因此没有顺手改它：子脚本 `exit 4` 时 `$LASTEXITCODE` 确实是 4（两宿主一致），而子脚本 `throw`
  会直接终止调用者（第二行断言根本没打印出来）—— 两种失效都会响，不是静默绿。这条读数记在这里，
  免得下次有人按形状相似就把它一起「修」了。
- `tsc` / `eslint --max-warnings 0` / prettier 棘轮 / `tests/conditional-skip-registry.test.ts` /
  `.ps1` 全量 ParserError sweep 全过。
- 文档：`tools/scripts/README.md` 的 `Log-Common.ps1` 那一行补上三态语义与「调用方一律读
  `$script:LAST_INVOKE_CODE`」，并写明执行者是谁。
