## Fixed

- **测试超时预算按 449 文件的新套件规模重算**（`vitest.config.ts`）：上一轮实测
  定的 20s / 30s 在套件涨到 449 文件后被吃掉——全量满载下 theme 的
  `beforeAll`（隔离 7.2s）与 LogPanel 渲染双双越线，6 文件 / 11 例争用假红
  （单跑全绿）。全局抬到 `testTimeout: 30s` / `hookTimeout: 45s`；
  两个 prettier 全仓扫描用例族（check-format / check-reformat-only）自带预算
  抬到 60s——它们是最慢的合法用例，不是挂死。并发档维持实测最优的
  `maxWorkers: 8` 不动。
