## Fixed

- 测试治理（#2660 第一批收尾）：给 `launcherChainSource()` 的全部接收者补**非空
  前置断言**。该助手把主文件与 `launcher-core/**` 拼成一份源码文本，供「整条编排
  链路」的反向断言使用；一旦拼接（或某份文件）读空，接收者变空串，`not.toContain`
  一族**静默恒真**。本次给 5 份测试（downstream-exit / executor-host-spawn /
  log-run-layout / runtime-log-cross-language ×2 / splash-assets-sync ×2）补上
  `expect(src.trim(), "…").not.toHaveLength(0)` 前置断言（dev-launcher-signal-shutdown
  此前已带）。逐份核对结论：这批链式反向断言都是**刻意的文件级负向契约**（「这份
  文件不许再出现 X」），整档就是正确作用域，不做块级收窄。
