## Fixed

- **平台侧 `桌面壳（改了 src-tauri 才跑）` 的判决面取错了**：`scripts/ci-heavy-gates.mjs`
  对它走的是「只剥 `--staged`」，而平台流水线**没有暂存区** ⇒ `stagedFiles()` 空 ⇒
  `decide([])` 恒假，可这一步照样进了 `runGate`，于是「这台机器上没有 cargo」被逐字报成
  **本次改动**的红（PR #2283 的现场：8 份改动里一条 `src-tauri/**` 都没有，`重档静态判据`
  却因为它退 2）。改成按 `--base <ref>` 判 —— 与「受影响用例」同一份基线口径
  （`changedFilesForBaseRef()`），范围外的改动面不再触发它。
- **`findCargo()` 的回退没真的命中 `$CARGO_HOME/bin/cargo`**：`.cnb.yml` 给那一格配了
  `CARGO_HOME` / `RUSTUP_HOME`，而 runner 的 `PATH` 是**固定的**、不会跟着变量长出来 ⇒
  `whichCommand("cargo")` 必然落空，回退是唯一出路。现在这条回退单独成一个可测的
  `findCargoLookup()`：`CARGO_HOME` 的值的形状（引号 / 相对路径 / 尾分隔符）不许决定
  命不命中。
- **「找不到 cargo」那句话补上取证**：逐处念「PATH / CARGO_HOME/bin / ~/.cargo/bin /
  ~/.rustup/toolchains」命中与否，并把「目录不在」与「目录在但读不了」（权限）分开 ——
  后者要人去查执行账号的读权限，不是再装一遍工具链。
- **`base-check` 的命令解析**：`pnpm base-check "node scripts/x.cjs"` 与 `--base "…"`
  两种走法都只有**一个**数组元素，此前那个裸脚本名分支会把整串当成文件名 ⇒
  `commandTargetState` 拼出 `<cwd>/node scripts/x.cjs` ⇒ 恒「不存在」⇒ 每条判据都读成
  127（没跑起来）。归因工具自己是坏的，于是「这红是不是我的」在那个现场给不出结论。
  现在整条命令按 `tokenize()` 切成 argv，两种形态判同一个结论。
- **`tests/shell-gate.test.ts` 的一处夹具漏注入**：`materializeCargoTestInputs` 的 `copy`
  被替成记账之后盘上并没有那个 sidecar，默认的 `fs.chmodSync` 当场 ENOENT（平台与本地同形，
  `baseline-red`）。`chmod` / `write` 一并注入并各自记账，断言的是「建了哪几件」，
  不是「盘上有没有」。
