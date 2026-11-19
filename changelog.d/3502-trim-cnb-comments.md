## Changed

- **`.cnb.yml` 精简注释（ISSUE #3502）**：2647 行 → 917 行（注释 2260 → 530）。删的是纯叙事
  与历史读数段（头注五条差异压缩成结论 + 规范指针、CP936 转码史、各 stage 的逐段解释），
  保留机器可读锚：11 条 `# - name:` 注释形态停用格原文（`commentedStageNames` 判据 +
  停用登记对账的承重形态）、`COMFYAPP_CI_*` 登记值、⚠️ 警示与 `§`/`ISSUE` 出处指针。
  修复过程中顺带把行尾归一为 LF（CRLF 残留会让 `pipelineStageNames` 的
  `name:` 正则匹配到 `\r`，流水线解析全空）。
