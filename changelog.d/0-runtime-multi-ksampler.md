## Fixed

- **原始 JSON 兼容一个工作流含多个 KSampler**：任务详情「原始 JSON」里的 `runtime` 此前只承载单个采样器（`seed/steps/cfg/sampler_name/sampler_node/...`），因为 `extractRuntimeParams` 明确「只取 graph 顺序第一个 KSampler，后续同类型不覆盖」。一个工作流若串了两个采样节点（两段采样、放大链路各带一个 KSampler 等），第二组的真实 seed/参数就被静默丢弃，看不出实际跑了什么。现把 graph 里**每个**采样节点按出现顺序收进 `runtime.samplers` 数组（各带 nodeId/classType/seed/steps/cfg/sampler_name/scheduler/denoise），同时仍把第一个作为「主采样器」摊平到顶层字段——顶层那份是历史既有形态（种子落库 / manifest / 成功日志都读它），保留它让下游零改动。补 `executor-outputs.test.ts` 锁住单采样器、双采样器、KSamplerAdvanced 的 noise_seed、非采样节点忽略、数字字符串 seed 解析等分支。
