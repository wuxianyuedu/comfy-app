## Fixed

- **GA 桌包档「桌面成品构建」修后仍红（`beforeBuildCommand` 回落裸 `pnpm` ⇒ ENOENT）**（ISSUE #3305 第二轮）：
  #3308 新增的「补 pnpm 真身目录」那一格用 `steps.setup-pnpm.outputs.bin_dest` 的父目录
  拼 `pnpm`，而 action-setup@v6 在 bootstrap 12.17.0 ≠ 本仓 `packageManager: pnpm@12.4.1`
  时走 `self-update`，`bin_dest` 实为 `<dest>/node_modules/.bin/bin` —— 拼出来的是
  `.bin/pnpm` 这个 npm 垫片**文件**，不是目录；`Test-Path` 对文件也返回真 ⇒ 该格假绿，
  PATH 上仍只有垫片，`ci-install-deps.mjs` 的 `pnpmCli()` 找不到能真起 `pnpm.exe -v`
  的绝对路径 ⇒ 回落裸 `pnpm`，Node 的 `spawnSync({shell:false})` 起不来垫片 ⇒ 整格 1 秒红。
- 修法两件同批，仍复用既有判据（§12.18 / 硬规则 24）：
  ① `package-desktop.yml` 那一格改取 action-setup 的 `dest` 输出，按「`bin_dest`（self-update
  落点，版本与 `packageManager` 一致）→ `<dest>/node_modules/pnpm`（bootstrap 真身兜底）」
  枚举**目录**、逐个真起 `pnpm.exe -v`，起不来当场红，再把命中的真身目录追加进
  `GITHUB_PATH` —— 不再靠 `Test-Path` 的存在性假绿，也不再从 `bin_dest` 拼父目录猜落点；
  ② `pnpmCli()` 找不到时把 `ensurePnpmOnPath` 的 `consulted`（问过哪几处、各自什么结论）
  逐条念出来，与 `main()` 的失败出口同一份读数，避免「补 PATH 假绿 + 本格静默回落」
  再以一句「没找到」糊过去。
- `tests/build-desktop-pnpm-cli.test.ts`：第 3 条从「假定的真身形状」改成按 action-setup
  真实 `dest` 语义造形状（修复前 / 上一轮错误推导 / 正解三态），并补一条钉 workflow 那一格
  读 `dest`、判 `PathType Container`、真起 `-v` 且不再 `Split-Path bin_dest -Parent`。
