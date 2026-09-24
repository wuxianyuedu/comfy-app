## Fixed

- **工坊封装节点（子图）的图片类输入在界面上完全看不到选中的图**：根因是图片预览与文件名提取只认裸文件名字符串，而 ComfyUI 把 IMAGE 类型输入的默认值 / 已选值以 `{filename,subfolder,type}` 对象或 `[filename,subfolder,type]` 数组形态存储（不是裸文件名）。于是选完图既拿不到预览地址、上传按钮文本也空掉；画布节点还会把对象 / 数组渲染成 `[object Object]`。

  修法：**让 `mediaPreviewUrl` 吃任意形态引用**（字符串 / 对象 / 数组，见 `src/lib/media/media-url.ts`），并新增 `mediaReferenceFilename` 拍平出文件名；**画布上的封装节点为图片类 widget 渲染缩略图**（`WorkflowSubgraphNode`），表单的图片上传控件（`WidgetControl`）改用这两个助手。

  此前只在 `EncapsulationTestForm` 与 `WidgetControl` 的某些路径修过「只有文件名文本、看不到图」，但漏了「值是 ComfyUI 媒体引用对象 / 数组」与「画布节点纯文本」两条路径。
