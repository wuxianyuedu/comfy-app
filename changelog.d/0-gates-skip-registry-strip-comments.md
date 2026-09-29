## Fixed

- **条件 skip 登记表改用共享的注释剥离件**（§12.18 复用优先，是对 `1253` 那笔的自查补正）：
  `tests/conditional-skip-registry.test.ts` 自己写了一遍「只认语句起始位置」的行锚定扫描，
  而仓库里早就有 `tests/helpers/strip-comments.ts`（`tests/check-theme-colors.test.ts`、
  `tests/executor-mode-consistency.test.ts` 等四条门禁用例都在用，其中一个还专门引了 §12.18）。
  现在先 `stripComments` 再扫 —— 这类判据要数的是**代码里的 skip 站点**，而文件头的说明里
  正当会出现被扫的形状（本文件自己就是），只靠行锚定是运气不是判据。站点数与登记完全不变
  （8 项 / 24 处），所以「剥了注释没漏数」这条本身就是可复算的。
