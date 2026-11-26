## Fixed
- 内部预览节点的文本不再被当成交付产物（#5109）：ComfyUI history 里 `PreviewAny` 等预览节点的 `text` 是提示词扩写链路的中间结果，此前被 `collectOutputs` 无条件收进 `texts`，落成 `txt_0.txt` + 第二条 `TaskImage` 行，让用户以为「一张图却有两个产物」。现在按执行图 `prompt[2]` 的节点 `class_type` 识别内部预览节点并跳过其 text（与 #4910 对 temp 文件的过滤同口径）；ShowText 等真正的文本交付节点照常保留，图缺失时不凭空丢文本。日志同时把「输出节点 N 个」与「可下载产物 M 份」分开报，不再让节点数冒充产物数。同批补节点识别、过滤与保留真文本的行为用例。
