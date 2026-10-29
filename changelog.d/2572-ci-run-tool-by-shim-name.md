## Fixed

- **CI 清单里起本地 CLI 不再经一层 PowerShell 宿主**（ISSUE #2572，P2）：`.cnb.yml`
  的 `类型检查` 与 `lib Node-only 声明` 两格过去写的是
  `node scripts/ci-cp936-exit.mjs -- node_modules/.bin/tsc --noEmit`（另一格是 `.bin/vitest`）。
  `node_modules/.bin/<名字>` 是 pnpm 摆给**宿主 shell** 的垫片 —— 盘上是三个文件
  （`.cmd` 只有 cmd.exe 会解释、`.ps1` 只有 PowerShell 会跑、无扩展名那份是 shebang），
  Node 一个都直接起不了。于是外壳的形态判据只能回退去找**同目录那份 `.ps1`**，
  再交 `powershellHost()` 起（实测交出的整串是
  `-NoProfile -ExecutionPolicy Bypass -File <垫片>.ps1 …`）——
  **起一个仓里装的编译器，链上多了一层宿主**。这层多出来的东西不是理论成本：
  它是 DEP0190 那一族（「args 数组 + 开 shell」）的入口，也是「换台机器 / 换 Node
  大版本才响」的那类失效形态（ISSUE #2445 / #2453 已在 typedoc 与 storybook 两处验过）。
  现在这两格走新入口 `node scripts/ci-run-tool.mjs <名字> [参数…]`：它按**垫片名字**问出
  包真身的 JS 入口，然后 `spawn(process.execPath, [入口, …])` —— 与 typedoc / storybook /
  vitest 那几处同一形态，宿主那一跳与引号那一跳一起消失。退码三态照全仓口径：
  子进程的码原样转发，**解析不到入口 ⇒ 退 2**（「这一格没跑起来」不是「跑了且红」）。
- **本仓两份编译器不会被混成一份**（同一条单的第二个症状）。`tsc` 这个名字归
  `@typescript/native`（7.0.2，它自己申报的 `name` 恰恰是 `typescript`、`bin` 键是 `tsc`），
  而依赖项 `typescript` 是别名 `npm:@typescript/typescript6@6.0.2`（`bin` 键只有 `tsc6`）。
  当场读数：`require.resolve("typescript/package.json")` 落在 **6.0.2 那份**上，而
  `.bin/tsc` 指向 **7.0.2 那份**；按包名正推两条路都拿不到入口
  （`resolvePackageBinEntry("typescript")` 与 `("@typescript/native")` 实测都 `null` ——
  键名与包名对不上）。**混成一份的那一格在下一步**：拿着 `null` 去补一句
  「取 `bin` 的第一个键」这个很自然的兜底，`typescript` 就凑出 `tsc6` ⇒ `tsc` 安静地
  跑成了 6.0.2 那份，而日志一声不吭。所以这一层按**名字**问，不问依赖名。
- **解析按权威度分两层**：优先认 pnpm 写在 `.bin/<名字>` 末尾的
  `# cmd-shim-target=<绝对路径>`（本仓 `.bin` 里 21 份垫片**全部**带这一行，当场数过），
  声明缺席或那条路径不在（`node_modules` 是从别的检出搬来的）才回落到读 `.cmd` / sh 里
  那条相对路径。回落层顺带修掉两处实测过的坑：可执行位 `node.exe` 那个 token 要跳过，
  而 `%~dp0\..\…` 剥掉前缀后**带着前导分隔符** —— 直接 `path.resolve` 会被当盘根相对，
  表现是「所有垫片都解析不到」。
- **新执行者 `tests/spawn-shell-scan.test.ts` 加了 9 条**（本文件早已在固定清单里，
  判据面不用另登）：本仓 `tsc` ⇄ `tsc6` 是两份不同的包、**申报的包名与版本都不同**、
  各自的 `bin` 键不撞（刻意**不钉具体版本号** —— `7.0.2` / `6.0.2` 是当场读数，写进断言
  就成了会过期的账，而单子要判的是「两份是不是两份」这件事）、
  `require.resolve("typescript")` 与 `.bin/tsc` 不是同一份包、两层解析各判一次且**互相可归因**
  （夹具刻意让两层给不同答案，否则摘掉任一层都判不出来）、`ci-run-tool` 真起一次
  `tsc --version` 把「解析到的那一份」与「被起起来的那一份」对上、参数逐字转发（含带空格的值）、
  退出码转发与「没跑 ⇒ 退 2」分得开、以及 `.cnb.yml` 的**命令行**里不再出现
  `node_modules/.bin/`（注释行不算 —— 那几行正当地写着「别再这么写」）。
  变异实测五组：摘掉声明层 ⇒ 3 条红；不跳过 `node.exe` ⇒ 1 条；不剥前导分隔符 ⇒ 2 条；
  清单退回 `.bin/tsc` ⇒ 1 条；起错的那一份 ⇒ 3 条。每组改完都还原并逐字比对相同。
  ⚠️ 第五组第一次跑是**没结论**而不是绿：变异脚本自己拿 `ci-run-tool.mjs` 去起 vitest，
  被改的正是那个入口 ⇒ 整跑没起来，`×` 行数 0 读的是「没跑」不是「没红」。改成直接点
  `node_modules/vitest/vitest.mjs` 才拿到上面那三条 —— **别拿被改的那入口跑它自己的用例**。
- **连带订正四处「`.cnb.yml` 里有 `.bin/tsc` 这一形态」的现时陈述**（它们是判据与规范里的
  事实句，清单一改就过期）：`scripts/ci-cp936-exit.mjs` 的 `isPathLike()` 头注、
  `tests/ci-cp936-exit.test.ts` 那条路径用例的说明、规范 §13.5.3.4 第五处与第七处那两段
  （改成「当时的清单」并把 #2572 的出路接在后面）。**外壳对垫片路径的处理一字未改** ——
  少掉的只是「非要经一层宿主才能起一个仓里的编译器」这一跳，`commandInvocation` 的
  `.ps1` 回退仍是 corepack / 启动编排那几处的现役形态（`src/lib/process/executable-resolve.ts`
  的头注就此写明：那是「起不起得来」的手段，不是「该不该这么起」的推荐形态）。
- **连带记两笔与本平台跑有关的账**（都是这一格在平台上红出来的）：
  · 脚本档账本 `scripts/.scripts-typecheck-baseline.json` 的 `face` 由 210 记成 211 ——
    新增一份 `scripts/*.mjs` 就会让「面 ⇄ 账」那一格红。走的是判据自己那唯一的写入口
    （`check-scripts-typecheck.cjs --update`），**事后逐字对过 diff**：只动了 `face` 这一行，
    `total`（206）与逐文件格子表一个字节没改 —— 这不是「把新增登记成已知」（那才是被禁止的形态），
    存量那一格新脚本实测 0 处。
  · `tests/scripts-typecheck-ratchet.test.ts` 的红话术补了 `driftReading()`：除了两个数，
    还把**「面里有、`git ls-files` 里没有」的那几份点名**，并据此说清该记账还是该归 exclude。
    判决一个字没改（只在数不上时才多算一次 git），加这一半的原因是平台那一跑只给
    「212 vs 210」两个数：本地展开是 211、入库清单也是 211，而平台上多 1 份且指不出是哪一份 ——
    「差一份」有两种相反的修法，只给数就是在逼人猜。**剩下那一半（判决面按磁盘 glob 展开，
    与「这份提交里有什么」不是同一件事）另立 ISSUE #2681**，不在本单里顺手改别人的判据口径。
- **范围外（刻意不做，都写在单子里）**：不绕 pnpm / corepack —— `packageManager` 钉死的
  `pnpm@12.4.1` 仍按原路起（`require.resolve("pnpm/bin/pnpm.cjs")` 在本仓拿不到入口，
  那不是本单要修的事）；`.ps1` 那一跳不吃机器 ExecutionPolicy（`-ExecutionPolicy Bypass`
  早就显式写在参数里，单子初稿那句是错的，已订正）。
