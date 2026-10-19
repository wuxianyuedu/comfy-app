## Fixed

- 每日档的 `每日单元测试` 首跑（`cnb-2in-1k589j0kp`）12.6s 退 1、后面三档全部 `skipped`，
  而日志里那句 `No test files found` 看着像「这个仓没有用例」：分文件耗时读数的 junit 落点
  取自 `os.tmpdir()`（这台节点上是 `C:\WINDOWS\TEMP\…`），拼出来是
  `--outputFile.junit=C:\…`，而 PowerShell 宿主会把**破折号开头、带 `=`、值里还有冒号**的
  一个参数在第一个冒号处切成两个 —— 切剩的那半截变成 vitest 的位置过滤器。
  落点改为仓库内的 `node_modules/.cache/`（git 忽略面里，也不与 `coverage/` 共用清理生命周期），
  交给 vitest 的是相对路径。
- 同一条边界的两处防线共用**一个谓词**（`scripts/launcher-core/shell.mjs` 的
  `PS_UNSAFE_ARG_RE`）：`toTransportSafePath()` 对仓库外的落点**直接抛**（落点猜错的表现是
  「读数没有」，与「这一档没跑过文件」在日志里同形），`runPnpmSync()` 在宿主形态下当场拒
  任何仍带冒号的 `--x=…`，返回「命令没起来」那一族 —— 不让一次坏翻译冒充一次真失败。
  反面形状一并钉住：裸绝对路径、`out=C:\x`（无前置破折号）、`a=b:c` 都原样到达宿主，
  **不在拦的范围内**（按「参数里有绝对路径」写判据会拒掉本来能跑的命令）。
