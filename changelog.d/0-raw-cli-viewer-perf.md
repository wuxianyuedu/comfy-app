## Fixed

- **「comfy-cli 完整输出」弹窗非常卡**：两处叠加 ——

  ① `JsonViewer` 给渲染层传了 `collapsed={false}`，而 `react18-json-view` 里
  `isCollapsed()` 的第一句就是 `if (typeof collapsed === 'boolean') return collapsed;`
  —— 于是 `collapseObjectsAfterLength` 阈值**永远不生效**，一个几百个键的 `prompt`
  （每个节点还各带 `inputs` / `_meta`）首屏全量展开成几十万个 DOM 元素；

  ② 弹窗运行期每 1.5s 轮询整份输出，每轮都把全部行重新 `JSON.parse`、并让每个
  `JsonViewer` 用新对象身份把整棵树重建一遍（敲搜索框也会，因为渲染层没有 memo）。

  现在：`JsonViewer` 不再传 `collapsed`（阈值恢复生效，大容器折成 `…`、点开才
  渲染）、渲染层按 props 记忆化、空闲时跳过整轮 DOM 高亮后处理；弹窗侧把逐行解析
  收进带缓存的 `raw-cli-lines`（同一行返回同一个对象）、行组件 `memo`、两轮内容
  逐字相同时连 `setState` 都不发、轮询不再翻 `loaded`（头部提示不再闪）。

  影响面：`JsonViewer` 的四个消费方（raw-cli 弹窗、日志折叠行、工作流源码弹窗、
  节点详情）首屏都不再全量展开 ——「项数超阈值的容器折叠」一直是这些组件文档里
  写明的口径，此次只是让它真的跑起来。

  回归护栏：`src/components/ui/json-viewer.test.tsx`（新：项数超阈值的容器首屏
  不渲染其叶子 + `initialCollapsedDepth=0` 仍全展开）、
  `src/components/studio/workflow-library/raw-cli-lines.test.ts`（新：解析结果
  身份稳定 + 两轮内容逐字比较）。
