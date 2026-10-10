## Fixed

- **§13.5.8 里 `D(二十多个判据脚本)` 是过期计数，改成不写死数字的表述**（ISSUE #1619）。真实条数是 **53**，唯一出处是 `.githooks/pre-commit` 里那句 `D(53 个判据脚本)`，由 `tests/doc-check-hook-wiring.test.ts` 核。规范里抄第二份 = 造一个会漂的副本（本仓反复踩过的形态），故改成 `D(组内串行的静态判据)`。

## Changed

- **§13.5.8.1 补上「共享可写路径」半格**（ISSUE #1619 §2）：点名的两条判据实测**只有一条是真的** —— `check-known-failed-stale.mjs --self-test` 往仓库根写固定名探针、与 C 组 vitest 的 `include` 面重叠（真实竞态）；`check-reformat-only.cjs` 用 `mkdtempSync` **本来就隔离**。其余 20 余条的写盘全在 `--update` 档（人的动作），check 档一条都不写。⇒ 它不是并发的拦路石，真要做也只该按 #1608 给 `check-a11y-rules.cjs` 加 `--ledger <path>` 的同一招（临时路径入参），**结论仍是「不做」**。
