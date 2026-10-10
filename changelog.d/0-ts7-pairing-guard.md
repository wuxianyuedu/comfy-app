## Added

- `tests/turbopack-tracing-excludes.test.ts` 补一条构建期**配置配对判据**：
  `experimental.useTypeScriptCli: false` 在场时，从仓库根解析到的 `typescript`
  主版本必须 < 7。官方文档（`useTypeScriptCli.mdx`）明写这二者同时成立会让
  `next build` **直接退出**；本仓把这颗 opt-out 当钉死项（硬规则 2，因为
  `typescript` 别名到 `@typescript/typescript6`、其 `bin/` 只有 `tsc6` 没有 `bin/tsc`），
  而它此前**没有任何执行者** —— 翻别名是一次看起来正常的依赖动作，坏消息要等有人真跑
  `next build` 才以「进程退出」出现，且那句话指不出是这两个值不配对。
  红话点名两条出口（留在 TS6，或切 TS7 时去掉这颗 opt-out 并按硬规则 2 说明理由）。
  版本号先卡形状再取主版本：`Number("")` 是 `0` 而不是 `NaN`，只判
  `Number.isInteger` 会让「读不出版本号」伪装成合法的 TS0 静默通过。
