## Fixed

- **整季批量生成不再按模板默认值执行**（ISSUE #4735）：`seriesGeneration.batchGenerateSeason`
  此前每镜任务 `prompt` 恒为空串、`params` 不带 `workflowInputs`，执行器拿模板 rawJson 原样
  提交——所有镜头出同一张默认参数图，镜头提示词完全丢失；而幂等与进度聚合都正常，把
  「内容全错」掩盖成「功能正常跑完」，白烧 GPU/算力。
  - 现在每镜经与单发生成 / 服务端编排**同一份** `buildEncapsulatedInputs` 封装：把该镜
    提示词、负向提示词、尺寸（草稿尺寸表达回读归一）与镜头级参考图（仅已持久化的
    ComfyUI 输入文件名）落进 `params.workflowInputs`，`prompt` 落为镜头提示词。
  - `workflow-run.server.ts` 抽出 `prepareWorkflowRun`（封装现场：模板 + IO/模式/契约口/
    尺寸表，解析一次）与 `buildWorkflowRunParams`（逐值折算 params）供批量路径复用；
    `createWorkflowRunTask` 改为组合两者，单次编排行为不变。
  - 补回归断言：批量生成的每镜任务必须带该镜 `workflowInputs` 且彼此不同、`prompt` 为
    该镜提示词——幂等计数全绿不再能掩盖参数丢失。
