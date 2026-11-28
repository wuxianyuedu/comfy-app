## Changed
- ComfyUI 工作流图的「JSON 净化 + 深拷贝」收口到唯一出口 `cloneJsonGraph`（ISSUE #5291）：raw-overrides / reference-loader-augment / reference-loader-chain 三模块的 6 处 `JSON.parse(JSON.stringify(...))` 样板改为 import 同一实现，后续是否换更快等价实现可在一处评估；补 5 条行为用例（去 undefined/函数/符号、保留嵌套、不污染原图、标量）。
