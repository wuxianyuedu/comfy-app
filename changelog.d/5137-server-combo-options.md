## Fixed

- 服务端编排的尺寸派值不再落裸比例（#5137）：COMBO 口的候选来自 ComfyUI `object_info`，
  库里 `workflowIO` 天然没有；服务端此前直读库行 → `"16:9"` 短标签被 ComfyUI 拒收。
  `prepareWorkflowRun` 现在借视图层同一份富化派生（`buildWorkflowDetailFull`，30s 缓存），
  **只拷 options**，身份字段仍以库行连线为准；富化失败按库行回落并留 warn，不阻断入队。
