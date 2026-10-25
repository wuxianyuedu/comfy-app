## Fixed

**`PR 失败立案` 取不到构建列表时，把「下一次谁做什么」也写在那一行里**（ISSUE #2332 / #2339）。
这一格是 `endStages`，退出码**不构成流水线结论**（平台原话：「endStages 是否成功不影响流水线
状态」），所以「它读不到」与「它判出没有红」在读数上长得一样 —— 这一格自己最容易继承它要治的
那个形状。

- 2026-10-25 的现场读数（`cnb-uh5-1k5olev2q`）：平台原话是 `errcode 10023` 加一句
  `Missing required scopes: repo-cnb-history:r` —— 这一跑的 `CNB_TOKEN` 少了「构建历史只读」；
- 而那一行原来只有 `取不到构建列表 ⇒ 没有结论，一次都不写。` —— 读者拿不到下一个动作；
- 现在同一条日志里点名这份 scope 属于**这一跑的令牌权限面**（官方 `zh/build/build-in-env.md`
  §CNB_TOKEN 按事件类型分配），不是这一格的判据，并指向立案 **#2339**（配置面，代码改不动）；
- 顺带把上一笔 `[build-readout]` 那行从「顶层键」改成念 `data` 的**实际内容**：实测 runner 上
  顶层键与本地完全一样（`status,trace,header,contentType,data`），只念顶层键等于什么都没说。
