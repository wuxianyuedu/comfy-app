## Fixed

- **项目完成度百分比统一成同一份公式（#4025）**：主页此前按「已完成阶段数 / 6」
  二值计算，工坊按 `computeStageRatios` 分数比例（镜头按完成比、合成未完成给
  半分）——同一项目两个界面报两个数（2 镜完成 1 镜：50% vs 58%），旧注释却
  声称「同口径」。现在主页 `deriveProjectOverview` 按工坊同一公式在 lib 侧重算
  （lib 不 import components），并新增
  `tests/production-progress-parity.test.ts` 逐位钉住两侧一致。一致性（双写）
  审计 #3890 的 P3 项。
