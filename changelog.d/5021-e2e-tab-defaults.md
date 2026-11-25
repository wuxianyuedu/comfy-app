## Fixed

- e2e 视图类 @critical 判据对齐 ISSUE #5003 之后的侧栏页签出厂档（`uiKit` / `models` /
  `settings` = 共享，`model-adapters` / `model-test` / `mode-contract` = 独立）：
  GA 每日档全量 E2E 七条红（ISSUE #5021）——`view-tabs` 五条仍按 #3798 时代的
  「UI 控件总览切走不关」断言、`overlay-entries-as-views` 仍按「模型适配 / 模式契约
  切走即关」断言，同批改断言到现行出厂档。
- e2e 侧栏助手 `closeTempTab` 跟进 ISSUE #4981 的关闭按钮可访问名
  （「关闭 <标签>」→「关闭 <标签> 页签」），设置页签关闭用例因此找不到按钮。
