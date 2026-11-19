## Fixed

- **两份 oxlint 配置的 jsPlugins 真正同组**（ISSUE #3440）：IDE 评估尺
  （`oxlint.config.ts`）补上判决面一直存在的 `unused-imports` jsPlugin 与
  `unused-imports/no-unused-imports` 规则；`oxlint-jsplugin-rules` 的对拍从
  「只挑 2 个别名」扩成**整组逐字对拍**，文件头「同一组 jsPlugin 别名」的
  承诺自此成立。判决面不受影响（全量 lint 0 诊断）。

  Closes #3440
