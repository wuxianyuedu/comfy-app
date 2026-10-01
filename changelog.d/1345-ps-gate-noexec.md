## Fixed

- `scripts/quality-gate.ps1` 里 `Cmd = "node"` 的两条门禁（`format`、`dependencyAudit`）
  **不论子脚本成功还是失败都报 `[OK] ... passed`、整体退 0**，而子进程其实一次都没起来
  （ISSUE #1345）。三条通道叠在一起：
  ① `Invoke-Check` 对 `^(pnpm|npm|node)$` 一律拼 `.cmd`，而本机 `node` 是真 `node.exe`、
  `node.cmd` 不存在（`Get-Command node.cmd` → NOT FOUND）⇒ `&` 找不到命令；
  ② `&` 起不来时 PowerShell 只发一条非终止错误、**不写 `$LASTEXITCODE`**，于是读到的是上一步
  （依赖预检那次成功的 `& node diff-cli.mjs`）留下的 0 ⇒ 判成通过。定性证据：同一条命令直跑
  子脚本一定打得出 `[dep-audit]` / `[format]`，这两行在 PS 侧一次都没出现过；
  ③ 子进程 stdout 默认进函数输出流，和 `return $code` 拼成数组（实测
  `Object[] ["child-marker-line", 0]`）⇒ 即使进程起来了，判决也不是纯退出码、输出还看不见。
  这条不新鲜：`.cmd` 的无差别拼接来自 `ac62b64d`，`format` 门禁（`9ad020d9`）用的就是
  `Cmd = "node"` —— 它从落地起就没在 PowerShell 侧执行过。
- 现在：命令按 `<name>.cmd` → `<name>` 候选解析（pnpm/npm 是 `.cmd` 外壳，裸名会解析到
  同名 `.ps1` 受执行策略摆布，所以 `.cmd` 仍排前面），解析不到打 `[FAIL][GATE-NOEXEC]` 并退 127；
  调用前 `$global:LASTEXITCODE = $null`、调用后仍为 `$null` 同样判 `[GATE-NOEXEC]`
  （实测 pwsh 7 与 powershell 5.1 一致：失败启动后 `$LASTEXITCODE` 保持 `$null`，成功启动必写真实码）；
  子进程输出走 `| Out-Host` 落宿主，返回值只剩退出码。**「没执行」与「执行了但失败」是两句话**，
  前者要查的是这台机器的 PATH，不是子脚本的报错。

## Changed

- `quality-gate.ps1` 头部的维护说明订正：原文写着「On Windows the script automatically maps
  pnpm/npm/node to the .cmd shim」（正是那条错假设），改成候选解析 + `[GATE-NOEXEC]` 语义；
  `Mode` 清单补上 `format` 与 `dependencyAudit`（原来只列了三项，#1331/#1338 之后已是五项）。

## Verified

- 修复前后同一条命令的对照（本机 pwsh 7）：修复前 `>>> node.cmd "scripts\check-dependency-audit.mjs"`
  ⇒ 零子进程输出 + `[OK] ... passed`；修复后 `>>> node "..."` ⇒ 打出
  `[dep-audit] ✓ 无基线外新增（high/critical 命中 0 条，其中基线内 0 条）` + `[OK]` + 退 0。
  中途还量到一条只有把 ③ 修了才会现形的形态：进程起来后输出被吞进返回值，于是
  总结行同时出现 `[OK]` 与 `Quality gates have failures` —— 那次也记在这里，因为它说明
  「门禁输出看不见」和「判决错」是同一个根因的两面。
- `[Parser]::ParseFile` 0 个 ParserError；`tests/quality-gate-ps-precheck.test.ts` 由 7 条增到 12 条
  全过。其中两条是**变异验证**，各自恰好红一条：把 `| Out-Host` 去掉 ⇒ 红「要看见子进程自己的
  `[dep-audit]` 标记」；把候选列表退回只试 `.cmd` ⇒ 同一条红。新增的三条真跑用例分工写清了
  边界：`[GATE-NOEXEC]`（命令拼不出来）、`failed (exit 1)`（跑了且失败）、`[dep-audit]`
  （跑过且输出可见）—— 后者是**唯一**能钉住「stdout 被并进返回值」的那条：把 `Out-Host` 去掉时
  「跑了且失败」那条照样绿（node 的报错走 stderr、没进函数输出流），这一点实测过并写在用例注释里。
- 同文件里那条「不许停在预检」的用例被**降级改名**：它原本被当成「跑到门禁本体」的证据，
  而 label 是脚本在 `&` 之前打的，进程起没起都会出现。现在它只声明自己实际证明的事
  （进了 `$Blocks` 循环），真证据交给 `[dep-audit]` 那条。
- Node 侧 `quality-gate.mjs` 不受影响（`result.error` + `status ?? 1`），已核对，不写第二份判据。
