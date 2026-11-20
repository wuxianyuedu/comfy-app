## Fixed

- 工作区隐藏页签的轮询与重渲染随页签隐藏暂停：多页签打开后，隐藏页签（CSS 隐藏但常驻挂载）此前照常轮询——队列页 2s 拉 200 行、ComfyUI 页 30s、历史页 4s、设置页 15s、日志跟随 1s×3、工坊生成期 3s，每次数据到达都对隐藏中的完整子树做一次 React 渲染，主线程与网络税随页签数线性增长。现在把「页签可见性」接进轮询判据：`ViewTabActiveContext` 升级为事实源（`ui/view-tab-active`），`useInterval` 新增 `pauseWhenViewHidden` 档（默认开：隐藏页签不起定时器，切回当前页立即补跑一拍）；四处 React Query 轮询（队列/ComfyUI/历史/设置）加 `enabled: isTabActive` 门控，ComfyUI 的 SSE 长轮询随页签隐藏一并摘下；工坊生成期的 3s 轮询循环在页签隐藏时挂起等待。独立路由页与 Storybook 无页签壳，行为不变。（#4598）
