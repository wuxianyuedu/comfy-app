## Changed

- **pre-commit 里两步全库扫描不再给「不在扫描面内」的提交白付 6.5s**（ISSUE #1747）。D 组实测 56 步、热跑 ≈18.9s，其中**两步就占 34%**，且都是**全库扫描**：`check-ui-primitives.cjs`（3.6s，D 组单项最贵）与 `check-format.cjs`（2.9s 热 / 17.6s 冷）。而两者的扫描面**只是全库的一个子集** —— 前者五条根全在 `src/` 下，后者由 `GLOBS`（连 `.md` 都不收）与 `IGNORE_GLOBS` 剔过之后**只剩 `src/**` 1586 份 + `.storybook/**` 10 份**（`git ls-files` 跟踪 5940 份）。于是「只加 changelog 碎片 / 只改文档 / 只动 `scripts/` 或 `tests/`」这一大类高频提交在这两步上白付 6.5s。
  - 两步各加一档 `--staged`（与 `check-docs-api.cjs --staged` / `check-deps-freshness.mjs --staged` 同源）：暂存里没有一个文件落在扫描面内时短路并打印「未触及扫描面，跳过」。
  - **判据面由既有配置现算，没有第二份目录清单**：`check-format.cjs` 过 `GLOB_RES` + `IGNORE_RES`（就是 `GLOBS` / `IGNORE_GLOBS` 的两条正则），`check-ui-primitives.cjs` 把 `SCAN_DIRS` 交给共享件。抄一份就会漂，而漂移的形态是静默的（抄的那份多收一个目录 ⇒ 那类文件从此没人查）。
  - 「读暂存清单 + 判前缀 + 跳过话术 + fail-closed」这套四件套收进 **`scripts/gate-scan-read.cjs` 的新 `skipUnlessStagedTouches()`**（与 `walk()` 当年收进同一处同一个理由；全仓实测有 9 处各自手写 `git diff --cached --name-only`）。`check-ui-primitives.cjs` 已在基础设施层文件长度棘轮上，因此这一档的落地**没有让它长一行**（净 0）。
  - **判据强度一个字不放松**：触发面就是「有文件落在扫描面内」，只要有一个就照旧扫全库；`--report` / `--update`（人的动作）不受 `--staged` 影响，照旧全库。跳过是**结论**（打印理由），不是沉默放行。
  - 实测（同机 8 核）：两步合计在「暂存里没有扫描面内文件」时 **7.1–7.3s → 0.4s**；「暂存里有 `src/` 文件」时无回归（多一次 `git diff --cached` 的读，噪声级）。

## Tests

- `tests/check-format.test.ts` / `tests/check-ui-primitives.test.ts` 各补 3 条 `--staged` 用例，两侧都钉住：不在扫描面内 ⇒ 跳过（并断言打印了「未触及扫描面」）、在扫描面内 ⇒ **照旧真扫**（脏文件 / 违规照旧阻断）、无暂存改动 ⇒ 跳过。只断言退出码不够 —— 「跳过」与「扫过之后没有脏文件」同为 0，一条把 `--staged` 实现成「永远跳过」的改动能全绿通过。
- `tests/doc-check-hook-wiring.test.ts` 新增一组接线判据：钩子 D 组那两步真的带 `--staged`、两个脚本真的实现了这一档（只写 flag 而脚本不认 ⇒ 条件触发静默失效、退回全库扫描）、判据面真的由扫描配置现算。

## Docs

- 规范 §13.5.8.2 补「D 组的第二笔账」：两步的扫描面实测表、改法的三条口径、以及两端实测读数 —— 与那一节原有的「靠每条判据自己别做无用功降」是同一笔账。
- 规范 §13.1「本地提交前必须通过」清单里两步的命令同步带上 `--staged`。
