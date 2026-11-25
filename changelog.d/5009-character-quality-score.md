## Added

- **角色库立绘质量打分接口**（ISSUE #5009 反馈）：`scoreQuality`（单张）与
  `scoreAllQuality`（依次给每张已就绪立绘打分）。打分是**确定性规则**
  （纯 JS 解 PNG：纯色 / 空白、对比度、采样色彩单一、分辨率、文件大小），
  不依赖外部模型；分数与问题清单落库（`characterProfile.qualityScore /
  qualityIssues`，迁移 0010），低于 60 分判为「有问题，需要重新生成」，
  `regenerateFlagged` 把低分角色退回待生成并按原链重新入队。
