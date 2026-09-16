## Removed

- **内置工作流模板（txt2img / img2img / inpaint / upscale / txt2video / img2video / flfvideo）与其 `__PROMPT__` / `__SEED__` 占位符替换整套移除**：本地 ComfyUI 的每一条生成链路现在都以**工作流库工作流**为唯一来源，不再有「没选工作流就回落到内置模板」这条路。涉及的入口：工坊镜头生图 / 视频生成 / 角色定妆照（本地通道必须选好一个工作流，否则给可行动提示）、画布生图 / 生视频节点（与自定义工作流节点同一条通路）、成片工作室（新增「视频工作流」与「首帧合成工作流」选择器）、分镜首帧合成（改为按传入的图类工作流 id 合成）。
- **`generate.generate` 的入参收窄**：`checkpoint` / `loras` / `sampler` / `scheduler` / `steps` / `cfg` / `size` / `count` / `seed` / `denoise` / `mask` / `upscaleModel` / `fps` / `wanModel` / `wanVae` / `t5Model` 这些**只为内置模板存在**的扁平字段一并去掉 —— 参数真值一律走 `workflowInputs`（对外封装逐端口派值），留着它们只会重演「字段静默失配」。
- **设置项 `defaultVideoWorkflow`（`auto` / `txt2video` / `img2video`）与工坊草稿的 `checkpoint` 列**：成片工作流改由工作流库 id 指定，工坊草稿不再记 Checkpoint。

## Changed

- 删除 `src/lib/comfyui/_meta.ts`、`src/lib/comfyui/workflows/*.json`（7 张内置图）与 `buildAndValidate()`、`replaceTokens()`、`coerceNumericFields()`；服务端编排（成片 / 首帧）改走新增的 `src/lib/workshop/workflow-run.server.ts`，与视图层共用同一份对外封装（`buildEncapsulatedInputs`），两边只差「取工作流元数据的方式」。
