## Changed

- **五条「存量已清零」的棘轮翻成硬闸**（ISSUE #1811 收尾）：删基线文件 + 删
  `--update` / `--strict`，命中即退 1。判据口径与扫描面一字未动，只收「有存量」
  那层皮：
  - `check-overlay-z.cjs`（Z3 刻度之外的裸数字档）
  - `check-comment-language.cjs`（疑似英文注释）
  - `check-test-sleep.cjs`（裸 sleep 站点）
  - `check-format.cjs`（未过 prettier 的文件）
  - `check-ui-logic-separation.cjs`（S1/S2/S3 视图层 IO）
- **翻闸的理由是同一件事**：棘轮在基线为 0 时的两个动作都无事可做（`--update` 无余地、
  `--strict` 恒绿），留下的却是一条「手改那份 JSON 就能把新违规登记成已知存量」的
  通道 —— 硬闸类本来没有那个中间态（规范 §13.6.2 的两类对照）。
- `--report` 一条未动（清零后的自证靠它），五条各补一条**断头用例**：`--update` /
  `--strict` 既不放行也不落盘。

## Tests

- `tests/ratchet-update-guards.test.ts` 新增 `HARD_GATE_FLIPS` 表 + 一条**否定式**判据：
  翻闸的脚本里不许再有「把一份 `.json` 写回去」的调用，也不许再出现在
  `discoveredBaselines()` 的现算清单里（那是「有人把 `--update` 加回来」的唯一机器痕迹）。
- 五条判据的自测改判硬闸形态（含各自的反向格：合规时判据不是恒红）。

## Docs

- 规范 §12.4.6 / §13.5.1 / §16.2.5 / §17.3 / §11.14.1 与 AGENTS.md 硬规则 10、
  `.githooks/pre-commit` 的步骤名同步为「硬闸」；`docs/generated/**` 一并重生成。

## Fixed

- 清两处 master 上的 `baseline-red`（来自 PR #1830 的拆刀，在干净 `master` 上复现）：
  `tests/dev-launcher-dependency-sync.test.ts` 与 `tests/dev-launcher-toolchain-gate.test.ts`
  断的还是拆刀前的形态（`if (gated.error) {` / `return { shell: null, staleShell };`），
  实际已改成 `if (!gated.ok) {` 与 `return { ok: true, shell: null, staleShell };`。
  它们在拦从 master 分出的每一个提交，所以就地按**实际形态**改正（不是放宽判据）。
