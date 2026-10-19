## Fixed

- 每日全量档第一次有平台执行者（`cnb-vue-1k59blt4c`，2026-10-19）照出来的**三条基线红**，
  都不是那一跑新引入的：把这三份文件在「今天三笔 CI 改动之前」的 rev（`53a60be0`）上单跑
  （一次性 worktree + `node_modules` 走 junction，不重装），三处照旧红。
- `tests/ci-cp936-exit.test.ts`（2 条）：**注入面只管了一半**。
  `runWithCp936Exit` 收 `env` 却递给解析口 `resolve(command, args)`（一个 options 都不带），
  于是「默认解析口接没接上编排」那一格实际问的是**这台机器的 PATH** —— Windows 上解析到
  corepack 那句 `pnpm.ps1`、经 PowerShell 宿主起，起的是 `pwsh.EXE`
  （`expected 'pwsh.EXE' to be 'pnpm'`）。现在 `env` 一路传到解析层，
  那一格改用**它自己那张 PATH** 与一个宿主真起得来的夹具（复制 `process.execPath`）；
  `platform` 刻意**不**交给解析层，并把理由写在代码里 —— 同文件那两条「模拟非 Windows」的
  用例真起 `echo`，POSIX 的扩展名规则在 Windows 的 PATH 上一个都找不到，
  交下去会把它们从「判转码不转码」改成「判这台机器有没有一个叫 `echo` 的无扩展名文件」。
  另一条把「参数原样转交」改判**调用方给的那一串必须逐字落在尾部**，
  而不是「整串等于我给的」：`commandInvocation()` 的契约是交出**能直接 spawn 的整串**
  （Windows 上宿主 + `-File <shim>` 就在 `args` 里），旧断言把「写下来的那一条」
  当成了「被执行的那一条」，在这台机器上必然红。
- `tests/ci-toolchain-selfcheck.test.ts`（1 条）：「片长自适应地退档」的墙钟成本 =
  **停顿的片数 × `chunkTimeoutMs`**（假链路对超过 burst 的请求只吐一段就挂住），
  按 700ms 隔离实测 **35.4s**，而全局 `testTimeout` 是 30s ⇒ 在任何机器上都必然红。
  处置是**降成本而不是抬预算**（§11.13）：那条结论只要求「片段在超时内收不齐」，
  与超时是 700 还是 200 无关；降到 200ms 后隔离实测 17.9s。
- `tests/ci-image-plan.test.ts`（2 条）：两条都把**宿主的形状**当成了契约。
  ① 权限位写死 `-rwxr-xr-x`，而 Windows 上 `chmod 755` 不生效、盘上就是 `0666` ——
  现在期望值取自**盘上那个文件本身**（`statSync(...).mode`），判的仍是
  「header 有没有把 mode 原样带过去」，且比原来严（不一致就红，两端同结论）；
  ② 解析 `tar -tvf` 用列序号 `slice(5)`，而 GNU tar 把 uid/gid 合成 `0/0`、
  bsdtar 分成两格、中文 locale 下日期还是三格 —— 于是 `sub/link` 明明在清单里
  （`lrwxrwxrwx … sub/link -> ..\a.txt`）却被数成 0 条。现在只按**第一格**取类型与 mode、
  按**行尾**取名字，链接目标先归一分隔符再比（三种宿主给的字面量实测各不相同）。
- 顺带照出**第五条没人报的失效**：那两格在这台开发机上**从来没有判过任何东西**。
  绝对路径交给 Git 自带的 GNU tar 时，`C:\Users\…` 的冒号被读成**远程语法**
  （`host:path`），tar 直接 `Cannot connect to C: resolve failed` 退 **128**，
  而当时那句 `if (list.status !== 0) return;` 把这条真故障连同「打包真的读不了」一起吞掉 ——
  表现就是绿。现在传**相对路径 + `cwd`**（两种 tar 都认），并把「这台机器没有 tar」
  的证据换成 `spawnSync` 的 `error`（ENOENT），退出码非零而 tar 又在场 ⇒ **当场红**
  （§13.5.16 那条「红也 ≠ 跑过」的反面：**没跑也不红**，这是它的新实例）。
  反向验证：把 `buildTarStream` 的 mode 改成写死 `0o644` ⇒ 这一格红
  `expected '-rw-r--r--' to be '-rw-rw-rw-'`（改之前它连跑都不跑）。
