## Fixed

- **历史详情看得到参考图了**（#4910）：工坊 / 工作流库发起的图生图任务，提交链路
  （`buildLibraryWorkflowInput`）此前把参考图文件名折进了 `workflowInputs` 的 pin 值、
  却没把清单带进出参 —— 任务行 `referenceImages` 列与 `params.referenceImages` 都空着，
  详情弹窗的参考图墙与「工坊参数 → 参考图」永远显示「未提供」。现在提交时带上
  `referenceImages`（画布通路一直有带，这里补齐同款）；详情派生层另补
  `deriveReferenceImages`：从任务行列、`params` 顶层与 `workflowInputs` 反推
  （装载计划端点 + `workshop-ref-` 形态，排除首帧 / 尾帧 / 画布主图同名值），
  **存量任务**（列已为空的旧记录）详情也能看到参考图。
- **产物不再混入对比调试图**（#4910）：ComfyUI 调试 / 预览节点（实测是
  ImageCompare 的 `a_images` / `b_images`）把中间图标成 `type=temp` 塞在未知输出键下，
  产物收集的「未知键兜底」此前会把它们下载落库 —— 用户实测「产物只有一张，详情里
  显示三张」。兜底分支现在跳过 `type=temp` 的文件（具名桶 images / videos / gifs /
  audios 的既有行为不变）。

## Added

- **参数表里的图片值显示缩略图**（#4910）：任务详情的「工坊参数」与「工作流参数」
  表中，值是图片文件名（按扩展名判）的行现在渲染小缩略图 + 文件名，可点开看大图，
  不再是纯文本文件名。
