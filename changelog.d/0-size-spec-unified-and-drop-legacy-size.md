## Changed

- **尺寸口径全项目收口到 `lib/size-presets`：只有「比例 + 分辨率」与「比例 + 百万像素 + 倍数」两种表达。** 新增 `SizeSpec`（比例 label + 清晰度档 label + 倍数）、`DEFAULT_SIZE_SPEC`、档位目录 `SIZE_CLARITY_PRESETS` 与 `CLARITY_SUBGROUP_LABELS`，以及 `sizeSpecDims` / `sizeSpecToWxH` / `sizeSpecMegapixels` / `sizeSpecMultiple` / `sizeSpecSummary` / `sizeSpecFromText`（老 `"WxH"` 回读）/ `aspectLabelForDims`（宽高 → 端口候选值）等纯换算。studio 侧 `workflow-io` 与工坊侧 `shot-size-config` 都退化成这层的薄包装（档位表不再各写一份；「像素」子类的 kind 从 `pixel` 正名为 `resolution`）。
- **工坊封装层改吃结构化尺寸**：`WorkshopExposedValues.size` 由 `"WxH"` 字符串变为 `SizeSpec`，`buildEncapsulatedInputs` 按当前模式的**场景**（图 / 视频，`sceneFromMode`）现算宽高 —— 不再出现「把 WxH 反解回比例、落在两个预设之间」的路径。同时清掉工坊自己那份写死的比例表 `RATIO_PRESETS`（改用 `SIZE_RATIO_PRESETS`）与 `longEdgeToMegapixels`。
- **工坊各调用方统一传尺寸表达**：镜头生图（`use-workshop-pipeline` / `ShotStudio`）、定妆照（`use-character-portrait` + `character-portrait-client`）、工作流库「工坊封装」面板的测试运行，都不再拼 `"WxH"` 再反解；写死的 `"832x1216"` 兜底与「比例 + 像素」双通路随之删除（默认尺寸统一取 `DEFAULT_SIZE_SPEC` = 3:4 / 1k）。成片合成为视频场景 16:9 1k 的画幅，也不再写 `scale=1280:720` 字面量。
- **「尺寸表达」的记录与展示跟着改**：镜头/定妆照的生成日志写 `3:4 / 1k` 这类摘要（`sizeSpecSummary`），不再显示折算出来的像素串。

## Removed

- **工坊/定妆照走「工作流库工作流」时的 `size` 兼容字段**：`buildLibraryWorkflowInput` 不再把 `"768x1024"` 这类字符串塞进请求体。它是老口径的冗余字段（任务 `params` 直接存整个请求体，历史详情「生成尺寸」优先读 `params.size`），对导入的 ComfyUI 工作流本来就不生效（生效的是 `workflowInputs` 里逐端口派下去的值），只留下一行与三方尺寸参数并列的误导信息。现在尺寸只以「比例 + 分辨率」或「比例 + 百万像素 + 倍数」下发；内置 txt2img 与远端 images 接口要的 `"WxH"`／「比例 + 百万像素」由尺寸表达现算。

## 遗留（本轮未动）

- **服务端工坊通道**（`orchestrator.generateImage` / MCP 的 `size: z.string()`）与**短片项目列** `filmProject.size`（默认 `"1280x720"`）、**项目画布节点**的尺寸字段仍是 `"WxH"` 字符串：它们是各自独立的口径（服务端 orchestrator、数据库列、画布节点数据），要一起收口需要另开一轮（涉及迁移与外部调用方）。
