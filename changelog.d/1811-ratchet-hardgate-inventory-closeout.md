## Fixed

- **`HARD_GATE_FLIPS` 漏登记了前五刀翻的 10 条判据**（ISSUE #1811 收尾）。这张表是第六刀
  才建的，当时只登记了「从它自己那一刀起」的翻闸，于是 `check-circular-deps.cjs` /
  `check-dead-exports.cjs` / `check-code-duplication.cjs` / `check-function-length.cjs` /
  `check-rust-function-length.cjs` / `check-non-null-assertions.cjs` /
  `check-click-keyboard.cjs` / `check-theme-colors.cjs` / `check-test-it-each.cjs` /
  `check-infra-file-size.cjs` 这十条**没有任何否定式守卫** —— 把 `--update` 与基线通道
  加回去，正面判据一格都不会红（它们已从 `discoveredBaselines()` 出网、五张归类表也不点名）。
  补法按 git 里「已删的基线文件」反查，十条全部登记（各自的自测本就断言硬闸形态，不产生假红）。
- **那条否定式的正则只认双引号**，把落盘写成单引号
  （`writeFileSync(path.join(ROOT,'scripts','.x.json'),'{}')`）实测**照绿** ——
  洞恰恰落在它最容易被人重写的那种形式上。放宽到 `'` / `"` / 反引号三种（也允许路径拼在中间），
  三种拼法的变异实测各红一格。
- **`tests/check-doc-references.test.ts` 一条用例在任何检出上都红**（ISSUE #1811 的 R5 项
  带进来的 `baseline-red`）：它拿 `check-file-structure.cjs --strict` 当锚点，而 R5 翻硬闸时
  `--strict` 已从钩子与规范清单里一并删掉 —— 锚点命中 0 次、探针不产生 diff。改用
  `check-function-length.cjs --staged`（两侧今天都在）。

## Docs

- §11.25 新增 **§11.25.1「ISSUE #1811 翻闸总账」**：18 条已翻硬闸的判据逐条列靶子与翻前存量、
  刻意没翻的 8 条各写理由，并写明这份账的可核性靠 `HARD_GATE_FLIPS` 与五张归类表（不是靠这段文字）。
- 订正三处过时读数：§11.25 与 `PRODUCTION-GAPS.md` 的「四张表 / 三张表」（实为五张归类表 +
  一份翻闸台账）、`13-提交与-code-review.md` 两处的「21 个棘轮」（份数已随翻闸显著减少，
  改为「现算、不写死」）。
