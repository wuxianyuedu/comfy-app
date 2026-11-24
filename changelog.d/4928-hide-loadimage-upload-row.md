## Fixed

- **工作流编辑器画布不再显示 LoadImage 的「选择文件上传」行**（#4928）：
  LoadImage 的 `upload` 输入是 ComfyUI 前端专有的 `IMAGEUPLOAD` 上传按钮槽位，
  API 图不携带它、写入的值会在 API 转换时被整体剥掉，画布上也没有任何可操作
  功能。画布 widget 分桶（`workflow-node-entries.ts`）现在与富化层同口径过滤
  `IMAGEUPLOAD` 行 —— 「选择文件上传」行不再出现，`image` 文件名值行与
  LoadImage 缩略图预览照常。
