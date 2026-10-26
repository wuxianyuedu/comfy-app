## Fixed

- **changelog 碎片「`0-` 无号出口」的三个读者面对齐**（ISSUE #2384）：`changelog.d/README.md`
  第 1 条补上那半个条件 —— `## Fixed` 段落没有 `0-` 出口（修缺陷先立案，AGENTS 硬规则 29 /
  §13.10.9），并指明谁在念这件事（`pnpm ship` 阶段 0 的读数，不是闸）；
  `check-changelog-fragments.cjs` 的文件头把「它不判这一格」写成它已知的边界，
  别让读者把它的绿读成「`0-` + Fixed 也可以」。两处都是文字，不改判据。
