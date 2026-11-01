## Added

- **角色 ↔ LoRA 绑定（FR-QA-02③ · #2622，拍板：与其他参数同款的标准契约口路线）**：
  - 契约空间加两枚标准口：`lora-name`（text 族，落 LoraLoader 的 lora_name）与
    `lora-strength`（number 族，落 strength widget）——与 seed 口同一句
    「作者连线才生效」的口径，没连的工作流 unmatched 如实提示、用其图内 LoRA 配置。
  - 角色卡带 `loraName` / `loraStrength`（可选）：设计器下拉数据源 =
    模型库 loras 目录（`model.list({type:"loras"})`，取数收在
    `use-character-lora-options` hook，规范 17），强度 `clamp(0,2)`。
  - 提交收集：ShotStudio 与 use-workshop-generation 两处 buildShotInput 都取
    出场角色里第一个绑定进封装值（多角色链式加载另立）。
  - 明确不做：往提示词拼 `<lora:...>` 标签——ComfyUI 标准 KSampler 不认
    A1111 式标签，那是假实现。
- 需求文档同批：FR-QA-02 翻「已上线」（catalog 状态与 §3 缺口索引、specs ③
  验收与落点、pipeline-stages 阶段②缺口行）。
