## Fixed
- 执行日志大屏弹窗长行多空行 + 滚动卡顿（#5035）：`VirtualLogList.measureRow` 此前量带 minHeight 的行盒自身且只接受变高，估高偏大的那行显示成空白（#4718 修了 LogPanel 却漏了这里）；改为量内容元素 + 双向判定，消息与估算高度走 data-* 让回调身份稳定（不再每帧重挂所有可见行读 offsetHeight）。两个调用方的 getMessage 换模块级稳定函数，避免 layoutRows 每帧全量重算。补组件用例（收窄/撑开/0 不写）与 log-virtual 尾随空段用例。
