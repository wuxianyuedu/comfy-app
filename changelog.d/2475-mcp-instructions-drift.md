## Fixed

- **MCP `SERVER_INSTRUCTIONS` 不再谎称「成片合成暂未提供」**（#2475）：`workshop_compose_final`
  工具早已注册（`workshop-mcp.ts`，产出合成清单 JSON，可选 ffmpeg 合成 mp4），但指令末句仍写
  「成片合成暂未提供」，外部 Agent 据此不会调用流水线最后一阶段。补齐第 7 步并移除错误声明。
  同步了 `docs/product/feature-specs.md` 里 `FR-AG-04` 提到的这条漂移验收项（现已闭环）。
