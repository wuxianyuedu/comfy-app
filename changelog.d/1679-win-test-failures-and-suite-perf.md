## Fixed

- **Windows 上 4 条用例红：两条根因都是「拿了 POSIX 形态当跨平台形态」**（ISSUE #1679）。
  - `tests/shell-gate.test.ts` 的 `write()` 夹具用 `execFileSync("mkdir", ["-p", …])` 建父目录 —— Windows 上没有 `mkdir` 这个可执行文件，三条「合并提交的壳采纳过滤」用例一起报 `spawnSync mkdir ENOENT`。改成同文件里已有用法的 `mkdirSync(dir, { recursive: true })`（题外话：那个错读起来像「夹具坏了」，而不是「平台形态不对」，所以曾在别处被当成环境问题跳过）。
  - `scripts/base-check.mjs` 自己写了一份 `needsShell()`（`cmd === "pnpm"` 就开 `shell: true`）去起被复算的 `pnpm exec …`。那是**第二份**可执行形态判据（AGENTS 硬规则 24 / §12.18），而且与唯一那份不一致：开一层 shell 只让 `cmd.exe` 去猜 `pnpm`，而正确的形态是经 PowerShell 宿主起同目录的 `.ps1`（`.cmd` 垫片 Node 起不来）。`tests/dev-launcher-toolchain-gate.test.ts` 的「全仓 `scripts/**`：由 Node 起 pnpm 一律经 `shell.mjs` 的形态判据」正是拦这个，且**在 Linux 上也红**。修法 = 删掉本地那份判据，`runGate` 改经 `resolveGateInvocation()` 复用 `pnpmInvocation()`（`scripts/launcher-core/shell.mjs`，与 `dev.mjs` / `run-tests.mjs` 同一处）；PATH 上找不到时给一条点名 `pnpm check:toolchain` 的可读出口，并照旧归 127（`inconclusive`，不构成证据）。

## Changed

- **测试套件的进程冷启开销收窄（本批实测最大的两笔）**。全量 834s 里 `tests/check-ui-primitives.test.ts` 占 469s、`tests/check-reformat-only.test.ts` 占 416s（Windows 读数），而两笔钱都花在**起进程**上而不是扫描上 —— 实测裸 `node -e 0` 就要 37ms、`prettier --version` 108ms，Windows 上还要乘十几倍。
  - `check-ui-primitives`：320 条用例里 314 条既 `seedBaseline(repo)`（一次完整 `--update` 子进程）又 `repo.run()`，而那份基线对「硬闸判据命中了吗」**一点用都没有** —— 85 条判据已全部是硬闸、棘轮集为空，`hasRatchetRules` 为 false，脚本根本不读基线（实测验过：无基线文件时「违规 → exit 1 并点名 P1/文件名」「干净 → exit 0」两条结论一字不变）。只在真要看基线文件、或 `--update` 本身就是被测行为、或把某条降成棘轮的那 20 条里保留 `seedBaseline`。
  - `check-reformat-only`：`formatInPlace()` 逐文件起一次 prettier（12 个文件 = 12 次冷启），改成一次 `prettier --write <paths…>` 做完 —— 被测的是「这些文件有没有被重排」，不是「prettier 被起了几次」，判据等价。
  - 实测（Linux，同一台机器、各 3 轮）：`check-ui-primitives` 37.6s → 22.6s（−40%），`check-reformat-only` 31.1s → 10.7s（−65%）。按 Windows 的同一倍率折算，全量约省 8 分钟。判据一条没放松，`KNOWN_FAILED_FILES` 仍是空数组。
