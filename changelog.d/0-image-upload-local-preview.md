## Fixed

- **工作流库「实际使用」与「工坊封装」上传图片后看不到所选图（不依赖 ComfyUI 才显示）**：
  这两处的图片口此前只在 `uploadImageFile` 成功后把 ComfyUI 文件名回填到值上，预览又走
  `mediaPreviewUrl` 拼出的 `/api/images` 代理地址——于是 **ComfyUI 未启动 / 启动超时**时上传
  直接失败、值不落回，既没有「已选」文本也没有缩略图；即便上传成功，缩略图也依赖 ComfyUI
  在线才能加载。表现就是「选了图看不到图，且关掉 ComfyUI 就什么都看不见」。
  - 修法：选完文件**先就地**把它读成 data URL 作本地预览，立刻渲染，**与 ComfyUI 是否运行、
    上传是否成功无关**；上传成功仍把文件名回填到值上（生成时要用）。用户清空该格时连带撤掉
    本地预览，避免「值已空却还显示旧图」。
  - 覆盖两条链路：`DynamicWorkflowForm`（实际使用 / 画布样式预览）的 controller
    （`use-dynamic-workflow-form`）新增 `previews` + `localPreviewUrl`，经
    `WidgetInputRow` → `WidgetControl` 的 `previewSrc` 覆盖优先于 `mediaPreviewUrl(value)`；
    「工坊封装」的 `EncapsulationTestForm` 图片口同样先出本地预览。
  - 新增共享浏览器能力 `readFileAsDataUrl`（`~/lib/browser-io`），与 `copyText` /
    `downloadText` 同级收在一处（§12.18）。

## Tests

- `browser-io.test.ts`：`readFileAsDataUrl`（桩 FileReader 读出 data URL / 无 FileReader 时 reject）。
- `DynamicWorkflowForm.image-upload.test.tsx`、`EncapsulationTestForm.test.tsx`：模拟上传失败
  （ComfyUI 未启动），选完文件后断言立刻出现 `data:` 本地预览图。
