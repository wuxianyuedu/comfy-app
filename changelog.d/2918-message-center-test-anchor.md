## Fixed

- **`tests/storybook-message-center-sources.test.ts` 的「标记已读按钮带 h-auto」判据跟上 #2918 的块体化改写**：
  d0d797017（no-confusing-void-expression 清零）把面板里的 `onClick={() => markRead(m.id)}`
  改成块体 `onClick={() => { markRead(m.id); }}`，而该判据的锚点还是旧字面量
  `onClick={() => markRead(`，于是 HEAD 上恒红（「没找到那颗 Button」）。锚点改为
  调用点 `markRead(m.id)`（全文件唯一），定位「这颗按钮」的断言意图不变、`h-auto`
  判据一字未弱。全仓扫同类字面量锚点（tests/ 与 src/ 下 `indexOf/toContain/includes`
  带 `=>` 的源码扫描）仅此一处因块体化失效。
