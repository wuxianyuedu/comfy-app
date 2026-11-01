## Fixed

- 已清零规则在主干的漂移回潮：全预设扫描（不传路径）在 5 份文件里读出 14 处命中，覆盖
  `eslint/curly`、`import/no-duplicates`、`eslint/prefer-template`、
  `perfectionist/sort-object-types`、`typescript/array-type`、`unicorn/numeric-separators-style`
  6 条规则。全部落在 #2931 / #2949 之后新增或改动的 `tests/**`、`scripts/**`（那批的写者
  跑不到 oxlint —— 它不是 CI 门禁，接线归 #2777）。
- 修完逐条回到全仓 0；`tests/probe-restore.test.ts` 里三条被禁形状改用模板串，产出字符串
  与拼接版逐字相等（4/4 现场比对），该用例自身的「三种形状各自命中」断言仍是绿的。
