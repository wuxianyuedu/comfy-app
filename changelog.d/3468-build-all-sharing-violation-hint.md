## Fixed

- **一键发布构建撞 `os error 32` 时不再只给裸错误（ISSUE #3468）**：本机 2026-11-09 那一跑 `build-desktop.mjs` 4/4 与 cargo `Finished release` 全绿，红在 bundler 打完 nsis、给 msi 二次 patch 同一个 `app.exe` 时（nsis 包已生成 59.81 MiB、msi 目录只有旧包）。旧失败分支只查「有没有桌面壳」、只提 `os error 5`，壳没跑时读日志的人拿不到任何出口。现在 `tools/scripts/build-all.ps1` 读已落盘的日志尾部按错误码分岔：`os error 32` 给「本仓这一族出现在 nsis → msi 二次 patch」的定性，以及「等几秒重跑」与 `pnpm exec tauri bundle --bundles msi`（复用已编译的 `app.exe` 与 `static`，不重跑 8 分钟编译）两条出口；原有 `os error 5` 壳提示原样保留。
- **读不到日志时不给结论**：按 §13.6.3 三态口径，`Get-Content` 取不到尾部就明确念「这一格没跑起来，照上面那段真实错误归因」，不把「没读到」当成「没有这种错误」。
- **边界**：不动 `src-tauri/tauri.conf.json` 的 `bundle.targets`（MSI 是 §7.7 的正式产物）、不改发布顺序（构建退 1 仍不执行 `publish-desktop-bundle.mjs`）、不改另两条不进 bundle 段的链（`build-tauri-release.ps1` 跑 `cargo build`、`build-standalone.ps1` 带 `--no-bundle`）、不新增判据脚本、不重跑构建；仓库侧修的是失败出口，不是运行机的实时防护 / 索引器。
- **回归用例 `tests/build-all-failure-hint.test.ts`**：静态钉住三档出口的形状、日志尾部的读取面、`os error 5` 提示仍在、失败仍先于发布、`.ps1` 保持 UTF-8 with BOM；另用真宿主 Parser sweep 证明改完的脚本没有 ParseError，没装 PowerShell 宿主时按三态跳过。
- **同批登记条件性 skip 站点（§11.7）**：新用例用 `describe.skipIf(hosts.length === 0)` 保护真宿主那一格，`tests/conditional-skip-registry.test.ts` 的 `REGISTERED` 同批加一行（tier=env / count=1 / why）。首次交付的 `fixed-structural-tests` 就红在「未登记的 skip 站点：tests/build-all-failure-hint.test.ts#hosts.length === 0」，照读数补齐后本地 5 条登记判据全绿 —— 这条不是可选项，是「绿有两种含义」那张表的硬闸。
