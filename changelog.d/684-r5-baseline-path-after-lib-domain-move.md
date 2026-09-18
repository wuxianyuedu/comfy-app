## Fixed

- **R5 文件行数棘轮的基线还挂着迁移前的旧路径**：`src/lib` 子域化
  （ISSUE #565）把 `workflow-param-mapping.ts` 搬进 `src/lib/workflow/`，但
  `scripts/.file-size-baseline.json` 里仍记着根目录旧路径 —— `--strict` 比对时
  认不出新路径，于是把同一个文件当成「新增超限文件」阻断，`master` 上 R5 一直是红的
  （属规范 §12.5.3「迁移目录连带检查五处」漏掉的那一处）。
- 修法：基线键改到新路径 `src/lib/workflow/workflow-param-mapping.ts`，值取
  当前实测 1049 行（< 旧记 1105 行，棘轮只降不升）。
