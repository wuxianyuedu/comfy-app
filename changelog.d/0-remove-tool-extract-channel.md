## Removed

- **工坊「工具 · 内置规则解析（不调用模型）」提取通道**：确定性解析可用性差，已彻底移除——角色卡提取与分镜提取的下拉只剩「本地模型 / 远端 API」两档。`ExtractChannel` 类型删掉 `"tool"` 一档（`src/lib/workshop/channel-options.ts`）；`ExtractModelSelect` 去掉 `allowTool` 字段与「工具」选项；`useCharacterExtractFlow` / `useStoryboardExtractFlow` 删除 tool 分支、默认通道改 `local`，提取统一走 LLM 输出 JSON 后解析；相关「可改用工具通道」的降级提示一并改为「调整脚本后重跑」。外部导入的 `.md` 落盘解析（结构化 `人物:/角色:` 行）不受影响。
