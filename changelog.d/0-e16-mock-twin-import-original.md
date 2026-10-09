## Fixed

- **设置页那份 hook 用例其实没在被测实现上跑**：`use-settings-page.test.ts` 的 `vi.mock("~/lib/log/log-file-client")` 里手抄了一份 `fetchFileLogSlice` / `fetchLogSessions`（不是转真模块），副本与被测面已在三处分叉——签名少 `bootId` 参数、URL 是手拼（值里带 `&` / `#` 会打到另一个端点）、回传形状少几栏。后果是日志面板「换个进程就重置时间线」那整条链的判据落空：真实现删掉 `bootId` 也不会红。现在工厂改成真模块展开 + 只替需要记账的 `postAppRuntimeLog`，「哪个会话被请求过」的两处断言改判**真发出去的那条 URL**（查询串由真实现的 `withQuery` 拼）。该文件 42 条全绿，两刀变异（不再发 `bootId` / 会话取数忽略 `sessionId`）各红各的——修之前这两刀都红不了。
