## Changed

- **剧本编辑器预览改走按需渲染地基**（#4384）：`ScriptMarkdownEditor` 摘掉
  `~/lib/markdown` 的静态 import，预览改经 `useMarkdownHtml(showPreview ? value : "")`
  ——`marked` + `dompurify`（全库最重的两个客户端依赖）不再进编辑器静态图，
  预览首开才动态加载；`showPreview` 同时是计算闸（关闭时给空串、hook 早退），
  与 #4341 的「关预览不做全量解析」语义等价。交互差异：预览首开的一拍改为
  异步出画（全库另一块预览面 `WorkshopStageBody` 本就是此形态，两块收敛）。
