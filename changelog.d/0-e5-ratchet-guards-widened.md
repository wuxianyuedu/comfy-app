## Fixed

- **`tw4-canonical-report.mjs` 与 `tw4-spacing-canonical.mjs` 的 `--update` 也是无条件落盘**（台账 E5 的同一族，由那条横切判据把面拓宽后自己照出来的两家）：两份工具的文件头都写着「治理后重写基线（须伴随下降）」「只许降不许升」，而 `--update` 那一支连基线都没读 —— 判棘轮的是 `--check`，可这两家是**按需跑**（起 Tailwind 引擎、不进 pre-commit，`scripts/.gate-executor-ledger.json` 里登记的就是「为什么不进钩子」），所以连「下一次跑会报新增」那半个兜底都不存在：基线今天是 `total: 0`，谁跑一次 `--update` 就能把它改成任意数，而这条判据此后不再对任何回潮响。两家的 `--update` 补上与 `--check` 同一份比较（总数 + 逐文件两个维度、`hadBaseline` 而不是「基线里的数是不是非零」），拒涨时非零退出且基线一个字节不动。
- **一份门禁自测把「旗标在场」当成了「旗标生效」**：`tests/tw4-canonical-ratchet.test.ts` 那条「收紧档与报告档的语义分得开」只断 `src.toContain("--update")`，于是它从落地那天起就在给上面那个洞背书；文件头还写着「真跑红/绿的现场已由 `tests/gate-executors.test.ts` 那族覆盖」—— 那一族没有跑过这两家的任何涨红场景（已把这句改成指向真正的执行者 `tests/ratchet-update-guards.test.ts`）。这条是 §11.2.1「源码长这样不是执行记录」在**自测文本**上的又一格：自测自己也可以是假保险。

## Added

- 横切判据 `tests/ratchet-update-guards.test.ts` 从 11 家扩到 **13 家**（上面两家各配一条 `violate`），三张表另点名 8 家（`.tsc-diagnostic-executors.json` 与 `.dependency-audit-baseline.json` 各归其本地用例），`PENDING` 仍是 2 格上限；现算清单、表、册、待办四处**逐一对得上**：24 份 `--update` 落盘基线 = 24 格点名，无未归类、无幽灵登记。
- **现算清单的归因口径两条**（都是扩面时撞出来的，不是设计时想到的）：① **认「真把那份 `.json` 写回去」，不认「脚本里出现过这个基线名」** —— `check-tsc-diagnostic-executors.cjs` 读姊妹索引 `.declaration-readers.json` 做逐行同源核对，但它的 `--update` 只写自己那份；按「出现过」算会报一个不存在的 `--update` 出口，而**会误报的判据活不过一次评审**（§11.18.4）。② **根变量不钉死成 `__dirname`** —— `path.join(ROOT, "scripts", …)`、`path.join(HERE, …)` 是同一条落盘通道（tw4 与 `check-dependency-audit.mjs` 就是这么写的），钉死一种拼法等于把覆盖面绑在写法上。
- **完整性那一维补上反向的一格**（`表 ⊆ found`）：原来只判 `found ⊆ 表`，那时有静默退网形态 —— 某家把落盘改成变量拼不出来的形状，它就从现算清单里掉出去，正向那条不会红（少掉的行不必归类）、它的沙箱用例照样绿，于是这一家的拒涨**悄悄退出判决面**。反向配上后，形状漂移当场红。
- 表里两个新字段：`judgeArgs`（`--check` 型工具的判定档参数 —— 它们的默认档是报告、永远退 0，用默认档走第 ②/③ 步会得到「加第二条违规仍然绿」，那判的是「我没把判定档打开」而不是棘轮）与 `timeout`（按实测登记的单次预算：`tw4-canonical-report` 每跑一次都要重新起 design system，实测 4.8–5.6s、一格 3–4 次 ≈ 20s，而全局 `testTimeout` 是 30s，并发下必顶穿；口径同 §11.13 —— 没登记预算的行**不传 options**，免得在文件里抄一个 `30_000` 把全局档钉死）。
- ESM 类判据的沙箱输入：`NODE_PATH` 对 **ESM 解析无效**（只按脚本自身位置向上找 `node_modules`），所以这类夹具走 `tests/helpers/symlink-dir.ts` 链回真仓库（Windows 免特权那一档），并把 design system 的输入 `src/app/globals.css` 拷进沙箱。`dispose()` 的 `rmSync(recursive)` 把链接当文件 unlink、不穿透（实测真 `node_modules` 完好）。

## Tests

- 变异证据补四刀，各红各的：把 `tw4-spacing-canonical.mjs` 的拒涨分支短路成 `false && baseline` → **只有 spacing 那两格红**；对 `tw4-canonical-report.mjs` 再来一刀 → 只有 canonical 那两格红（两家互不顶替，也就证明这一族不是「同一件事判 13 遍」）；把 `check-theme-colors.cjs` 的写入改成 `writeFileSync([BASELINE][0], …)` 这种变量拼不出来的形状 → **只有新加的反向那一格红**。整份判据实测 32 格 / 约 60s（`scripts/affected-tests.mjs` 里的成本陈述按这个数改写）。
