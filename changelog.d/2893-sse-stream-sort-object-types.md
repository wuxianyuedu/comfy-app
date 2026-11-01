## Fixed

- 已清零规则 `perfectionist/sort-object-types` 的 1 处漂移回到全仓 0（#2893）：
  `src/app/api/sse-stream.ts` 的 `SseChannel` 里 `onClose` 排在 `send` 之后。
  该文件由 #2918 的 `no-confusing-void-expression` 第 2 批新建，晚于 #2992 的清零提交，
  是「清零之后新代码又带回同类命中」的又一处（根因仍是「没有守门」的那一格，归 #2777）。
  只调换两个成员的声明顺序与各自的文档注释，类型形状与运行时行为不变。
  全仓复算（2417 份、不传路径参数）：#2892 的 9 条 + #2893 的 3 条 +
  `typescript/no-unnecessary-template-expression` 合计 0 命中。
