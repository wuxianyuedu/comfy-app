## Fixed

- HostBuffer 权重加载失败不再是一句看不懂的英文（#5144）：`error-advice` 新增形态 → 内存 /
  显存不足与「改用同模型更小量化版本（int8 → nvfp4）」的可行动建议，并纳入自动展开判据；
  历史卡与画布错误面板同源。新增 `lib/comfyui/model-availability.ts`：从工作流 RAW / API 图
  扫出钉死的模型文件名，与本机已扫清单比对；`parseWorkflowContent` 导入时给出缺失模型警告
  （清单取不到不阻断导入）。同批补建议映射与预检纯函数用例。
