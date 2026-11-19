## Fixed

- `tests/ci-token-scopes.test.ts` 的「四处 endStages 都不带 `--strict`」用例此前把入口数钉成 `.cnb.yml` 里**所有含 `ci-token-scopes.mjs` 的行**：`config.split("\n").filter((l) => l.includes(...))` 不区分 `script:` 命令行与注释行。于是任何在 `.cnb.yml` 注释里引用一次该文件名（#3278 给 `每日镜像出勤立案` 写的说明）都会把计数顶成 5，GA `affected-tests` 红成 `expected 5 to be 4`，而四个入口一条都没少；平台红在 `GitHub 判决判定`，人第一眼会去找「是不是多 / 少了一个锚点」，实际只是注释里提了一句文件名（ISSUE #3306）。
- 现在计数面只认**会被执行的那几行**：先按 `syntax: "hash"` + `trailing: true` 调 `tests/helpers/strip-comments.ts`（§12.18「剥注释唯一实现」，不另写正则）剥掉整行与行尾注释，再只取 `script:` 行。`.gates` 里的 4 空格与 `endStages` 锚点块里的 6 空格两种缩进都在面内；`--strict` 那条逐行判据一字未改，仍只钉真正的四条命令。

## Changed

- 用例注释里「新增第五个锚点时同批改这一行」这句旧口径同步改成「计数只认会被执行的 `script:` 行，新增 / 撤掉一个锚点时同批改这一行」，不再把「字符串出现次数」当成「入口数」。
- 新增 7 条回归用例：两种缩进都数得到、整行注释 / 行尾注释引用脚本名仍绿、被注释掉的一格与删掉一条 `script:` 行都只剩 3 条、真命令带 `--strict` 仍在面内、注释里写 `--strict` 不被当成命令旗标。
- 本机可执行文件 `temp/verify-3306.mjs` 拿**真的** `.cnb.yml` 与**真的**判据做四刀反向验证：基线绿、注释注入仍绿（`exit 0`）、摘掉一条 `script` 行红（`expected 3 to be 4`）、把判据临时退回旧实现后同一份注释注入红（`expected 5 to be 4`，与 PR #3303 第二跑平台读数同形）；跑完两份文件按原字节恢复，sha256 逐字一致。
- `.cnb.yml` 一行未改：四个入口的命令原文、`--strict` 边界、三态退码与 `scripts/ci-token-scopes.mjs` 全部照旧。治理口径没有变化，只把判据的输入面从「整份配置的所有行」收成「会被执行的命令行」。
- 判决面：改动文件 `oxfmt --check` 通过；定向用例 26 passed，相邻 4 份 226 passed；全库 `pnpm run lint` 384 条规则 `0 warnings 0 errors`；`tsc --noEmit` 0；`pnpm run check:premerge` 43 条判据红 0 / `current-green`（含 41 条清零 oxlint 规则探针、`strip-comments` 形状面、文件结构硬规则、`doc:check`）；`pnpm check:deps-freshness` OK。
