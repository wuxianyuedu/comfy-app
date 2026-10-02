## Fixed

- `scripts/quality-gate.ps1` 的依赖一致性预检**恒判「不一致」**（ISSUE #1338）：它比的是
  `pnpm-lock.yaml` 与 `node_modules/.pnpm/lock.yaml` 两个文件的 SHA256，而 pnpm 复制出去的
  那一份与仓库根那一份**本就不同形**（本机实测 13068 行 vs 12910 行、顶层键顺序不同、根文件
  里含 `---` 分隔的第二段，且两者由同一次 install 写下、mtime 只差 1 秒）⇒ 哈希恒不等，
  Windows 那一侧的一键门禁不论依赖新不新鲜都停在预检、**一条门禁都跑不到**。
  它自己下面打印的差异明细用的正是 Node 侧那份语义比较器，结论恰好是「实质一致」——
  **同一段里两个结论互相矛盾**。同一个坑 `prepare-local-run.ps1` 早就修对了并把理由写在注释里，
  只是没被复用到这一处；现在判决与明细共用 `scripts/lockfile/diff-cli.mjs` 的退出码
  （0 一致 / 1 有实质差异 / 2 判不了），不再第二次调用、也不再自己实现解析。
- 顺带修掉这条改动的第一个产物：**「判不了」被说成「不一致」**。判据自己跑不起来时
  Node 的默认退出码是 1，而 1 在这份契约里是「判出了实质差异」—— 于是机器会指着人说
  「去重装」（实测把 `diff-cli.mjs` 改名就复现）。两处分开：`diff-cli` 内部意外一律收成
  退出码 2，而「实现文件本身缺失」（模块加载失败早于任何 try）在 PowerShell 侧先验存在性；
  两种失败形态各有 ASCII 标签 `[DEP-JUDGE]` / `[DEP-DRIFT]`，让「乱码控制台」下的断言也站得住
  （`powershell.exe` 5.1 的管道输出走 GBK，认中文子串的用例会随宿主变红）。

## Added

- `tests/quality-gate-ps-precheck.test.ts`（7 条）：静态一条（不许再出现 `Get-FileHash`；
  两种失败形态各带标签）+ `diff-cli` 退出码契约两条（含**只改 `overrides` 一行也算实质差异**，
  这是 #1338 点名要补的反向验证）+ 真跑三态（当前真状态不许停在预检、实质差异必须点名到
  具体哪一行、判据没了必须说「判不了」而不是让人重装）+ **一份 sweep：`scripts/` 与 `tools/`
  下每份 `.ps1` 都得 0 个 ParserError**。无 PowerShell 的环境只做静态与 Node 侧断言。
  （本条原先写「8 条 / 静态两条」，实际是 7 条 / 静态一条 —— 数错了，按 `it()` 计数订正。）
- 那条 sweep 补的是本条踩到的根因缺口：**此前没有任何自动化执行者解析过 `.ps1` 的语法**，
  所以上一笔「整份脚本从第 56 行起解析失败」的缺陷一直红不出来（ISSUE #1331 的 PR 里修的
  就是它）。现在它有了执行者。

## Verified

- 端到端（本机，两个 PowerShell 宿主）：`Get-Parser` 0 错；`-Mode dependencyAudit` 在真状态
  下**不再停在预检**（输出进入 `$Blocks` 循环、三态话术各自成立）；临时把 `pnpm-lock.yaml` 的
  `undici@7` 一行改掉 ⇒ 预检判红并点名
  `overrides（版本强制覆盖） 变更: undici@7: 7.29.1 -> 7.99.9`（改前先 `cp` 备份、验完还原，
  `git status` 事后干净）；把 `diff-cli.mjs` 改名 ⇒ 报 `[DEP-JUDGE]` 且**不**出现 `[DEP-DRIFT]`。
- **订正（合并后在 master 复跑时发现的，见 ISSUE #1345）**：本条原先在此写的是「首次**跑到
  门禁本体**」，那句不成立 —— 证据用的是「输出里出现了门禁 label」，而 label 是脚本在调用
  子进程**之前**打的，进程起没起都会出现。运行器 `Invoke-Check` 当时还让 `Cmd = "node"` 的
  两条门禁零输出却报 `[OK] ... passed`（`.cmd` 拼不出命令 + 陈旧 `$LASTEXITCODE` 被读成通过），
  由 #1345 修。**预检这一半的三条读数都成立**，不受这条订正影响。
- `tsc --noEmit --incremental false` / `eslint --max-warnings 0` / prettier /
  `tests/lockfile-diff.test.ts`（被改的 `diff-cli` 的既有判据）/ `tests/ps1-consistency.test.ts` 全过。
