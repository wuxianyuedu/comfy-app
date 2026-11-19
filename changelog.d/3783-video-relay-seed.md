## Added

- **测试模型页视频模式的种子口端到端承接（ISSUE #3783）**：视频 relay 通道补上 seed 的五处同步——请求类型 `ApiVideoSubmitRequest.seed` → 服务端 `unifiedVideoInputs` → 测试页 `RELAY_INPUT_TYPES.video` → 客户端 `apiSubmitVideo` 转发与 `videoBody` 默认体 → relay 路由 `intField`，与生图（#3778）同口径：非负整数（0 合法）才带；适配器映射了 `seed` 口按映射下发，无适配器按通行字段名直带。测试页视频模式的种子行随之从「未承接」禁用态变为可用输入。
