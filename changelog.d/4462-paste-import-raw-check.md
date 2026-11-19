## Fixed

- **粘贴导入补上 RAW 校验**（#4462）：粘贴路径与拖入 / 选文件入口共用同一个
  `isRawWorkflowJson` 判据 —— 粘贴 API 格式 JSON 不再「成功」入库成一条
  「无可执行内容」的记录，两条入口对同一份文件行为一致（明确提示
  「不是 ComfyUI 的工作流(RAW) JSON（缺少 nodes[]）」）。
