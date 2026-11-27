## Added
- 漫剧推荐工作流包只读分析（ISSUE #5219，借鉴 MiniMax H3 Director 示例工作流 + Guide、Toonflow 插件市场提示）：对**用户自己导入**的 ComfyUI RAW JSON 识别 T2V / I2V / FLF2V 模式，按模式点名最小必需节点并逐条报缺件，列出 checkpoint / LoRA / 模型依赖供确认（不自动下载）；脏 JSON 按「无法判定」返回不打断整批。补 5 条纯函数用例；产品 FR-WF-17 与工坊指南同步。不恢复内置模板、不改工作流库唯一来源；导入入口 UI 与一键落库接线待接。
