## Fixed

- **工坊挂载取数没有卸载守卫（`src/components/workshop/hooks/use-workshop-pipeline.ts`）**：
  `/api/skills` 与 API 通道 / 工作流库三路请求在 mount effect 里发起，既没有
  AbortController 也没有「这一轮的写入」判据 —— 组件若在返回前卸载，`setStyles` /
  `setApiChannels` / `setWorkflowOptions` 仍会落地（白跑一次渲染，旧闭包也多活一会儿，
  并发渲染下还可能与后一轮交叠）。三路现在统一走 `beginStaleRun`（与同文件里
  「恢复绘制进度」用的是同一个出口），卸载即 dispose。
