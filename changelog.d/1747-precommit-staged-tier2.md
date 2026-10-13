## Changed

- **pre-commit D 组第二梯队 14 步不再给「不在扫描面内」的提交白付 ≈8.5s**（ISSUE #1747 续）。继 #1798 给两步最贵的全库扫描（`check-ui-primitives` / `check-format`）加 `--staged` 之后，第二梯队 14 步各扫一个**固定前缀**的扫描面（`src/**`、`src/lib`、`src/components`+`src/app`、`src-tauri/src` 等），单项 0.27–1.85s、合计 ≈8.5s（热缓存 8 核）。而「只加 changelog 碎片 / 只改文档 / 只动 `scripts/` 或 `tests/`」这一大类提交（实测占最近 60 次提交的 57%）根本不在靶子里。
  - 14 步各加一档 `--staged`（与 #1798 同源：同一个 `scripts/gate-scan-read.cjs` 的 `skipUnlessStagedTouches()`、同一个 fail-closed、同一个「跳过打印理由」）。
  - **短路点在重活之前**：第一版放进 `main()`，实测「跳过」档仍要 211–342ms（`require("typescript")` ≈180ms / `check-dead-exports` 的语料预加载 ≈340ms 发生在它之前）；提到它们前面后降到 32–40ms。退出码看不出差别（两边都是 0），所以这条钉在接线判据上（短路行号 < 第一条真 `require("typescript")`）。
  - 顺带修「扫描根常量被 TDZ 卡住」：短路上提后 `const SCAN_DIR` 也要一并上提，否则跳过档直接 `ReferenceError`。
  - 判据强度一个字不放松：触发面就是「有文件落在扫描面内」，只要有一个就照旧全库；`--report` / `--update` / `--json` / `--with-tests` / `--verify` / 显式文件入参 / `--root` 都不受影响。
  - 实测：14 步在「暂存里没有扫描面内文件」时 **8.5s → 0.5s**；「暂存里有 `src/` 文件」时逐条复核 **14/14 照旧真扫**。

## Tests

- `tests/doc-check-hook-wiring.test.ts` 新增一组接线判据：14 步逐条钉「钩子里带 `--staged`」+「脚本真的实现了它」+「短路在重活之前」。抹掉任意一条，**没有任何别的判据**会看见差异 —— 它只会让每次提交慢一点。
- 4 份自制夹具的门禁用例（`check-inline-style` / `check-import-alias` / `check-title-bar-clearance` / `form-field-wiring-gate`）改走 `tests/helpers/gate-repo.ts` 的 `copyGateDeps()` —— 判据新增 `require("./gate-scan-read.cjs")` 之后，只 copy 单份脚本的临时仓库会报 `MODULE_NOT_FOUND`。
- 14 份门禁用例（`check-non-null-assertions` / `click-keyboard-gate` / `form-field-wiring-gate` / `check-void-floats` / `check-ts-duplicate-keys` / `check-react-updater-purity` / `check-code-duplication` / `check-function-length` / `check-overlay-z` / `check-title-bar-clearance` / `check-import-alias` / `check-circular-deps` / `check-dead-exports` / `check-inline-style`）全绿（141 条）。

## Docs

- 规范 §13.5.8.2 补「第三笔账」：第二梯队 14 步的扫描面实测表、改法、两个实测踩到的坑（短路点位置 / TDZ）。
- 规范 §13.1「本地提交前必须通过」清单里 14 步的命令同步带上 `--staged`。
