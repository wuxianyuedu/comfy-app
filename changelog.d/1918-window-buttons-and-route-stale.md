## Fixed

- **404 / 错误页上的三个窗口按钮跑到左上角**（ISSUE #1918）。`WindowTitleBar` 是整屏路由页自带的那条精简标题行，它把 `WindowControls` 直接放进 `flex items-stretch` 容器里，却没有 `TitleBarTabs` 里那份 `min-w-2 flex-1` 拖拽空白区——于是 `shrink-0` 的按钮落在 flex-start，最小化 / 最大化 / 关闭整排跑到左上角，与其它页面（以及系统标题栏）相反。
  - 修法：补上与 `TitleBarTabs` 同形的占位格（`flex-1` + `aria-hidden`），把按钮推到右端。
  - 判据：`WindowTitleBar.test.tsx` 新增一条「按钮落在标题行右端」，断言标题行的直接子元素是「`flex-1` 空白区 → 控件容器」两格、且关闭按钮在后一格。此前「按钮在、名字对」那一档对位置一无所知，所以这条缺陷两边的用例与门禁都判不出来。
- **探活端点答 404 时，状态栏永久停在「应用服务连接中」**（ISSUE #1918）。`probeBootId` 把任何非 2xx 都并进「不可达」，于是 `everOnline` 永远为假、`deriveDevServerStatus` 一直走 `starting`——而用户眼前摆着一个被同一个进程正常渲染的页面（Turbopack 会话级路由失效时首个受害者就是探活端点），读到的那句话是谎话，且唯一的出口（重启应用）被藏了起来。
  - 修法：探测结果拆出第三档「服务应答了，但这条路不在编译图里」（404），`DevServerLiveness` 暴露 `routeTableStale`，`DevServerState` 新增 `stale` 档（「应用服务路由异常」），tooltip 与消息中心各给出「重启应用 → 仍不行则删 `.next`」这两步。
  - 判据：`dev-server-status.test.ts` 四态互不相同 + `stale` 文案含 `404` / 重新启动 / `.next`；`use-dev-server-liveness.test.ts` 判 404 与网络层失败分得开、且恢复后归零；`app-service-message.test.ts` 判 `route-stale` 边沿只在进入那一拍发一条、且**不冒充「已断开」**（不写 `offlineAt`，转回 `online` 也不报恢复）。
