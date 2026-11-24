## Fixed

- **`nav-auto-collapse` 的 strict mode 偶发红不再撞侧栏转场瞬态**（ISSUE #4875）。/workspace 走流式 SSR：路由级加载壳（`loading.tsx`）与真壳内容会在转场窗口里同页共存数秒，侧栏 `data-state` 首帧取服务端快照（窄窗判据服务端恒 false ⇒ 展开），客户端对账在数秒后才把同一节点翻转成收起；翻转若恰落在 React 换代提交窗口内，会短暂出现「SSR 展开代 + 客户端收起代」两棵 `[data-slot="sidebar"]`——`openAtWidth` 在 `domcontentloaded` 最早瞬间断言唯一性正好撞上（GA 每日档 strict mode violation、retry 通过；本地 dev/生产两档 24 轮逐帧采样均未复现，属低概率竞态）。现在 `openAtWidth` 先用 `expect.poll` 等稳定态（侧栏数量收敛到 1、`data-narrow` 与 `data-state` 到达按窗宽推导的终值）再放行后续断言，不放宽 strict mode。
