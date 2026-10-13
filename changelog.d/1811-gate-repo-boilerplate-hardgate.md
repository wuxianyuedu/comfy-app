## Changed

- **「门禁自测别再手搓临时仓库样板」从棘轮翻成硬闸**（ISSUE #1811 收尾 / 规范 §11.16.1）。这条判据原先是棘轮：本批收口时留了三份没迁（`check-file-structure` 大量直接 `writeFileSync` 造 Buffers；`check-reformat-only` 要 `git init` + 软链 `node_modules` + 工作区之外的探针配置；`gate-executors` 是把**全部**判据脚本过滤拷贝过去，与「单脚本」模型不同形），逐份迁完、账记在 `scripts/.gate-repo-boilerplate-baseline.json`。最后两处（`check-reformat-only` / `gate-executors`）本刀迁进 `tests/helpers/gate-repo.ts` 的 `defineGateRepo`，读数为 **2 → 0**。
  - 基线归零后棘轮只剩坏处：`--update` 与 `--allow-new` 两个动作都无事可做，留下的却是一条「手改那份 JSON 就能把新的手搓样板登记成已知存量」的通道 —— 硬闸类本来没有的中间态（§13.6.2 的两类对照）。所以**基线文件已删、两条放宽旗标已删，命中即退 1**。
  - 判据**形态与已知边界一字未动**（仍是「`tmpdir()` + `execFileSync(` 窗口里出现 `join(workdir` + 没 import 共享件」三条同时成立）。

## Fixed

- **两处「夹具选项盖不住」的形状，改用夹具已有的口子挡**（没有把四件套搬回来）：
  - `check-reformat-only`：`git init` / `config` / 软链 `node_modules` 写进 `setup`，`launcher-core/` 与 `src/lib/process/executable-resolve.ts` 写进 `copy`（缺了脚本以 exit 2 结束 —— 长得像「门禁坏了」，实际是夹具少一块）。
  - `gate-executors`：临时区里要放**全部判据脚本**、却**不能**放 `quality-gate.mjs` / `.githooks/` / `package.json` —— 它们是本判据的**执行者来源**，一在场就造不出「某个探针一个执行者都没有」那一档。过滤拷贝写进 `setup`，那是判据语义的一部分。

## Tests

- `tests/gate-repo-boilerplate-gate.test.ts` 跟着翻：五条棘轮用例（上涨 / `--update` 拒涨 / 首建基线）换成硬闸形态 —— 命中即点名、**并加两条断头用例**断言旧旗标 `--update` / `--allow-new` 不再落盘任何 JSON（加回落盘通道在任何一种拼法上都会当场红）。真实仓库那一条从「读数 == 基线」改成「原样退 0 + 扫描面非空自证」。
- `tests/ratchet-update-guards.test.ts` 的归类跟着挪：`.gate-repo-boilerplate-baseline.json` 从 `COVERED_LOCALLY` 移出，`check-gate-repo-boilerplate.cjs` 进 `HARD_GATE_FLIPS`（18 → 19 条）。

## Docs

- 规范 11 §11.16.1 与 §11.25.1 同步：「棘轮」改「硬闸」、删掉已不存在的基线引用、注明两处 `setup` 手法；§11.25.1 的翻闸表补一行（19 条），「刻意没翻」表把那一条移出并说明。
- `scripts/.declaration-readers.json` 与 §11.23.3 那张表的 `declaredAt` 不再点名已删的基线文件。
